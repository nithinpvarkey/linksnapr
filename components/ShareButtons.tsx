'use client'

import { useState, useRef, useEffect } from 'react'
import type { JSX } from 'react'
import { trackEvent } from '@/lib/analytics'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShareButtonsProps {
  url:       string
  title:     string
  summary:   string
  shareUrl?: string   // card share URL (linksnapr.app/s/[id]) — overrides window.location.href
}

type ToastState = 'idle' | 'copied' | 'slack'

// ─── Icons ────────────────────────────────────────────────────────────────────

function LinkIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 12a4 4 0 005.66 0l2-2a4 4 0 00-5.66-5.66l-1 1" />
      <path d="M12 8a4 4 0 00-5.66 0l-2 2a4 4 0 005.66 5.66l1-1" />
    </svg>
  )
}

function CheckIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 10l4 4 8-8" />
    </svg>
  )
}

function WhatsAppIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.978-1.418A9.956 9.956 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"
        fill="#25D366"
      />
      <path
        d="M17.04 14.385c-.274-.137-1.62-.799-1.871-.89-.251-.09-.434-.136-.617.137-.182.273-.707.89-.867 1.072-.16.183-.319.205-.593.069-.274-.137-1.156-.426-2.202-1.358-.814-.726-1.364-1.622-1.524-1.895-.16-.274-.017-.422.12-.558.123-.123.274-.32.41-.48.137-.16.183-.274.274-.457.092-.182.046-.342-.023-.48-.069-.136-.617-1.487-.845-2.036-.223-.535-.449-.463-.617-.471l-.525-.01c-.183 0-.48.069-.73.342-.252.274-.96.938-.96 2.287 0 1.35.983 2.653 1.12 2.836.136.182 1.934 2.952 4.686 4.14.655.283 1.166.452 1.564.578.657.209 1.255.18 1.728.11.527-.079 1.62-.663 1.849-1.303.228-.64.228-1.19.16-1.303-.069-.114-.251-.183-.525-.32z"
        fill="white"
      />
    </svg>
  )
}

function TwitterIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M14.75 3h2.5L11 9.27 18.25 17h-4.46L9.87 12.43 5.2 17H2.7l6.61-7.56L2.75 3h4.57l3.56 4.41L14.75 3zm-.89 12.6h1.38L6.16 4.36H4.68l9.18 11.24z" />
    </svg>
  )
}

function SlackIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 8h12M4 12h12M8 4v12M12 4v12" />
    </svg>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ShareButtons({ url, title, summary, shareUrl }: ShareButtonsProps): JSX.Element {
  const [toast, setToast] = useState<ToastState>('idle')
  const timerRef          = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [])

  function showToast(type: Exclude<ToastState, 'idle'>): void {
    if (timerRef.current) clearTimeout(timerRef.current)
    setToast(type)
    timerRef.current = setTimeout(() => { setToast('idle') }, 2_000)
  }

  async function handleCopy(): Promise<void> {
    try { await navigator.clipboard.writeText(shareUrl ?? window.location.href) }
    catch { /* clipboard unavailable — silent fail */ }
    trackEvent('share_clicked', { platform: 'copy', user_tier: 'free' })
    showToast('copied')
  }

  async function handleSlack(): Promise<void> {
    const link    = shareUrl ?? url
    const message = `*${title}*\n${summary}\n${link}`
    try { await navigator.clipboard.writeText(message) }
    catch { /* clipboard unavailable — silent fail */ }
    trackEvent('share_clicked', { platform: 'slack', user_tier: 'free' })
    showToast('slack')
  }

  const link        = shareUrl ?? url
  const waText      = title ? `${title} — ` : ''
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(`${waText}${link}`)}`
  const twitterText = title ? title.slice(0, 100) : 'Check this out'
  const twitterUrl  = shareUrl
    ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(twitterText)}&url=${encodeURIComponent(shareUrl)}`
    : `https://twitter.com/intent/tweet?text=${encodeURIComponent(twitterText)}&url=${encodeURIComponent(url)}`

  const base    = 'flex items-center justify-center rounded-lg p-2.5 min-h-[44px] min-w-[44px] transition-colors'
  const idle    = `${base} bg-slate-100 text-slate-600 hover:bg-slate-200`
  const success = `${base} bg-green-50 text-green-600 hover:bg-green-100`

  return (
    <div>
      <div role="group" aria-label="Share options" className="flex gap-2">

        {/* Copy link */}
        <button
          type="button"
          aria-label="Copy link"
          onClick={() => { void handleCopy() }}
          className={toast === 'copied' ? success : idle}
        >
          {toast === 'copied' ? <CheckIcon /> : <LinkIcon />}
        </button>

        {/* WhatsApp */}
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Share on WhatsApp"
          onClick={() => { trackEvent('share_clicked', { platform: 'whatsapp', user_tier: 'free' }) }}
          className={idle}
        >
          <WhatsAppIcon />
        </a>

        {/* Twitter / X */}
        <a
          href={twitterUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Share on Twitter"
          onClick={() => { trackEvent('share_clicked', { platform: 'twitter', user_tier: 'free' }) }}
          className={idle}
        >
          <TwitterIcon />
        </a>

        {/* Slack — copies formatted message to clipboard */}
        <button
          type="button"
          aria-label="Copy for Slack"
          onClick={() => { void handleSlack() }}
          className={toast === 'slack' ? success : idle}
        >
          {toast === 'slack' ? <CheckIcon /> : <SlackIcon />}
        </button>

      </div>

      {/* Toast — fixed height prevents layout shift when message appears */}
      <div aria-live="polite" className="h-5 mt-1">
        {toast !== 'idle' && (
          <p className="text-sm text-green-600">
            {toast === 'copied' ? 'Link copied!' : 'Copied for Slack!'}
          </p>
        )}
      </div>
    </div>
  )
}
