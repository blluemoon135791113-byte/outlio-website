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
