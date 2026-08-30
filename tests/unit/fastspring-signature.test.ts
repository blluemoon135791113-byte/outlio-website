import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { verifyFastSpringSignature } from '@/lib/fastspring/signature'

const SECRET = 'fastspring-hmac-secret'
const BODY = '{"events":[{"id":"evt_1","type":"order.completed"}]}'

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('base64')
}

describe('verifyFastSpringSignature', () => {
  it('accepts a base64 HMAC-SHA256 digest of the exact body', () => {
    expect(verifyFastSpringSignature(BODY, sign(BODY), SECRET)).toBe(true)
  })

  it('rejects a missing signature', () => {
    expect(verifyFastSpringSignature(BODY, null, SECRET)).toBe(false)
  })

  it('rejects a digest produced with a different secret', () => {
    expect(verifyFastSpringSignature(BODY, sign(BODY, 'wrong-secret'), SECRET)).toBe(false)
  })

  it('rejects a body altered after signing, down to one byte of whitespace', () => {
    expect(verifyFastSpringSignature(`${BODY} `, sign(BODY), SECRET)).toBe(false)
  })

  it('rejects a signature of the wrong length instead of throwing', () => {
    expect(verifyFastSpringSignature(BODY, 'c2hvcnQ=', SECRET)).toBe(false)
  })
})
