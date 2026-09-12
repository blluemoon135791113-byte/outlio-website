/**
 * One-click unsubscribe tokens — M6 Phase 17.
 *
 * M6 ACCEPTANCE CRITERION 2: "unsubscribe link works one-click, updates
 * suppression, stops applicable campaigns, records events."
 *
 * These tokens travel in the body of every marketing email, which makes them
 * the most widely distributed secret-derived value in the product. A forgeable
 * token would let anyone unsubscribe anyone.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createUnsubscribeToken,
  unsubscribeHeaders,
  unsubscribeUrl,
  verifyUnsubscribeToken,
} from '@/lib/email/unsubscribe'

const SUBJECT = {
  workspaceId: '11111111-1111-1111-1111-111111111111',
  email: 'dana@buyer.example',
  campaignId: '22222222-2222-2222-2222-222222222222',
}

beforeEach(() => {
  vi.stubEnv('UNSUBSCRIBE_TOKEN_SECRET', 'a-test-secret-that-is-long-enough')
})

describe('tokens round-trip', () => {
  it('verifies a token it created', () => {
    const result = verifyUnsubscribeToken(createUnsubscribeToken(SUBJECT))
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.subject.email).toBe('dana@buyer.example')
      expect(result.subject.campaignId).toBe(SUBJECT.campaignId)
    }
  })

  it('carries a null campaign as unsubscribe-from-everything', () => {
    const token = createUnsubscribeToken({ ...SUBJECT, campaignId: null })
    const result = verifyUnsubscribeToken(token)
    expect(result.valid).toBe(true)
    if (result.valid) expect(result.subject.campaignId).toBeNull()
  })

  it('normalises the address', () => {
    const token = createUnsubscribeToken({ ...SUBJECT, email: '  Dana@Buyer.Example ' })
    const result = verifyUnsubscribeToken(token)
    if (result.valid) expect(result.subject.email).toBe('dana@buyer.example')
  })
})

describe('tokens cannot be forged', () => {
  it('rejects a tampered payload', () => {
    // Swapping in someone else's address must invalidate the signature.
    const token = createUnsubscribeToken(SUBJECT)
    const [, signature] = token.split('.')
    const forgedPayload = Buffer.from(
      `u1:${SUBJECT.workspaceId}:victim@buyer.example:${SUBJECT.campaignId}`,
      'utf8',
    ).toString('base64url')

    expect(verifyUnsubscribeToken(`${forgedPayload}.${signature}`).valid).toBe(false)
  })

  it('rejects a tampered signature', () => {
    const token = createUnsubscribeToken(SUBJECT)
    const [payload, signature] = token.split('.')
    const flipped = signature!.slice(0, -1) + (signature!.endsWith('A') ? 'B' : 'A')
    expect(verifyUnsubscribeToken(`${payload}.${flipped}`).valid).toBe(false)
  })

  it('rejects a token signed with a different secret', () => {
    const token = createUnsubscribeToken(SUBJECT)
    vi.stubEnv('UNSUBSCRIBE_TOKEN_SECRET', 'a-completely-different-secret-value')
    expect(verifyUnsubscribeToken(token).valid).toBe(false)
  })

  it.each([
    ['', 'empty'],
    ['garbage', 'no separator'],
    ['a.b.c', 'too many parts'],
    ['.signature', 'no payload'],
    ['payload.', 'no signature'],
  ])('rejects %s (%s)', (token) => {
    expect(verifyUnsubscribeToken(token).valid).toBe(false)
  })

  it('rejects a token whose version does not match', () => {
    // A future v2 format must fail closed rather than being parsed as v1.
    const payload = Buffer.from(
      `u2:${SUBJECT.workspaceId}:dana@buyer.example:all`,
      'utf8',
    ).toString('base64url')
    expect(verifyUnsubscribeToken(`${payload}.anything`).valid).toBe(false)
  })
})

describe('RFC 8058 headers', () => {
  it('emits BOTH required headers', () => {
    /*
     * ⚠️ `List-Unsubscribe-Post` is the one people forget. Without it Gmail
     * treats the link as an ordinary URL and will not show its native
     * unsubscribe button — which is the button recipients press INSTEAD of
     * "report spam".
     */
    const headers = unsubscribeHeaders(SUBJECT, 'https://app.outlio.io')
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    expect(headers['List-Unsubscribe']).toMatch(/^<https:\/\/app\.outlio\.io\/u\/.+>$/)
  })

  it('produces a URL whose token verifies', () => {
    const url = unsubscribeUrl(SUBJECT, 'https://app.outlio.io/')
    const token = url.split('/u/')[1]!
    expect(verifyUnsubscribeToken(token).valid).toBe(true)
  })

  it('does not double up the slash on a trailing-slash base URL', () => {
    expect(unsubscribeUrl(SUBJECT, 'https://app.outlio.io/')).not.toContain('io//u/')
  })

  it('produces a URL-safe token', () => {
    // base64url only: anything else would break inside a header or a href.
    const token = createUnsubscribeToken(SUBJECT)
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  })
})

