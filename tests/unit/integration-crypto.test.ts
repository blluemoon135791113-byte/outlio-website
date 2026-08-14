import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from '@/lib/integrations/crypto'

const KEY = Buffer.alloc(32, 7).toString('base64')
const OTHER_KEY = Buffer.alloc(32, 8).toString('base64')

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('integration credential encryption', () => {
  it('round-trips credentials without placing plaintext in the envelope', () => {
    vi.stubEnv('INTEGRATION_ENCRYPTION_KEY', KEY)
    const payload = {
      accessToken: 'access-secret-value',
      refreshToken: 'refresh-secret-value',
    }

    const encrypted = encryptIntegrationSecret(payload)

    expect(encrypted.startsWith('v1.')).toBe(true)
    expect(encrypted).not.toContain(payload.accessToken)
    expect(encrypted).not.toContain(payload.refreshToken)
    expect(decryptIntegrationSecret(encrypted)).toEqual(payload)
  })

  it('uses a fresh nonce for every envelope', () => {
    vi.stubEnv('INTEGRATION_ENCRYPTION_KEY', KEY)
    expect(encryptIntegrationSecret({ value: 'same' })).not.toBe(
      encryptIntegrationSecret({ value: 'same' }),
    )
  })

  it('rejects a missing or wrong key and tampered ciphertext', () => {
    vi.stubEnv('INTEGRATION_ENCRYPTION_KEY', KEY)
    const encrypted = encryptIntegrationSecret({ value: 'secret' })

    vi.stubEnv('INTEGRATION_ENCRYPTION_KEY', OTHER_KEY)
    expect(() => decryptIntegrationSecret(encrypted)).toThrow(
      'could not be decrypted',
    )

    vi.stubEnv('INTEGRATION_ENCRYPTION_KEY', KEY)
    const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith('A') ? 'B' : 'A'}`
    expect(() => decryptIntegrationSecret(tampered)).toThrow(
      'could not be decrypted',
    )
  })

  it('rejects keys that are not exactly 32 bytes', () => {
    vi.stubEnv('INTEGRATION_ENCRYPTION_KEY', Buffer.alloc(31).toString('base64'))
    expect(() => encryptIntegrationSecret('secret')).toThrow(
      'exactly 32 bytes',
    )
  })
})
