import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * FastSpring signs the exact bytes of the webhook body with HMAC-SHA256 and
 * sends the base64 digest in `X-FS-Signature`.
 *
 * The raw body must be verified before it is parsed — parsing and re-serializing
 * changes the bytes and invalidates the digest.
 */
export function verifyFastSpringSignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature) return false

  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest()

  let received: Buffer
  try {
    received = Buffer.from(signature, 'base64')
  } catch {
    return false
  }

  // timingSafeEqual throws on a length mismatch, which is itself a rejection.
  if (received.length !== expected.length) return false
  return timingSafeEqual(received, expected)
}
