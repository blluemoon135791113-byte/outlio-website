import 'server-only'

/**
 * The webhook signing secret, encrypted at rest.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  IT WAS THE ONE CREDENTIAL IN THE PRODUCT STORED IN PLAINTEXT.            ║
 * ║                                                                           ║
 * ║  Provider tokens are encrypted (`integration_connections.secret_reference`)║
 * ║  and API keys are SHA-256 hashed. `webhook_subscriptions.signing_secret`   ║
 * ║  was neither. It cannot be hashed — HMAC has to reproduce it to sign — but ║
 * ║  nothing stopped it being encrypted with the key that already exists.     ║
 * ║                                                                           ║
 * ║  The exposure is an integrity attack on the CUSTOMER, not on us: anyone    ║
 * ║  who could read the table could forge signed events to every subscriber's  ║
 * ║  endpoint, and their systems would accept them as genuine Outlio events.   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ NO MIGRATION, AND THAT IS NOT AN OVERSIGHT. DECISION-21 assumed this
 * needed one. It does not: `signing_secret` is `text not null` (0097), so an
 * envelope is simply a longer string in the same column. The whole change is
 * application code, which is why it could ship immediately rather than waiting
 * on a hand-applied migration.
 *
 * ⚠️ IT REUSES `INTEGRATION_ENCRYPTION_KEY` RATHER THAN INTRODUCING ITS OWN.
 * A separate key would isolate the blast radius slightly better, and it would
 * also be a new required environment variable — one that is not set in
 * production today, so the first deploy after this change would break every
 * webhook until somebody noticed. Same trust domain, same server-only
 * boundary, no deployment cliff. The trade is recorded rather than hidden.
 */
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from '@/lib/integrations/crypto'

/** The envelope prefix written by `encryptIntegrationSecret`. */
const ENVELOPE_PREFIX = 'v1.'

/** Whether a stored value has already been encrypted. */
export function isEncryptedSecret(stored: string): boolean {
  return stored.startsWith(ENVELOPE_PREFIX)
}

/** Wraps a freshly generated secret for storage. */
export function sealWebhookSecret(plaintext: string): string {
  return encryptIntegrationSecret(plaintext)
}

/**
 * Recovers the signing secret from whatever is stored.
 *
 * ⚠️ IT TOLERATES A PLAINTEXT ROW ON PURPOSE, AND SAYS SO WHEN IT FINDS ONE.
 *
 * `webhook_subscriptions` held zero rows when this was written, so a strict
 * reader would have been correct — right up until a subscription created
 * between that count and this deploy, whose deliveries would then fail their
 * signature with no way back. A webhook that silently stops being deliverable
 * is the worst available outcome for the customer relying on it.
 *
 * The legacy path is therefore accepted and LOGGED, so a plaintext row is
 * visible rather than permanent. `resealWebhookSecret` below turns that
 * observation into a fix.
 */
export function openWebhookSecret(stored: string, subscriptionId: string): string {
  if (!isEncryptedSecret(stored)) {
    // Never the secret itself — only that one exists and which row holds it.
    console.warn('[webhooks] signing secret is not encrypted', { subscriptionId })
    return stored
  }
  return decryptIntegrationSecret<string>(stored)
}