/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE SUPPRESSION GATE IS COVERED ONLY BY A TEST THAT NEEDS DOCKER.       ║
 * ║                                                                           ║
 * ║  Found by mutation testing: deleting the suppression check from           ║
 * ║  `enqueueEmail` leaves all 3,019 UNIT tests green. The behavioural proof  ║
 * ║  lives in `email-send-worker.test.ts`, which needs GreenMail and is       ║
 * ║  skipped wherever Docker is absent — so `npm test`, the fast loop people  ║
 * ║  actually run before committing, says nothing about it.                   ║
 * ║                                                                           ║
 * ║  What that guard prevents is mailing someone who unsubscribed or hard-    ║
 * ║  bounced: a CAN-SPAM violation and the quickest way to burn a sending     ║
 * ║  domain. Structural, in the same spirit as the `isOwnOutbound` check in   ║
 * ║  `email-auto-reply.test.ts`, and for the same reason.                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
describe('the suppression gate is wired into enqueueEmail', () => {
  const source = readFileSync(join(__dirname, '..', '..', 'lib/email/send.ts'), 'utf8')

  it('refuses a suppressed recipient at enqueue', () => {
    /*
     * ⚠️ REPOINTED, NOT RELAXED. This matched the single-lookup shape
     * `if (suppressed) return ...`, which stopped existing when the check grew
     * a second lookup so that a suppression recorded against a CONTACT stops a
     * send to any of that person's addresses (0120). The defect it guards is
     * unchanged — enqueue must still refuse — so the assertion follows the
     * code rather than being deleted for going red.
     */
    expect(
      /if \(byEmail\.data \|\| byContact\.data\)\s*return \{ queued: false, reason: 'suppressed' \}/.test(
        source,
      ),
      'enqueueEmail no longer refuses suppressed recipients, so an unsubscribed or ' +
        'hard-bounced address can be mailed again.',
    ).toBe(true)
  })

  it('reads the suppression list before queueing anything', () => {
    /*
     * Order is the guarantee. Checked after the insert, the message is already
     * in the queue and the claim-time check becomes the only thing standing
     * between a suppressed address and a send.
     */
    /*
     * ⚠️ ANCHORED ON THE STATEMENT, NOT THE STRING. `reason: 'suppressed'`
     * also appears in the return-type union near the top of the file, so
     * searching for it found the TYPE and reported the guard as running before
     * the lookup. The same mistake shape as taking the first `{` of a function
     * and calling it the body.
     */
    const lookup = source.indexOf("from('email_suppressions')")
    const gate = source.indexOf('if (byEmail.data || byContact.data) return')
    expect(lookup).toBeGreaterThan(-1)
    expect(gate).toBeGreaterThan(-1)
    expect(gate).toBeGreaterThan(lookup)
  })
})
