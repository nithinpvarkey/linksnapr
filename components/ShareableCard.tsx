'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import type { JSX } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShareableCardProps {
  imageUrl: string
  title:    string
  tags:     string[]
  summary:  string
  url:      string
  domain:   string
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ShareableCard({
  imageUrl,
  title,
  tags,
  summary,
  url,
  domain,
}: ShareableCardProps): JSX.Element {
  const [showOverlay, setShowOverlay] = useState(false)
  const isHoveringRef                 = useRef(false)

  return (
    <article className="w-full max-w-lg rounded-2xl shadow-xl border border-slate-100 bg-white overflow-hidden">

      {/* Image */}
      {imageUrl ? (
        <div
          className="aspect-video w-full relative overflow-hidden cursor-pointer"
          onClick={() => { if (!isHoveringRef.current && summary) setShowOverlay(prev => !prev) }}
          onMouseEnter={() => { isHoveringRef.current = true; if (summary) setShowOverlay(true) }}
          onMouseLeave={() => { isHoveringRef.current = false; setShowOverlay(false) }}
        >
          <Image
            src={imageUrl}
            alt={title ? `Thumbnail for ${title}` : 'Page thumbnail'}
            fill
            className={`object-cover transition-all duration-300 ${showOverlay && summary ? 'scale-105 blur-sm' : 'scale-100'}`}
            unoptimized
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
          <span className="text-5xl font-semibold text-slate-300 select-none">
            {domain[0]?.toUpperCase() ?? '?'}
          </span>
        </div>
      )}

      <div className="p-4 flex flex-col gap-3">

        {/* Title */}
        <h1 className="font-bold text-xl text-slate-900 leading-snug line-clamp-2">
          {title}
        </h1>

        {/* Tags */}
        {tags.length > 0 && (
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
        )}

        {/* Footer — original URL + watermark */}
        <div className="flex items-center justify-between pt-1 border-t border-slate-50 gap-2">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-slate-400 truncate hover:text-slate-600 transition-colors duration-150 min-w-0"
          >
            {url}
          </a>
          <span className="text-xs text-slate-400 shrink-0">
            ⚡ Powered by SnapKeep
          </span>
        </div>

      </div>
    </article>
  )
}
