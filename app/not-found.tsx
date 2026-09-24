import { headers } from 'next/headers'
import Link from 'next/link'

import { isAppHost } from '@/lib/site'

const APP_SITE_MAP = [
  { title: 'Home', href: '/' },
  { title: 'Product', href: '/product' },
  { title: 'How it works', href: '/how-it-works' },
  { title: 'Pricing', href: '/pricing' },
  { title: 'Terms', href: '/terms' },
  { title: 'Privacy', href: '/privacy-policy' },
]

const AGENCY_SITE_MAP = [
  { title: 'Home', href: '/' },
  { title: 'Explainers', href: '/explainers' },
  { title: 'Terms', href: '/terms' },
  { title: 'Privacy', href: '/privacy' },
]

export default async function NotFound() {
  const appSurface = isAppHost((await headers()).get('host'))
  const siteMap = appSurface ? APP_SITE_MAP : AGENCY_SITE_MAP

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6 py-16 text-[var(--foreground)]"
    >
      <section className="w-full max-w-xl rounded-[2rem] border border-black/5 bg-white/70 p-8 text-center shadow-[10px_10px_24px_rgba(149,137,116,0.16),-10px_-10px_24px_rgba(255,255,255,0.8)] backdrop-blur-xl sm:p-12">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-black/45">
          Error 404
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
          This page wandered off.
        </h1>
        <p className="mx-auto mt-5 max-w-md text-base leading-7 text-black/60">
          The address may have changed, or the page may no longer exist.
          {appSurface ? ' Your workspace and saved research are unaffected.' : ''}
        </p>

        <h2 className="mt-8 text-xl font-medium tracking-tight text-black">Site map</h2>
        <ul className="mx-auto mt-4 max-w-md space-y-2 text-left">
          {siteMap.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="text-ink/80 transition hover:text-ink">
                {item.title}
              </Link>
            </li>
          ))}
        </ul>

        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            href="/"
            className="rounded-2xl border border-black/10 bg-white/70 px-6 py-3 text-sm font-semibold transition hover:bg-white"
          >
            Go to homepage
          </Link>
          <Link
            href={appSurface ? '/sign-in' : '/explainers'}
            className="rounded-2xl bg-black px-6 py-3 text-sm font-semibold text-white transition hover:bg-black/80"
          >
            {appSurface ? 'Sign in' : 'View explainers'}
          </Link>
        </div>
      </section>
    </main>
  )
}
