/**
 * The sender's sign-off.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE PARTS ARE EASY; THE JOIN IS WHAT BREAKS. `email-compliance.test`  ║
 * ║  records why: three correct functions and a passing suite still shipped   ║
 * ║  mail with no unsubscribe header, because nothing called them.            ║
 * ║                                                                           ║
 * ║  So this file asserts the composition as well as the behaviour — that     ║
 * ║  `send.ts` calls `applySignature`, that it calls it BEFORE compliance,    ║
 * ║  and that the result is what compliance is handed. Removing any one of    ║
 * ║  those restores a mailbox whose signature is set and never sent.          ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { applySignature } from '@/lib/email/signature'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const base = { bodyText: 'Hello there.', bodyHtml: null as string | null }

describe('applySignature', () => {
  it('returns the message untouched when the mailbox has no signature', () => {
    const result = applySignature({ ...base, signatureText: null, signatureHtml: null })

    expect(result.bodyText).toBe('Hello there.')
    expect(result.bodyHtml).toBeNull()
  })

  it('treats whitespace-only as no signature rather than appending a blank block', () => {
    const result = applySignature({
      ...base,
      signatureText: '   \n  ',
      signatureHtml: null,
    })

    expect(result.bodyText).toBe('Hello there.')
  })

  it('appends the text signature to the text body', () => {
    const result = applySignature({
      ...base,
      signatureText: 'Jane Okafor\nNorthwind',
      signatureHtml: null,
    })

    expect(result.bodyText).toBe('Hello there.\n\nJane Okafor\nNorthwind\n')
  })

  /*
   * ⚠️ THE ONE THAT PROTECTS THE UNSUBSCRIBE LINK. RFC 3676's `-- ` marker tells
   * clients everything after it is a signature, and several collapse exactly
   * that region. The compliance footer is appended AFTER this, so using the
   * conventional delimiter would hide the mechanism CAN-SPAM requires the
   * recipient to be able to see.
   */
  it('does not use the RFC 3676 signature delimiter', () => {
    const result = applySignature({
      ...base,
      signatureText: 'Jane Okafor',
      signatureHtml: null,
    })

    expect(result.bodyText).not.toContain('-- \n')
    expect(result.bodyText).not.toMatch(/^--\s*$/m)
  })

  it('never promotes a text-only message to multipart', () => {
    const result = applySignature({
      bodyText: 'Hello there.',
      bodyHtml: null,
      signatureText: 'Jane Okafor',
      signatureHtml: '<p>Jane Okafor</p>',
    })

    expect(result.bodyHtml).toBeNull()
  })

  it('uses the HTML signature for the HTML part', () => {
    const result = applySignature({
      bodyText: 'Hello there.',
      bodyHtml: '<p>Hello there.</p>',
      signatureText: 'Jane Okafor',
      signatureHtml: '<p><strong>Jane Okafor</strong></p>',
    })

    expect(result.bodyHtml).toContain('<strong>Jane Okafor</strong>')
    // The text part still gets the text signature, never the markup.
    expect(result.bodyText).toContain('Jane Okafor')
    expect(result.bodyText).not.toContain('<strong>')
  })

  /*
   * A mailbox that set only a text signature must still sign its HTML mail.
   * Dropping it there would be the failure nobody notices — the sender's own
   * client renders HTML, so they would never see the unsigned version.
   */
  it('converts a text signature for the HTML part when no HTML one is set', () => {
    const result = applySignature({
      bodyText: 'Hello there.',
      bodyHtml: '<p>Hello there.</p>',
      signatureText: 'Jane Okafor\nNorthwind',
      signatureHtml: null,
    })

    expect(result.bodyHtml).toContain('Jane Okafor<br>Northwind')
  })

  it('escapes a text signature before putting it in the HTML part', () => {
    const result = applySignature({
      bodyText: 'Hello.',
      bodyHtml: '<p>Hello.</p>',
      signatureText: 'Jane <script>alert(1)</script> & Co',
      signatureHtml: null,
    })

    expect(result.bodyHtml).toContain('&lt;script&gt;')
    expect(result.bodyHtml).toContain('&amp;')
    expect(result.bodyHtml).not.toContain('<script>')
  })
})

describe('the send path actually applies it', () => {
  const send = read('lib/email/send.ts')

  it('imports and calls applySignature', () => {
    expect(send).toContain("from '@/lib/email/signature'")
    expect(send).toContain('applySignature({')
  })

  /*
   * ⚠️ ORDER IS THE ASSERTION, NOT JUST PRESENCE. A signature below the
   * unsubscribe line reads as boilerplate rather than as a person.
   */
  it('signs before applying compliance', () => {
    expect(send.indexOf('applySignature({')).toBeGreaterThan(-1)
    expect(send.indexOf('applySignature({')).toBeLessThan(send.indexOf('applyCompliance({'))
  })

  it('hands the signed body to compliance, not the raw one', () => {
    expect(send).toContain('bodyText: signed.bodyText')
    expect(send).toContain('bodyHtml: signed.bodyHtml')
  })

  /*
   * Read from the account on every send, so editing a signature fixes mail
   * already queued — the same guarantee compliance gives the postal address.
   */
  it('reads the signature from the account at send time', () => {
    expect(send).toContain('signatureText: account.signatureText')
    expect(send).toContain('signatureHtml: account.signatureHtml')
  })
})

describe('the sequence builder can author an HTML body', () => {
  const builder = read('components/email/SequenceBuilder.tsx')
  const actions = read('app/(product)/email/campaigns/[id]/sequence-actions.ts')
  const page = read('app/(product)/email/campaigns/[id]/page.tsx')

  it('offers the field', () => {
    expect(builder).toContain('name="bodyHtml"')
  })

  it('persists it on both insert and update', () => {
    expect(actions).toContain('body_html: bodyHtml')
    // Once for the update branch, once for the insert.
    expect(actions.match(/body_html: bodyHtml/g)?.length).toBe(2)
  })

  /*
   * ⚠️ BLANK MUST BECOME NULL. `sequence-runner` branches on
   * `step.body_html ? … : null`, so an empty string would send a multipart
   * message with an empty HTML part — a blank email in any client preferring
   * HTML.
   */
  it('stores blank as null rather than an empty string', () => {
    expect(actions).toContain("String(formData.get('bodyHtml') ?? '').trim() || null")
  })

  it('validates the HTML body with the same template rules', () => {
    expect(actions).toContain("['HTML body', bodyHtml]")
  })

  it('reads it back so the field round-trips', () => {
    expect(page).toContain('body_html')
    expect(page).toContain('bodyHtml: step.body_html')
  })
})
