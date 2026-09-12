/**
 * Suppression is a fact about a PERSON, not about one of their addresses.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  `crm_contact_emails` LETS ONE CONTACT HOLD SEVERAL ADDRESSES.            ║
 * ║                                                                           ║
 * ║  Both suppression checks matched on `email` alone, so somebody who         ║
 * ║  unsubscribed — or was marked do-not-contact after replying — kept         ║
 * ║  receiving mail at their second address, because the row recording that    ║
 * ║  decision named the first.                                                ║
 * ║                                                                           ║
 * ║  `email_suppressions.contact_id` has existed since 0086 and                ║
 * ║  `suppressEmail` has always written it. Nothing read it.                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ THESE ARE STRUCTURAL, AND THAT IS A LIMITATION WORTH STATING. The
 * behavioural suppression tests live in `tests/integration/email-send-worker`,
 * which needs real Supabase credentials and is invisible to `npm test` — a fact
 * `.github/workflows/ci.yml` already records about this exact guard. So these
 * assert that the predicate is present in both checks; they cannot prove it
 * returns the right rows. The integration suite is where that is proven.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => strip(readFileSync(join(ROOT, p), 'utf8'))

const SEND = read('lib/email/send.ts')

describe('the enqueue check covers the contact, not just the address', () => {
  it('queries email_suppressions by contact_id as well as email', () => {
    expect(SEND).toMatch(/\.eq\('contact_id', input\.contactId\)/)
    expect(SEND).toMatch(/\.eq\('email', toEmail\)/)
  })

  it('refuses when either match hits', () => {
    // An `&&` here would be worse than the original bug: it would require BOTH
    // to match, so an address-only suppression would stop working.
    expect(SEND).toMatch(/byEmail\.data \|\| byContact\.data/)
  })

  it('only looks up the contact when there is one', () => {
    // A null contactId must not become `.eq('contact_id', null)`, which
    // PostgREST renders as `contact_id=eq.null` and matches nothing usefully.
    expect(SEND).toMatch(/input\.contactId\s*\?/)
  })

  it('does not build the filter with .or()', () => {
    /*
     * ⚠️ DELIBERATE. An email local part may legally contain a comma or a
     * parenthesis, which are PostgREST's own `or` syntax — `lib/crm/
     * contacts-list.ts` already documents what getting that wrong costs. Two
     * indexed lookups in parallel are cheaper than an escaping bug in a
     * do-not-contact check.
     */
    const block = SEND.slice(
      SEND.indexOf('const [byEmail, byContact]'),
      SEND.indexOf('if (byEmail.data || byContact.data)'),
    )
    expect(block.length).toBeGreaterThan(0)
    expect(block, 'the suppression filter uses .or()').not.toContain('.or(')
  })
})

describe('the claim-time check is fixed in the same way', () => {
  /*
   * ⚠️ THE OTHER HALF, AND IT NEEDS A MIGRATION. `enqueueEmail` refuses at
   * enqueue; a message QUEUED BEFORE the suppression was recorded is already in
   * the table, and only `claim_email_messages` stands between it and the wire.
   * `lib/email/send.ts` says it outright: "neither check makes the other
   * redundant."
   */
  const MIGRATION = readFileSync(
    join(ROOT, 'supabase/migrations/0120_suppress_by_contact.sql'),
    'utf8',
  )

  it('matches the contact as well as the address', () => {
    expect(MIGRATION).toMatch(/s\.email = m\.to_email/)
    expect(MIGRATION).toMatch(/s\.contact_id = m\.contact_id/)
  })

  it('guards the null case explicitly rather than leaning on three-valued logic', () => {
    /*
     * Without this, a suppression row with a null contact_id is compared
     * against a message with a null contact_id, and only `null = null`
     * evaluating to unknown stops it matching everything. That is not a thing
     * to leave implicit in a send/do-not-send decision.
     */
    expect(MIGRATION).toMatch(/s\.contact_id is not null/)
  })

  it('keeps 0106’s exact return shape', () => {
    /*
     * `create or replace` cannot alter a return type, so a wrong column list
     * does not fail safe — it fails the whole function. This shape is easy to
     * reconstruct incorrectly: `thread_id` is TEXT here rather than the uuid it
     * is on the table, and contact_id/campaign_id are NOT returned.
     */
    for (const column of [
      'message_id   uuid',
      'thread_id    text',
      'in_reply_to_message_id text',
      'idempotency_key text',
    ]) {
      expect(MIGRATION, `return shape drifted: ${column}`).toContain(column)
    }
    expect(MIGRATION, 'contact_id was added to the return set').not.toMatch(
      /returns table[\s\S]{0,400}contact_id\s+uuid/,
    )
  })

  it('indexes the column the new predicate scans', () => {
    expect(MIGRATION).toMatch(/email_suppressions_workspace_contact_idx/)
  })
})

describe('the contact is recorded when a suppression is written', () => {
  /*
   * ⚠️ THE HALF THAT MADE THE OTHER HALF INERT. `contact_id` has been on
   * `email_suppressions` since 0086, and of the three `suppressEmail` call
   * sites only the bounce path ever passed it. One-click unsubscribe — a
   * stated wish with legal weight — and the manual add did not, so the
   * contact-level check added to `enqueueEmail` was reading a column almost
   * nothing wrote.
   */
  it('resolves the contact inside suppressEmail rather than asking each caller', () => {
    expect(SEND).toMatch(/resolveSuppressionContact\(input\.workspaceId, email\)/)
    expect(SEND).toMatch(/input\.contactId \?\?/)
    expect(SEND).toMatch(/contact_id: contactId/)
  })

  it('refuses to attribute an address shared by several contacts', () => {
    /*
     * ⚠️ NOT A STYLE POINT. `info@`, `sales@` and `hello@` routinely sit on
     * several contacts. Attributing a do-not-contact to whichever colleague
     * sorted first would invent a fact about a person — the same defect as a
     * fabricated lead field — and would suppress the wrong two.
     */
    expect(SEND).toMatch(/owners\.length === 1/)
    expect(SEND).toMatch(/new Set\(/)
    // Two rows is enough to know it is ambiguous.
    expect(SEND).toMatch(/\.limit\(2\)/)
  })

  it('scopes the lookup by workspace and ignores deleted addresses', () => {
    const block = SEND.slice(
      SEND.indexOf('async function resolveSuppressionContact'),
      SEND.indexOf('export async function suppressEmail'),
    )
    expect(block).toMatch(/\.eq\('workspace_id', workspaceId\)/)
    expect(block).toMatch(/\.is\('deleted_at', null\)/)
  })

  it('never lets a failed lookup stop a suppression being recorded', () => {
    /*
     * Suppression is the safety-critical half; attribution is the bonus. A
     * lookup that throws must not prevent somebody being added to a
     * do-not-contact list.
     */
    const block = SEND.slice(
      SEND.indexOf('async function resolveSuppressionContact'),
      SEND.indexOf('export async function suppressEmail'),
    )
    expect(block).toMatch(/catch \{\s*return null/)
  })
})
