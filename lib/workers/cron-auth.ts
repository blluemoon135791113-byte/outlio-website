/**
 * The cron endpoint's guard — R10, split from `app/api/cron/route.ts`.
 *
 * Next's generated route types assert that a `route.ts` exports nothing but
 * HTTP handlers and config, so the guard — which is exported so it can be
 * tested directly — needs a home outside the route file. It lives here, next
 * to the tick it protects.
 */
import { timingSafeEqual } from 'node:crypto'

export function isAuthorizedCronRequest(
  authorizationHeader: string | null,
  secret: string | undefined,
): boolean {
  // ⚠️ NO SECRET MEANS REFUSE, never "allow because it is not configured".
  if (!secret) return false

  const provided = Buffer.from(authorizationHeader ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)

  /*
   * ⚠️ CONSTANT-TIME. A `===` on a secret leaks its length and prefix through
   * timing, which is enough to recover it given enough attempts — and a cron
   * endpoint is exactly the kind of thing nobody watches closely enough to
   * notice those attempts. The length check is unavoidable and leaks only the
   * length, which `timingSafeEqual` requires to be equal anyway.
   */
  if (provided.length !== expected.length) return false
  return timingSafeEqual(provided, expected)
}
