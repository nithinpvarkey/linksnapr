'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import Image from 'next/image'
import dynamic from 'next/dynamic'
import type { JSX } from 'react'
import { SkeletonCard } from '@/components/SkeletonCard'
import { trackEvent }   from '@/lib/analytics'

// ─── Dynamic imports — loaded only when needed ────────────────────────────────

const ShareButtons = dynamic(
  () => import('@/components/ShareButtons').then(m => ({ default: m.ShareButtons })),
  { ssr: false },
)

const SnapGifButton = dynamic(
  () => import('@/components/SnapGifButton').then(m => ({ default: m.SnapGifButton })),
  { ssr: false },
)

// ─── Types ────────────────────────────────────────────────────────────────────

interface LinkCardProps {
  url:             string
  isPro:           boolean
  onUpgradeNeeded: () => void
}

type CardStatus = 'loading' | 'streaming' | 'complete' | 'error'

// ─── Helper ───────────────────────────────────────────────────────────────────

function getDomainInitial(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '')[0]?.toUpperCase() ?? '?'
  } catch {
    return '?'
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LinkCard({ url, isPro, onUpgradeNeeded }: LinkCardProps): JSX.Element {
  const [title,            setTitle]            = useState('')
  const [summary,          setSummary]          = useState('')
  const [tags,             setTags]             = useState<string[]>([])
  const [imageUrl,         setImageUrl]         = useState('')
  const [imageReceived,    setImageReceived]    = useState(false)
  const [imageError,       setImageError]       = useState(false)
  const [showOverlay,      setShowOverlay]      = useState(false)
  const [status,           setStatus]           = useState<CardStatus>('loading')
  const [errors,           setErrors]           = useState<Record<string, string>>({})
  const [isRetrying,       setIsRetrying]       = useState<Record<string, boolean>>({})
  const [showShareButtons, setShowShareButtons] = useState(false)
  const [cardId,           setCardId]           = useState('')

  const timeoutRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryTimerRef = useRef<Partial<Record<string, ReturnType<typeof setTimeout>>>>({})
  const isHoveringRef = useRef(false)
  const onUpgradeRef  = useRef(onUpgradeNeeded)
  onUpgradeRef.current = onUpgradeNeeded

  // ── SSE event handler ──────────────────────────────────────────────────────

  function handleSseEvent(type: string, data: unknown): void {
    switch (type) {
      case 'image': {
        const d = data as { imageUrl?: string }
        setImageReceived(true)
        setImageError(false)
        setImageUrl(typeof d.imageUrl === 'string' ? d.imageUrl : '')
        break
      }
      case 'title': {
        const d = data as { title?: string }
        const t = d.title
        if (typeof t === 'string') { setTitle(t); setStatus('streaming') }
        break
      }
      case 'tag': {
        const d = data as { tag?: string }
        const tag = d.tag
        if (typeof tag === 'string') setTags(prev => [...prev, tag])
        break
      }
      case 'summary': {
        const d = data as { token?: string }
        const token = d.token
        if (typeof token === 'string') setSummary(prev => prev + token)
        break
      }
      case 'error': {
        const d = data as { section?: string; message?: string }
        const section = d.section
        if (typeof section === 'string') {
          const msg = typeof d.message === 'string' ? d.message : 'An error occurred'
          setErrors(prev => ({ ...prev, [section]: msg }))
          trackEvent('error_shown', { error_type: section, user_tier: isPro ? 'pro' : 'free' })
        }
        break
      }
      case 'done': {
        const d = data as { cardId?: string }
        if (typeof d.cardId === 'string') setCardId(d.cardId)
        setStatus('complete')
        setShowShareButtons(true)
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
        trackEvent('card_generated', { user_tier: isPro ? 'pro' : 'free' })
        break
      }
    }
  }

  // ── SSE connection ─────────────────────────────────────────────────────────

  async function connectSse(signal: AbortSignal): Promise<void> {
    try {
      const response = await fetch('/api/summarise', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url }),
        signal,
      })

      if (!response.ok) {
        if (response.status === 402) { onUpgradeRef.current(); return }
        const message = response.status === 429
          ? 'Too many requests. Please wait a moment.'
          : 'This link could not be processed.'
        setStatus('error')
        setErrors({ global: message })
        return
      }

      if (!response.body) {
        setStatus('error')
        setErrors({ global: 'This link could not be processed.' })
        return
      }

      timeoutRef.current = setTimeout(() => {
        setStatus(prev => (prev === 'complete' ? prev : 'error'))
        setErrors(prev => ({
          ...prev,
          timeout: 'This is taking longer than expected. Showing partial results.',
        }))
      }, 15_000)

      const reader  = response.body.getReader()
      const decoder = new TextDecoder()
      let   buffer  = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() ?? ''

        for (const block of blocks) {
          if (!block.trim()) continue
          let eventType = ''
          let eventData = ''
          for (const line of block.split('\n')) {
            if (line.startsWith('event: '))     eventType = line.slice(7).trim()
            else if (line.startsWith('data: ')) eventData = line.slice(6).trim()
          }
          if (eventType && eventData) {
            try { handleSseEvent(eventType, JSON.parse(eventData)) }
            catch { /* malformed JSON — discard event */ }
          }
        }
      }

    } catch {
      if (signal.aborted) return
      setStatus('error')
      setErrors({ global: 'Connection failed. Please try again.' })
    }
  }

  // ── Effect — connect on mount and on url change ────────────────────────────

  useEffect(() => {
    const controller = new AbortController()

    setTitle('');         setSummary('');       setTags([])
    setImageUrl('');      setImageReceived(false);  setImageError(false)
    setShowOverlay(false)
    setStatus('loading'); setErrors({});        setIsRetrying({})
    setShowShareButtons(false); setCardId('')
    if (timeoutRef.current) clearTimeout(timeoutRef.current)

    void connectSse(controller.signal)

    return () => {
      controller.abort()
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  // connectSse closes over url which is already in deps — safe to omit
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  // ── Retry ──────────────────────────────────────────────────────────────────

  function handleRetry(section: string): void {
    if (isRetrying[section]) return
    setIsRetrying(prev => ({ ...prev, [section]: true }))
    setErrors(prev => { const next = { ...prev }; delete next[section]; return next })
    trackEvent('retry_clicked', { failed_section: section, user_tier: isPro ? 'pro' : 'free' })
    void connectSse(new AbortController().signal)
    retryTimerRef.current[section] = setTimeout(() => {
      setIsRetrying(prev => ({ ...prev, [section]: false }))
    }, 2_000)
  }

  function handleGlobalRetry(): void {
    setStatus('loading'); setErrors({}); setIsRetrying({})
    trackEvent('retry_clicked', { failed_section: 'global', user_tier: isPro ? 'pro' : 'free' })
    void connectSse(new AbortController().signal)
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  if (status === 'loading') return <SkeletonCard />

  // ── Global error ───────────────────────────────────────────────────────────

  if ('global' in errors || 'scraper' in errors) {
    return (
      <div
        role="alert"
        className="w-full rounded-2xl border border-slate-100 bg-white p-6 text-center shadow-md"
      >
        <p className="font-semibold text-slate-900">This link could not be processed.</p>
        <p className="mt-1 text-sm text-slate-500">
          The page may be unavailable or blocking access.
        </p>
        <button
          onClick={handleGlobalRetry}
          className="mt-4 min-h-[44px] rounded-lg bg-indigo-500 px-6 text-sm text-white hover:bg-indigo-600 transition-colors"
        >
          Try again
        </button>
      </div>
    )
  }

  // ── Card ───────────────────────────────────────────────────────────────────

  return (
    <article
      aria-live="polite"
      className="w-full rounded-2xl shadow-md border border-slate-100 bg-white overflow-hidden"
    >

      {/* Image */}
      {!imageReceived ? (
        <div className="aspect-video w-full bg-slate-200 motion-safe:animate-pulse" />
      ) : imageUrl && !imageError ? (
        <div
          className="aspect-video w-full relative overflow-hidden cursor-pointer"
          onMouseEnter={() => { isHoveringRef.current = true; if (summary) setShowOverlay(true) }}
          onMouseLeave={() => { isHoveringRef.current = false; setShowOverlay(false) }}
          onClick={() => { if (!isHoveringRef.current && summary) setShowOverlay(prev => !prev) }}
        >
          <Image
            src={imageUrl}
            alt={title ? `Thumbnail for ${title}` : 'Page thumbnail'}
            fill
            className={`object-cover transition-all duration-300 ${showOverlay && summary ? 'scale-105 blur-sm' : 'scale-100'}`}
            unoptimized
            onError={() => { setImageError(true) }}
          />

          {/* Summary overlay — fades in on hover (desktop) or tap (mobile) */}
          <div
            className={`absolute inset-0 flex flex-col justify-end p-4 bg-gradient-to-t from-black/80 via-black/50 to-transparent transition-opacity duration-300 ${showOverlay && summary ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          >
            <p className="text-sm text-white leading-relaxed line-clamp-4">{summary}</p>
          </div>

          {/* Hint — visible when summary is ready but overlay is hidden */}
          {summary && (
            <div
              className={`absolute bottom-2 inset-x-0 flex justify-center pointer-events-none transition-opacity duration-300 ${showOverlay ? 'opacity-0' : 'opacity-100'}`}
            >
              <span className="text-xs text-white bg-black/40 rounded-full px-2.5 py-1 select-none">
                tap for summary
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="aspect-video w-full bg-slate-100 flex items-center justify-center">
          <span className="text-4xl font-semibold text-slate-400 select-none">
            {getDomainInitial(url)}
          </span>
        </div>
      )}

      <div className="p-4 flex flex-col gap-4">

        {/* Title */}
        {!title && status === 'streaming' ? (
          <div className="flex flex-col gap-2">
            <div className="h-4 bg-slate-200 rounded motion-safe:animate-pulse" />
            <div className="h-4 w-2/3 bg-slate-200 rounded motion-safe:animate-pulse" />
          </div>
        ) : (
          <h2 className="font-bold text-slate-900 text-xl leading-tight line-clamp-2">
            {title || (
              <span className="italic font-normal text-slate-400">Unable to fetch title</span>
            )}
          </h2>
        )}

        {/* Tags */}
        {tags.length === 0 && status === 'streaming' && !errors['tags'] ? (
          <div className="flex gap-2">
            {[0, 1, 2].map(i => (
              <div key={i} className="h-6 w-16 bg-slate-200 rounded-full motion-safe:animate-pulse" />
            ))}
          </div>
        ) : tags.length > 0 ? (
          <ul role="list" aria-label="Tags" className="flex flex-wrap gap-2">
            {tags.map(tag => (
              <li
                key={tag}
                className="bg-indigo-100 text-indigo-700 rounded-full px-3 py-1 text-sm font-medium"
              >
                {tag}
              </li>
            ))}
          </ul>
        ) : errors['tags'] ? (
          <button
            aria-label="Retry generating tags"
            disabled={!!isRetrying['tags']}
            onClick={() => { handleRetry('tags') }}
            className="self-start min-h-[44px] px-3 text-sm text-indigo-500 hover:text-indigo-700 disabled:opacity-50 transition-colors"
          >
            {isRetrying['tags'] ? 'Generating...' : 'Generate tags'}
          </button>
        ) : status === 'complete' ? (
          <button
            aria-label="Retry generating tags"
            disabled={!!isRetrying['tags']}
            onClick={() => { handleRetry('tags') }}
            className="self-start min-h-[44px] px-3 text-sm text-indigo-500 hover:text-indigo-700 disabled:opacity-50 transition-colors"
          >
            {isRetrying['tags'] ? 'Generating...' : 'Generate tags'}
          </button>
        ) : null}

        {/* Footer — URL + watermark */}
        <div className="flex items-center justify-between pt-1 border-t border-slate-50 gap-2">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-slate-400 truncate hover:text-slate-600 transition-colors min-w-0"
          >
            {url}
          </a>
          {!isPro && (
            <a
              href="https://linksnapr.app"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-slate-400 shrink-0 hover:text-slate-600 transition-colors"
            >
              Powered by SnapKeep
            </a>
          )}
        </div>

        {/* Share buttons — visible only after done event */}
        {showShareButtons && (
          <Suspense fallback={null}>
            <ShareButtons
              url={url}
              title={title}
              summary={summary}
              shareUrl={cardId ? `${window.location.origin}/s/${cardId}` : undefined}
            />
          </Suspense>
        )}

        {/* SnapGIF — Pro downloads, free teaser handled inside SnapGifButton */}
        {status === 'complete' && (
          <Suspense fallback={null}>
            <SnapGifButton url={url} isPro={isPro} onUpgradeNeeded={onUpgradeNeeded} />
          </Suspense>
        )}

      </div>
    </article>
  )
}
