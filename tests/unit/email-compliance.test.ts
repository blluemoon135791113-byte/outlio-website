/**
 * Commercial mail must carry an unsubscribe mechanism and a postal address.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  PHASE 0 FINDING #2, AND THE REASON IT SURVIVED IS WORTH READING TWICE.  ║
 * ║                                                                           ║
 * ║  `unsubscribeHeaders()` was correct. `shouldIncludeUnsubscribe()` was     ║
 * ║  correct. `/u/[token]` was correct. Two test files covered them and       ║
 * ║  passed. Every assertion in those tests was TRUE.                         ║
 * ║                                                                           ║
 * ║  And no message Outlio sent could carry a `List-Unsubscribe` header,      ║
 * ║  because `OutboundMessage` had no `headers` field — so neither function   ║
 * ║  was called from anywhere, and neither could be.                         ║
 * ║                                                                           ║
 * ║  ⚠️ THE EXISTING TESTS TESTED THE PARTS. NOTHING TESTED THE JOIN. This    ║
 * ║  file asserts the composition: that the send path applies compliance,     ║
 * ║  that the transport can carry it, and that the adapter passes it on.     ║
 * ║  Deleting any one of those three links restores the original bug, and     ║
 * ║  each has its own assertion here so the failure names the broken link.   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { applyCompliance, bulkLaunchBlockedBecause } from '@/lib/email/compliance'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const BASE = 'https://outlio.io'
const SUBJECT = { workspaceId: 'ws-1', email: 'lead@example.com', campaignId: 'camp-1' }

describe('applyCompliance', () => {
  const bulk = {
    subject: SUBJECT,
    campaignType: 'sales_sequence' as const,
    baseUrl: BASE,
    postalAddress: '9 Example Street, Springfield, IL 62704',
    bodyText: 'Hello there.',
    bodyHtml: '<p>Hello there.</p>',
  }

  it('sets both RFC 8058 headers', () => {
    const out = applyCompliance(bulk)
    expect(out.headers['List-Unsubscribe']).toMatch(/^<https:\/\/outlio\.io\/u\/.+>$/)
    /*
     * ⚠️ `List-Unsubscribe-Post` IS THE ONE PEOPLE FORGET. Without it Gmail
     * treats the link as an ordinary URL and does not show its native
     * unsubscribe button — which is the button recipients press INSTEAD of
     * "report spam".
     */
    expect(out.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
  })

  it('puts a visible unsubscribe link in both bodies', () => {
    // The header is invisible in plenty of clients. §7704(a)(3) wants a
    // mechanism the recipient can actually see.
    const out = applyCompliance(bulk)
    expect(out.bodyText).toContain('/u/')
    expect(out.bodyHtml).toContain('/u/')
    expect(out.bodyHtml).toContain('Unsubscribe')
  })

  it('puts the postal address in both bodies', () => {
    const out = applyCompliance(bulk)
    expect(out.bodyText).toContain('9 Example Street')
    expect(out.bodyHtml).toContain('9 Example Street')
  })

  it('keeps the original body', () => {
    const out = applyCompliance(bulk)
    expect(out.bodyText.startsWith('Hello there.')).toBe(true)
    expect(out.bodyHtml!.startsWith('<p>Hello there.</p>')).toBe(true)
  })

  it('leaves a manual one-to-one message completely alone', () => {
    /*
     * One person typing to one person is not bulk mail. Appending "unsubscribe
     * from this list" to a hand-written reply is wrong, and would also train
     * recipients to distrust the footer where it matters.
     */
    const out = applyCompliance({ ...bulk, campaignType: 'manual' })
    expect(out.headers).toEqual({})
    expect(out.bodyText).toBe('Hello there.')
    expect(out.bodyHtml).toBe('<p>Hello there.</p>')
  })

  it('still sends an unsubscribe link when no postal address is set', () => {
    // Degrading to "no footer at all" would remove the opt-out too, which is
    // the more serious of the two failures.
    const out = applyCompliance({ ...bulk, postalAddress: null })
    expect(out.headers['List-Unsubscribe']).toBeDefined()
    expect(out.bodyText).toContain('/u/')
  })

  it('escapes the postal address into HTML', () => {
    // It is operator-supplied text landing in markup.
    const out = applyCompliance({ ...bulk, postalAddress: '<script>alert(1)</script> Street' })
    expect(out.bodyHtml).not.toContain('<script>')
    expect(out.bodyHtml).toContain('&lt;script&gt;')
  })

  it('does not invent an HTML body for a text-only message', () => {
    const out = applyCompliance({ ...bulk, bodyHtml: null })
    expect(out.bodyHtml).toBeNull()
  })
})

describe('bulkLaunchBlockedBecause', () => {
  it('blocks a bulk campaign with no postal address', () => {
    expect(bulkLaunchBlockedBecause({ campaignType: 'sales_sequence', postalAddress: null })).toMatch(
      /postal address/i,
    )
  })

  it('blocks a whitespace-only address', () => {
    expect(
      bulkLaunchBlockedBecause({ campaignType: 'sales_sequence', postalAddress: '   ' }),
    ).not.toBeNull()
  })

  it('allows a bulk campaign once one is set', () => {
    expect(
      bulkLaunchBlockedBecause({
        campaignType: 'sales_sequence',
        postalAddress: '9 Example Street, Springfield, IL 62704',
      }),
    ).toBeNull()
  })

  it('never blocks manual mail', () => {
    expect(bulkLaunchBlockedBecause({ campaignType: 'manual', postalAddress: null })).toBeNull()
  })
})

/**
 * The three links in the chain, asserted separately.
 *
 * ⚠️ THESE ARE STRUCTURAL ON PURPOSE. The unit tests above prove the compliance
 * module is correct — which is exactly what the ORIGINAL tests proved about
 * `unsubscribeHeaders()` while no message could carry it. Only a check on the
 * wiring catches the wiring coming undone.
 */
describe('the send path is actually wired to it', () => {
  const send = stripComments(read('lib/email/send.ts'))
  const provider = stripComments(read('lib/email/provider.ts'))
  const smtp = stripComments(read('lib/email/providers/smtp.ts'))

  it('link 1: OutboundMessage can carry headers', () => {
    expect(
      provider,
      'OutboundMessage has no `headers` field. This is the original bug: the ' +
        'header builders exist, are tested, and cannot be called because the ' +
        'message type cannot express a header.',
    ).toMatch(/headers\?:\s*Record<string, string>/)
  })

  it('link 2: the send worker applies compliance', () => {
    expect(
      send,
      'lib/email/send.ts does not call applyCompliance. Every message it sends ' +
        'is missing List-Unsubscribe and a postal address.',
    ).toContain('applyCompliance')
  })

  it('link 3: the send worker passes the headers to the provider', () => {
    // Calling applyCompliance and discarding its headers is a silent no-op.
    expect(send).toMatch(/headers:\s*compliant\.headers/)
  })

  it('link 4: the SMTP adapter forwards headers to the transport', () => {
    expect(
      smtp,
      'The SMTP adapter drops message.headers, so nothing reaches the wire.',
    ).toMatch(/headers:\s*message\.headers/)
  })

  it('the compliant body is what gets sent, not the raw one', () => {
    /*
     * The subtle regression: applying compliance, then sending
     * `message.body_text` anyway. Headers would be right and the visible footer
     * would be missing — and the visible footer is the part §7704(a)(3) is
     * about.
     */
    expect(send).toMatch(/text:\s*compliant\.bodyText/)
    expect(send).toMatch(/html:\s*compliant\.bodyHtml/)
  })
})
