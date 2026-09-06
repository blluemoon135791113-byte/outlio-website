import 'server-only'

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto'

const VERSION = 'v1'
const ALGORITHM = 'aes-256-gcm'

function encryptionKey(): Buffer {
  const configured = process.env.INTEGRATION_ENCRYPTION_KEY?.trim()
  if (!configured) {
    throw new Error(
      'Missing INTEGRATION_ENCRYPTION_KEY. Generate a 32-byte base64 key with `openssl rand -base64 32`.',
    )
  }

  if (
    configured.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(configured)
  ) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY must be valid base64.')
  }

  const key = Buffer.from(configured, 'base64')
  if (key.toString('base64') !== configured) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY must be valid base64.')
  }

  if (key.length !== 32) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY must decode to exactly 32 bytes.')
  }

  return key
}

/** Encrypts a server-only value into a versioned AES-256-GCM envelope. */
export function encryptIntegrationSecret(value: unknown): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv)
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [
    VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

/** Decrypts an envelope and rejects unknown/corrupt versions without fallback. */
export function decryptIntegrationSecret<T>(envelope: string): T {
  const [version, ivPart, tagPart, ciphertextPart, extra] = envelope.split('.')
  if (
    version !== VERSION ||
    !ivPart ||
    !tagPart ||
    !ciphertextPart ||
    extra !== undefined
  ) {
    throw new Error('Integration credential envelope is invalid.')
  }

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      encryptionKey(),
      Buffer.from(ivPart, 'base64url'),
    )
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, 'base64url')),
      decipher.final(),
    ])
    return JSON.parse(plaintext.toString('utf8')) as T
  } catch {
    throw new Error('Integration credential envelope could not be decrypted.')
  }
}
