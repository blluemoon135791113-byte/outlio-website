/**
 * Sending accounts — M5 Phase 11.
 *
 * M5 ACCEPTANCE CRITERION 1: "secrets unreadable via any API after save;
 * encryption verified."
 *
 * ⚠️ THE TWO HALVES ARE PROVEN ELSEWHERE, DELIBERATELY NOT RE-PROVEN HERE.
 *   - Unreadable: `supabase/smoke/0085_email_accounts.sql` runs four different
 *     read shapes as the `authenticated` role — direct, joined, by
 *     secret_reference, and column-only — and shows all four denied.
 *   - Encryption: `tests/unit/integration-crypto.test.ts` already covers
 *     round-trip, absence of plaintext, per-envelope nonce, wrong key,
 *     tampered ciphertext and key length. Email accounts reuse that exact
 *     envelope, so copying those assertions here would add maintenance without
 *     adding safety.
 *
 * What is left is the one uncovered branch of the envelope, and the address
 * parsing that Phase 13's per-domain health rollup is built on.
 */
import { describe, expect, it, vi } from 'vitest'

import { normalizeSendingAddress } from '@/lib/email/accounts'
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from '@/lib/integrations/crypto'

const KEY = Buffer.alloc(32, 7).toString('base64')

describe('the credential envelope has no fallback path', () => {
  it('refuses an unknown version rather than guessing the format', () => {
    vi.stubEnv('INTEGRATION_ENCRYPTION_KEY', KEY)
    const envelope = encryptIntegrationSecret({ accessToken: 'ya29.SECRET' })

    // A future v2 format must fail closed. Attempting a v1 parse on a v2
    // envelope is how a rotation bug turns into a credential that silently
    // decrypts to the wrong thing.
    expect(() => decryptIntegrationSecret(`v2${envelope.slice(2)}`)).toThrow()
  })
})

describe('sending address normalization', () => {
  it('lowercases the whole address', () => {
    expect(normalizeSendingAddress('Sales@Acme.Example')).toEqual({
      email: 'sales@acme.example',
      domain: 'acme.example',
    })
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeSendingAddress('  sales@acme.example  ')?.email).toBe('sales@acme.example')
  })

  it('splits on the LAST @, not the first', () => {
    /*
     * `"a@b"@example.com` is a legal address with a quoted local part.
     * Splitting on the first @ files it under the domain `b"@example.com`,
     * which corrupts the per-domain health rollup Phase 13 builds on — it
     * would surface as one domain's reputation being attributed to another.
     */
    expect(normalizeSendingAddress('"a@b"@example.com')?.domain).toBe('example.com')
  })

  it('rejects an address with no domain', () => {
    expect(normalizeSendingAddress('sales@')).toBeNull()
    expect(normalizeSendingAddress('sales')).toBeNull()
  })

  it('rejects an address with no local part', () => {
    expect(normalizeSendingAddress('@acme.example')).toBeNull()
  })

  it('rejects a domain with no dot', () => {
    // `postmaster@localhost` cannot receive a reply from the internet, so
    // accepting it would only produce a mailbox that fails on first send.
    expect(normalizeSendingAddress('sales@localhost')).toBeNull()
  })

  it('rejects a malformed domain', () => {
    expect(normalizeSendingAddress('sales@.example')).toBeNull()
    expect(normalizeSendingAddress('sales@acme.')).toBeNull()
  })

  it('keeps subdomains intact, since they carry their own reputation', () => {
    expect(normalizeSendingAddress('rep@mail.acme.example')?.domain).toBe('mail.acme.example')
  })
})
