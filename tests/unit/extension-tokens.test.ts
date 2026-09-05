/**
 * Extension token security.
 *
 * These tokens are the ONLY thing standing between a public, fully-readable
 * extension and a user's lead database. Every negative case below is an attack
 * someone will try once the extension is on a store.
 */
import { beforeAll, describe, expect, it } from 'vitest'

beforeAll(() => {
  process.env.EXTENSION_TOKEN_SECRET = 'test-secret-not-a-real-key'
})

const USER = '11111111-1111-4111-8111-111111111111'
const DEVICE = '22222222-2222-4222-8222-222222222222'
const JTI = '33333333-3333-4333-8333-333333333333'

async function tokens() {
  return import('@/lib/extension/tokens')
}

describe('access token round trip', () => {
  it('verifies a token it just minted', async () => {
    const { mintAccessToken, verifyAccessToken } = await tokens()
    const token = mintAccessToken(USER, DEVICE, JTI)!
    const claims = verifyAccessToken(token)

    expect(claims).not.toBeNull()
    expect(claims!.sub).toBe(USER)
    expect(claims!.did).toBe(DEVICE)
    expect(claims!.jti).toBe(JTI)
  })

  it('expires exactly 15 minutes after issue', async () => {
    const { mintAccessToken, verifyAccessToken, ACCESS_TOKEN_TTL_SECONDS } = await tokens()
    const now = 1_000_000
    const token = mintAccessToken(USER, DEVICE, JTI, now)!

    expect(verifyAccessToken(token, now + ACCESS_TOKEN_TTL_SECONDS - 1)).not.toBeNull()
    expect(verifyAccessToken(token, now + ACCESS_TOKEN_TTL_SECONDS)).toBeNull()
  })
})

describe('forgery is rejected', () => {
  it('rejects a token whose claims were edited', async () => {
    const { mintAccessToken, verifyAccessToken } = await tokens()
    const token = mintAccessToken(USER, DEVICE, JTI)!
    const [, signature] = token.split('.')

    // Swap in another user's id, keeping the original signature.
    const forged = Buffer.from(
      JSON.stringify({
        sub: '99999999-9999-4999-8999-999999999999',
        did: DEVICE,
        jti: JTI,
        iat: 1,
        exp: 9_999_999_999,
      }),
    ).toString('base64url')

    expect(verifyAccessToken(`${forged}.${signature}`)).toBeNull()
  })

  it('rejects a tampered signature', async () => {
    const { mintAccessToken, verifyAccessToken } = await tokens()
    const token = mintAccessToken(USER, DEVICE, JTI)!
    const [payload, signature] = token.split('.')
    const flipped = signature!.slice(0, -1) + (signature!.endsWith('A') ? 'B' : 'A')

    expect(verifyAccessToken(`${payload}.${flipped}`)).toBeNull()
  })

  it('rejects an unsigned token', async () => {
    const { verifyAccessToken } = await tokens()
    const payload = Buffer.from(
      JSON.stringify({ sub: USER, did: DEVICE, jti: JTI, iat: 1, exp: 9_999_999_999 }),
    ).toString('base64url')

    expect(verifyAccessToken(payload)).toBeNull()
    expect(verifyAccessToken(`${payload}.`)).toBeNull()
  })

  it('rejects malformed input without throwing', async () => {
    const { verifyAccessToken } = await tokens()
    for (const bad of ['', '.', 'a.b.c', 'not-base64!.sig', '{}']) {
      expect(verifyAccessToken(bad)).toBeNull()
    }
  })
})

describe('stored secrets', () => {
  it('hashes tokens rather than storing them', async () => {
    const { hashToken, mintRefreshToken } = await tokens()
    const token = mintRefreshToken()
    const hash = hashToken(token)!

    expect(hash).not.toContain(token)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic, so a presented token can be matched', async () => {
    const { hashToken } = await tokens()
    expect(hashToken('same-token')).toBe(hashToken('same-token'))
  })

  it('separates distinct tokens', async () => {
    const { hashToken } = await tokens()
    expect(hashToken('token-a')).not.toBe(hashToken('token-b'))
  })

  it('mints refresh tokens with real entropy and no collisions', async () => {
    const { mintRefreshToken } = await tokens()
    const seen = new Set(Array.from({ length: 500 }, () => mintRefreshToken()))
    expect(seen.size).toBe(500)
    for (const t of seen) expect(t.length).toBeGreaterThanOrEqual(32)
  })
})

describe('bearer parsing', () => {
  it('accepts the standard header', async () => {
    const { bearerFrom } = await tokens()
    expect(bearerFrom('Bearer abc.def')).toBe('abc.def')
    expect(bearerFrom('bearer abc.def')).toBe('abc.def')
    expect(bearerFrom('  Bearer   abc.def  ')).toBe('abc.def')
  })

  it('rejects anything else', async () => {
    const { bearerFrom } = await tokens()
    for (const bad of [null, '', 'Basic abc', 'abc.def', 'Bearer', 'Bearer   ']) {
      expect(bearerFrom(bad)).toBeNull()
    }
  })
})
