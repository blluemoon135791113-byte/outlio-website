/**
 * Host + canonical URL constants.
 *
 * One deployment serves two domains:
 *
 *   outlio.io      → the agency marketing site (app/page.tsx and friends)
 *   app.outlio.io  → Outlio Lead Engine, the self-serve software product
 *
 * The product is the app domain itself. `app.outlio.io/` IS the Lead Engine
 * homepage and its supporting pages sit directly beneath it — `/pricing`,
 * `/how-it-works`, `/product`, `/terms`, `/privacy-policy`, `/refund-policy`.
 * There is no `/leadengine` segment anywhere in the public URL space; the old
 * paths 301 to their replacements from `next.config.ts`.
 *
 * ⚠️ NEVER redirect a visitor between the two domains. A payment reviewer that
 * lands on app.outlio.io must be able to read every product, pricing and legal
 * page without leaving the domain it was asked to review.
 */

/** The product subdomain. Overridable so previews can point somewhere else. */
export const APP_HOST = process.env.NEXT_PUBLIC_APP_HOST ?? 'app.outlio.io'

/** Canonical origin for every Lead Engine page. */
export const APP_ORIGIN = `https://${APP_HOST}`

/** Canonical origin for the agency marketing site. */
export const SITE_ORIGIN = 'https://outlio.io'

/**
 * Is this request for the product domain?
 *
 * The `app.` prefix is accepted generally so `app.localhost:3000` works in
 * development — browsers resolve any `*.localhost` name to the loopback
 * address, so no hosts-file entry is needed.
 */
export function isAppHost(host: string | null | undefined): boolean {
  if (!host) return false
  const name = host.split(':')[0]?.toLowerCase() ?? ''
  return name === APP_HOST || name.startsWith('app.')
}

/** Absolute canonical URL for a Lead Engine path. `appUrl('/')` → the origin. */
export function appUrl(path = '/'): string {
  return path === '/' ? APP_ORIGIN : `${APP_ORIGIN}${path}`
}
