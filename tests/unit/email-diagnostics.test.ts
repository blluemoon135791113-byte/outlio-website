/**
 * The mailbox diagnostic must never carry a credential out.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ MAIL SERVERS ECHO THE COMMAND THEY REJECTED, AND THE COMMAND CARRIES  ║
 * ║  THE CREDENTIAL. `AUTH PLAIN` fails with its base64 argument attached;    ║
 * ║  `AUTH LOGIN` echoes the username round. A raw provider string in an      ║
 * ║  action response goes into the page, the browser cache, and any error     ║
 * ║  report that captures it.                                                 ║
 * ║                                                                           ║
 * ║  These are the shapes real servers actually return, with a fabricated     ║
 * ║  password planted in each. Every assertion is "the secret is not in the   ║
 * ║  output" — and the positive controls below matter as much, because a      ║
 * ║  scrubber that returns the empty string passes every leak test ever       ║
 * ║  written.                                                                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { describe, expect, it } from 'vitest'

import { classifyImapError, formatDiagnostics, scrubProviderDetail } from '@/lib/email/diagnostics'

const PASSWORD = 'Sup3rSecret-AppPassword-9xQ'
const USERNAME = 'husnain@outlio.io'

describe('scrubProviderDetail', () => {
  it('removes a password echoed after AUTH PLAIN', () => {
    const b64 = Buffer.from(PASSWORD, 'utf8').toString('base64')
    const out = scrubProviderDetail(`535 5.7.8 Authentication failed: AUTH PLAIN ${b64}`, [PASSWORD])
    expect(out).not.toContain(PASSWORD)
    expect(out).not.toContain(b64)
  })

  it('removes a password that appears in plain text', () => {
    const out = scrubProviderDetail(
      `Invalid credentials for user ${USERNAME} with password ${PASSWORD}`,
      [PASSWORD, USERNAME],
    )
    expect(out).not.toContain(PASSWORD)
    expect(out).not.toContain(USERNAME)
  })

  it('removes a base64 blob even when the caller supplies no secret', () => {
    /*
     * ⚠️ THE PATTERN DEFENCE, TESTED WITHOUT THE LITERAL DEFENCE. If a provider
     * invents a format and the caller has nothing to match against, the long
     * unbroken token must still go.
     */
    const b64 = Buffer.from('another-secret-value-entirely', 'utf8').toString('base64')
    const out = scrubProviderDetail(`Rejected: ${b64}`, [])
    expect(out).not.toContain(b64)
    expect(out).toContain('[redacted]')
  })

  it('drops everything after LOGIN, rather than trusting the rest', () => {
    const out = scrubProviderDetail('NO LOGIN husnain hunter2 failed', [])
    expect(out).not.toContain('hunter2')
  })

  it('caps the length, so a transcript cannot arrive disguised as an error', () => {
    const out = scrubProviderDetail('x'.repeat(5000), [])
    expect(out!.length).toBeLessThanOrEqual(201)
  })

  it('ignores a secret too short to match safely', () => {
    /*
     * A 3-character "secret" would redact ordinary words out of every message
     * and make the diagnostic useless. Length floor is deliberate.
     */
    const out = scrubProviderDetail('Connection refused by the server', ['abc'])
    expect(out).toBe('Connection refused by the server')
  })
})

describe('the scrubber still returns something useful', () => {
  /*
   * ⚠️ THE POSITIVE CONTROLS. Returning undefined for everything would pass
   * every assertion above. These prove the output still describes the failure.
   */
  it('keeps an ordinary provider message intact', () => {
    expect(scrubProviderDetail('Connection timed out after 30000ms', [])).toBe(
      'Connection timed out after 30000ms',
    )
  })

  it('keeps the response code, which is the useful part', () => {
    const out = scrubProviderDetail('535 5.7.8 Authentication failed: AUTH PLAIN abcd', [])
    expect(out).toContain('535')
    expect(out).toContain('5.7.8')
  })

  it('returns undefined for nothing, rather than an empty string', () => {
    expect(scrubProviderDetail(undefined, [])).toBeUndefined()
    expect(scrubProviderDetail('   ', [])).toBeUndefined()
  })
})

describe('classifyImapError', () => {
  it('separates a rejected password from an unreachable host', () => {
    // The distinction changes what the reader should do about it.
    expect(classifyImapError({ authenticationFailed: true }).authFailed).toBe(true)
    expect(classifyImapError({ code: 'ECONNREFUSED' }).authFailed).toBe(false)
    expect(classifyImapError({ code: 'ENOTFOUND' }).code).toBe('IMAP_DNS')
  })

  it('never echoes the provider message it was given', () => {
    const out = classifyImapError({ message: `login failed for ${PASSWORD}` })
    expect(JSON.stringify(out)).not.toContain(PASSWORD)
  })
})

describe('formatDiagnostics', () => {
  it('reports SMTP and IMAP separately', () => {
    /*
     * ⚠️ THE WHOLE REASON THIS EXISTS. `testConnection` returns one verdict, so
     * "sending works but replies do not" and "nothing works" read identically.
     */
    const text = formatDiagnostics({
      accountId: 'a',
      fromEmail: 'x@example.com',
      smtp: { connection: 'passed', authentication: 'passed' },
      imap: {
        connection: 'passed',
        authentication: 'failed',
        inbox: 'not_attempted',
        code: 'IMAP_AUTH',
        message: 'rejected',
      },
      send: { attempted: false, accepted: 'not_attempted' },
    })

    expect(text).toContain('SMTP authentication:  passed')
    expect(text).toContain('IMAP authentication:  failed')
    expect(text).toContain('Inbox access:         not_attempted')
  })
})
