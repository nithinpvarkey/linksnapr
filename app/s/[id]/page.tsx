import Link                   from 'next/link'
import { cache }              from 'react'
import type { JSX }           from 'react'
import type { Metadata }      from 'next'
import { getCard }            from '@/lib/cache'
import { ShareableCard }      from '@/components/ShareableCard'

// ─── Request-scoped deduplication ────────────────────────────────────────────
// Both generateMetadata and the page component call getCard with the same id.
// React cache() ensures a single Redis read per request for both consumers.

const fetchCard = cache(getCard)

// ─── Metadata ─────────────────────────────────────────────────────────────────

export async function generateMetadata(
  { params }: { params: { id: string } },
): Promise<Metadata> {
  const card = await fetchCard(params.id)

  if (!card) {
    return {
      title:       'Card not found — LinkSnapr',
      description: 'This card has expired or does not exist.',
    }
  }

  const shareUrl   = `https://linksnapr.app/s/${params.id}`
  const domain     = new URL(card.url).hostname.replace('www.', '')
  const ogImageUrl = `https://linksnapr.app/api/og?title=${encodeURIComponent(card.title)}&tags=${encodeURIComponent(card.tags.join(','))}&domain=${encodeURIComponent(domain)}`

  return {
    title:       card.title,
    description: card.summary,
    openGraph: {
      title:       card.title,
      description: card.summary,
      url:         shareUrl,
      siteName:    'LinkSnapr',
      type:        'website',
      images:      [{ url: ogImageUrl }],
    },
    twitter: {
      card:        'summary_large_image',
      title:       card.title,
      description: card.summary,
      images:      [ogImageUrl],
    },
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function SharePage(
  { params }: { params: { id: string } },
): Promise<JSX.Element> {
  const card = await fetchCard(params.id)

  // ── Not found ───────────────────────────────────────────────────────────────

  if (!card) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <header className="bg-white border-b border-slate-100 py-4 px-4">
          <div className="max-w-lg mx-auto">
            <Link
              href="/"
              className="text-xl font-bold tracking-tight text-slate-900 hover:text-indigo-600 transition-colors duration-150"
            >
              ⚡ LinkSnapr
            </Link>
          </div>
        </header>
        <main className="flex-1 flex flex-col items-center justify-center px-4 gap-5">
          <p className="text-sm text-slate-500 text-center leading-relaxed">
            This card has expired or doesn&apos;t exist.
          </p>
          <Link
            href="/"
            className="text-sm font-medium text-indigo-500 hover:text-indigo-700 transition-colors duration-150"
          >
            Create your own →
          </Link>
        </main>
      </div>
    )
  }

  // ── Card page ───────────────────────────────────────────────────────────────

  const domain = new URL(card.url).hostname.replace('www.', '')

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">

      {/* Header */}
      <header className="bg-white border-b border-slate-100 py-4 px-4">
        <div className="max-w-lg mx-auto">
          <Link
            href="/"
            className="text-xl font-bold tracking-tight text-slate-900 hover:text-indigo-600 transition-colors duration-150"
          >
            ⚡ LinkSnapr
          </Link>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center px-4 py-12 gap-8">

        <ShareableCard
          imageUrl={card.imageUrl}
          title={card.title}
          tags={card.tags}
          summary={card.summary}
          url={card.url}
          domain={domain}
        />

        {/* CTA — acquisition driver */}
        <section className="w-full max-w-lg flex flex-col items-center gap-3">
          <Link
            href="/"
            className="w-full sm:w-auto bg-indigo-500 hover:bg-indigo-600 text-white font-semibold rounded-xl px-8 py-3 min-h-[44px] text-center text-sm transition-colors duration-150"
          >
            Make your own SnapCard →
          </Link>
          <p className="text-xs text-slate-400">Free · No sign-up needed</p>
        </section>

      </main>

      {/* Footer */}
      <footer className="py-6 text-center">
        <Link
          href="/"
          className="text-xs text-slate-400 hover:text-slate-600 transition-colors duration-150"
        >
          Powered by SnapKeep
        </Link>
      </footer>

    </div>
  )
}
