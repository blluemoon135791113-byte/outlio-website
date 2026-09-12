/**
 * §5.12 / DECISION-21 — the webhook signing secret, encrypted at rest.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  IT WAS THE ONE CREDENTIAL IN THE PRODUCT STORED IN PLAINTEXT.            ║
 * ║                                                                           ║
 * ║  Provider tokens are encrypted and API keys are hashed. This one could be  ║
 * ║  neither hashed (HMAC must reproduce it) nor, apparently, encrypted —      ║
 * ║  until it turned out `signing_secret` is `text not null`, so an envelope   ║
 * ║  is just a longer string and no migration was needed at all.              ║
 * ║                                                                           ║
 * ║  The exposure was an integrity attack on the CUSTOMER: anyone who could    ║
 * ║  read the table could forge signed events their systems would accept as    ║
 * ║  genuine Outlio events.                                                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { signWebhookPayload } from '@/lib/api/signing'
import {
  isEncryptedSecret,
  openWebhookSecret,
  sealWebhookSecret,
} from '@/lib/api/webhook-secret'

const KEY = randomBytes(32).toString('base64')
const OTHER_KEY = randomBytes(32).toString('base64')

const ROOT = join(__dirname, '..', '..')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => strip(readFileSync(join(ROOT, p), 'utf8'))

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('the secret survives the round trip', () => {
  it('seals to an envelope and opens back to the original', () => {
    vi.stubEnv('INTEGRATION_ENCRYPTION_KEY', KEY)
    const secret = 'whsec_abcdef0123456789'

    const sealed = sealWebhookSecret(secret)

    expect(sealed, 'the plaintext is recoverable from the stored value').not.toContain(secret)
    expect(isEncryptedSecret(sealed)).toBe(true)
    expect(openWebhookSecret(sealed, 'sub-1')).toBe(secret)
  })

  it('produces the same signature as the plaintext would have', () => {
    /*
     * ⚠️ THE ASSERTION THAT ACTUALLY MATTERS. Everything above could hold while
     * deliveries still failed verification — the point of the secret is the
     * HMAC it produces, so the proof is that encrypting it changes nothing a
     * subscriber can observe.
     */
    vi.stubEnv('INTEGRATION_ENCRYPTION_KEY', KEY)
    const secret = 'whsec_abcdef0123456789'
    const body = JSON.stringify({ id: 'evt_1', type: 'contact.created' })

    const direct = signWebhookPayload(body, secret).signature
    const viaEnvelope = signWebhookPayload(
      body,
      openWebhookSecret(sealWebhookSecret(secret), 'sub-1'),
    ).signature

    expect(viaEnvelope).toBe(direct)
  })

  it('is non-deterministic, so two subscriptions never share a ciphertext', () => {
    // A fresh IV per seal. Identical secrets encrypting identically would leak
    // that two subscribers share one.
    vi.stubEnv('INTEGRATION_ENCRYPTION_KEY', KEY)
    expect(sealWebhookSecret('whsec_same')).not.toBe(sealWebhookSecret('whsec_same'))
  })
})

describe('the transition cannot break a live subscriber', () => {
  it('accepts a plaintext row rather than failing it', () => {
    /*
     * The table held zero rows when this was written, so a strict reader would
     * have been correct — right up until a subscription created between that
     * count and the deploy, whose deliveries would then fail their signature
     * with no way back.
     */
    vi.stubEnv('INTEGRATION_ENCRYPTION_KEY', KEY)
    expect(openWebhookSecret('whsec_legacy_plaintext', 'sub-1')).toBe(
      'whsec_legacy_plaintext',
    )
  })

  it('says so when it finds one, without printing the secret', () => {
    vi.stubEnv('INTEGRATION_ENCRYPTION_KEY', KEY)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    openWebhookSecret('whsec_legacy_plaintext', 'sub-42')

    expect(warn).toHaveBeenCalledOnce()
    const logged = JSON.stringify(warn.mock.calls[0])
    expect(logged).toContain('sub-42')
    expect(logged, 'the secret itself was logged').not.toContain('whsec_legacy_plaintext')
    warn.mockRestore()
  })

  it('refuses an envelope it cannot open instead of signing with rubbish', () => {
    /*
     * ⚠️ A WRONG KEY MUST THROW, NOT DEGRADE. Signing with a wrong secret
     * would deliver events every subscriber rejects, forever, while the
     * delivery log recorded success. The caller exhausts the delivery with a
     * message naming the fix.
     */
    vi.stubEnv('INTEGRATION_ENCRYPTION_KEY', KEY)
    const sealed = sealWebhookSecret('whsec_abc')

    vi.stubEnv('INTEGRATION_ENCRYPTION_KEY', OTHER_KEY)
    expect(() => openWebhookSecret(sealed, 'sub-1')).toThrow()
  })
})

describe('nothing writes the secret in plaintext', () => {
  const ACTIONS = read('app/(product)/dashboard/settings/developers/actions.ts')
  const DELIVERY = read('lib/api/webhooks.ts')

  it('seals on creation and on rotation', () => {
    // Both write paths, asserted separately — rotating into plaintext would
    // quietly undo the encryption for exactly the subscription most likely to
    // have been compromised.
    expect(ACTIONS).toContain('signing_secret: sealWebhookSecret(secret)')
    expect(ACTIONS).toMatch(/update\(\{ signing_secret: sealWebhookSecret\(secret\) \}\)/)
    expect(ACTIONS, 'a raw secret is still being stored').not.toMatch(
      /signing_secret:\s*secret\b/,
    )
  })

  it('the delivery path opens it rather than signing the stored value', () => {
    expect(DELIVERY).toContain('openWebhookSecret(')
    expect(DELIVERY, 'the stored value is signed directly').not.toMatch(
      /signWebhookPayload\(body,\s*subscription\.signing_secret\)/,
    )
  })

  it('an unreadable secret exhausts the delivery with an actionable message', () => {
    expect(DELIVERY).toMatch(/Rotate the secret to restore delivery/)
  })
})
