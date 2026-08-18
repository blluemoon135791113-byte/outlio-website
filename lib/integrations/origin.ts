import 'server-only'

/**
 * The origins allowed to initiate an integration action.
 *
 * ⚠️ THIS IS A CSRF BOUNDARY, NOT A CONVENIENCE. Integration routes mutate
 * stored credentials and push customer data to third parties. Checking the
 * `Origin` header against an allow-list is what stops another site from driving
 * those routes with a signed-in user's cookies.
 *
 * Lived in `lib/integrations/hubspot.ts` until HubSpot and Salesforce were
 * removed. Nothing about it was ever HubSpot-specific — it is here so a
 * provider being dropped cannot take a security check with it.
 */

/** Only these origins can initiate OAuth or receive a post-callback redirect. */
export function isApprovedOutlioAppOrigin(value: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }

  /*
   * Compared on ORIGIN, never by prefix or suffix. `https://outlio.io.attacker.test`
   * starts with our domain and is not us; `startsWith` here would be a hole.
   */
  if (parsed.origin === 'https://outlio.io' || parsed.origin === 'https://app.outlio.io') {
    return true
  }

  // localhost is a development affordance and must never be one in production.
  return process.env.NODE_ENV !== 'production' && parsed.origin === 'http://localhost:3000'
}
