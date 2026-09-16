/**
 * "May we contact this person?" — asked four ways, answered correctly once.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  `contact-stop.ts` CLAIMED TO BE THE ONE READER. IT WAS NOT.              ║
 * ║                                                                           ║
 * ║  Three other places queried `email_suppressions` directly and read        ║
 * ║  `crm_contact_suppressions` — the PERSON-level table, added in 0121 for   ║
 * ║  §4.11's `Mark DNC` — NOWHERE:                                            ║
 * ║                                                                           ║
 * ║    `lib/email/enrollment.ts`      reported a DNC'd person as ENROLLED     ║
 * ║    `lib/flows/actions/email.ts`   reported them as NOT suppressed         ║
 * ║    `lib/crm/contact-export.ts`    WROTE THEM INTO THE MAILING LIST FILE   ║
 * ║                                                                           ║
 * ║  ⚠️ THE FIRST TWO WERE SAVED BY `enqueueEmail`, which has always checked  ║
 * ║  both tables at the moment of sending. No mail went out — but the         ║
 * ║  customer was told the opposite of the truth: they marked somebody DNC,   ║
 * ║  watched the product enrol them, and never learned why nothing sent.      ║
 * ║                                                                           ║
 * ║  ⚠️ THE THIRD HAD NO SUCH GATE. The rows leave in a CSV and are mailed by ║
 * ║  a tool that has never heard of Outlio.                                  ║
 * ║                                                                           ║
 * ║  ⚠️ NOTHING HAD LEAKED YET, AND THE REASON WAS ITS OWN DEFECT:            ║
 * ║  `suppressContact` — the only writer to `crm_contact_suppressions` — had  ║
 * ║  NO CALLERS. There was no Mark DNC control anywhere, so the table was     ║
 * ║  always empty and every reader above agreed on nothing, correctly, by     ║
 * ║  accident. That is why none of this was noticed, and why the fix is not   ║
 * ║  complete until the control exists — see the end-to-end chain below.      ║
 * ║                                                                           ║
 * ║  Neither reachability guard catches it: `action-reachability` only scans  ║
 * ║  files containing `'use server'`, and `orphan-module` flags whole modules ║
 * ║  — an uncalled EXPORT inside a heavily-used module is invisible to both.  ║
 * ║                                                                           ║
 * ║  All three had a legitimate reason to hand-roll it: a per-contact loop is ║
 * ║  two round trips each. So the fix was `contactsStopped`, not a rule       ║
 * ║  telling them to be slow.                                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/* ── A minimal PostgREST double, recording what was asked ────────────────── */

type Reply = { data: unknown; error: unknown }
const replies = new Map<string, Reply>()
const asked: { table: string; filters: Record<string, unknown> }[] = []

function builder(table: string) {
  const filters: Record<string, unknown> = {}
  const thenable = {
    select: () => thenable,
    eq: (k: string, v: unknown) => {
      filters[k] = v
      return thenable
    },
    in: (k: string, v: unknown) => {
      filters[k] = v
      return thenable
    },
    then: (resolve: (r: Reply) => unknown) => {
      asked.push({ table, filters })
      return Promise.resolve(replies.get(table) ?? { data: [], error: null }).then(resolve)
    },
  }
  return thenable
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: (table: string) => builder(table) }),
}))

const { contactsStopped } = await import('@/lib/crm/contact-stop')

beforeEach(() => {
  replies.clear()
  asked.length = 0
})

const CONTACTS = [
  { contactId: 'c-ada', email: 'ada@example.com' },
  { contactId: 'c-ben', email: 'ben@example.com' },
  { contactId: 'c-cleo', email: null },
]

describe('the double is wired, so a pass means something', () => {
  it('queries both tables and scopes every one by workspace', async () => {
    await contactsStopped({ workspaceId: 'w1', channel: 'email', contacts: CONTACTS })

    expect(asked.map((a) => a.table).sort()).toEqual([
      'crm_contact_suppressions',
      'email_suppressions',
    ])
    // ⚠️ The service role bypasses RLS. This filter is the only tenancy wall.
    for (const call of asked) {
      expect(call.filters.workspace_id, `${call.table} is unscoped`).toBe('w1')
    }
  })

  it('asks only about the contacts it was given', async () => {
    await contactsStopped({ workspaceId: 'w1', channel: 'email', contacts: CONTACTS })
    const byContact = asked.find((a) => a.table === 'crm_contact_suppressions')!
    expect(byContact.filters.contact_id).toEqual(['c-ada', 'c-ben', 'c-cleo'])

    // A contact with no address contributes no address to look up.
    const byAddress = asked.find((a) => a.table === 'email_suppressions')!
    expect(byAddress.filters.email).toEqual(['ada@example.com', 'ben@example.com'])
  })
})

describe('a long list is split, because the URL is not', () => {
  it('chunks rather than sending one enormous .in()', async () => {
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  ⚠️ MEASURED AGAINST THE REAL SERVICE: 500 ids is fine, 1000 returns   ║
     * ║  400, 2000 drops the connection. PostgREST puts `.in(...)` values in   ║
     * ║  the URL.                                                             ║
     * ║                                                                       ║
     * ║  `contact-export.ts` caps a marketing export at 5,000 rows and asked   ║
     * ║  about all of them at once. And because this module fails CLOSED, the  ║
     * ║  failure did not look like one: every contact read as stopped and the  ║
     * ║  export came back EMPTY, with nothing on screen to say why.           ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    const many = Array.from({ length: 1200 }, (_, i) => ({
      contactId: `c-${i}`,
      email: `p${i}@example.com`,
    }))
    await contactsStopped({ workspaceId: 'w1', channel: 'email', contacts: many })

    const contactCalls = asked.filter((a) => a.table === 'crm_contact_suppressions')
    expect(contactCalls.length, '1200 ids were not split').toBeGreaterThan(1)
    for (const call of contactCalls) {
      expect((call.filters.contact_id as string[]).length).toBeLessThanOrEqual(250)
    }
    // Every id is still asked about — chunking must not drop the tail.
    const covered = contactCalls.flatMap((c) => c.filters.contact_id as string[])
    expect(covered).toHaveLength(1200)
  })

  it('fails CLOSED when any single chunk fails', async () => {
    /*
     * ⚠️ A PARTIAL ANSWER IS THE WORST OUTCOME AVAILABLE. Contacts in a failed
     * batch would read as NOT stopped — the one direction this module must
     * never fail in — so one bad chunk fails the whole answer.
     */
    replies.set('crm_contact_suppressions', { data: null, error: { message: 'boom' } })
    const many = Array.from({ length: 600 }, (_, i) => ({ contactId: `c-${i}`, email: null }))
    const stops = await contactsStopped({ workspaceId: 'w1', channel: 'email', contacts: many })

    expect(stops.size).toBe(600)
    expect(stops.get('c-599')).toEqual({
      stopped: true,
      via: 'unknown',
      reason: 'lookup_failed',
    })
  })
})

describe('a person-level stop is found', () => {
  it('stops a contact who has no email address at all', async () => {
    /*
     * ⚠️ THE CASE THE ADDRESS TABLE CANNOT EXPRESS, and the reason 0121 exists.
     * A LinkedIn-only contact has no address, so "do not contact this person"
     * was unrecordable — and every caller that checked only addresses was
     * structurally incapable of honouring it.
     */
    replies.set('crm_contact_suppressions', {
      data: [{ contact_id: 'c-cleo', reason: 'explicit_request' }],
      error: null,
    })

    const stops = await contactsStopped({ workspaceId: 'w1', channel: 'email', contacts: CONTACTS })
    expect(stops.get('c-cleo')).toEqual({
      stopped: true,
      via: 'contact',
      reason: 'explicit_request',
    })
    expect(stops.get('c-ada')).toBeUndefined()
  })

  it('takes precedence over an address suppression on the same person', async () => {
    // `explicit_request` is a stated wish; a bounce is a delivery accident.
    // The more specific fact is the one worth reporting.
    replies.set('crm_contact_suppressions', {
      data: [{ contact_id: 'c-ada', reason: 'explicit_request' }],
      error: null,
    })
    replies.set('email_suppressions', {
      data: [{ email: 'ada@example.com', reason: 'hard_bounce' }],
      error: null,
    })

    const stops = await contactsStopped({ workspaceId: 'w1', channel: 'email', contacts: CONTACTS })
    expect(stops.get('c-ada')).toEqual({
      stopped: true,
      via: 'contact',
      reason: 'explicit_request',
    })
  })
})

describe('an address suppression stops email and nothing else', () => {
  beforeEach(() => {
    replies.set('email_suppressions', {
      data: [{ email: 'ben@example.com', reason: 'unsubscribed' }],
      error: null,
    })
  })

  it('stops the email channel', async () => {
    const stops = await contactsStopped({ workspaceId: 'w1', channel: 'email', contacts: CONTACTS })
    expect(stops.get('c-ben')).toEqual({ stopped: true, via: 'address', reason: 'unsubscribed' })
  })

  it('does NOT stop LinkedIn', async () => {
    /*
     * ⚠️ IT IS EVIDENCE ABOUT ONE MAILBOX. Reading it as "never approach this
     * person anywhere" invents the scope of somebody's request — §4.15 requires
     * the stated scope, not a convenient widening of it.
     */
    const stops = await contactsStopped({
      workspaceId: 'w1',
      channel: 'linkedin',
      contacts: CONTACTS,
    })
    expect(stops.get('c-ben')).toBeUndefined()
  })

  it('scopes the person-level lookup to `all` plus the asking channel', async () => {
    await contactsStopped({ workspaceId: 'w1', channel: 'linkedin', contacts: CONTACTS })
    const byContact = asked.find((a) => a.table === 'crm_contact_suppressions')!
    expect(byContact.filters.scope).toEqual(['all', 'linkedin'])
  })
})

describe('it fails CLOSED, which is the opposite of the rate limiter', () => {
  it('stops everybody when the person-level lookup errors', async () => {
    /*
     * ⚠️ A DATABASE THAT WILL NOT ANSWER IS NOT PERMISSION. `consume_rate_limit`
     * fails open because refusing a legitimate action on a blip is the smaller
     * harm. Here the asymmetry runs the other way: mailing somebody who asked
     * not to be mailed cannot be undone and is the one failure with legal
     * weight.
     */
    replies.set('crm_contact_suppressions', { data: null, error: { message: 'boom' } })

    const stops = await contactsStopped({ workspaceId: 'w1', channel: 'email', contacts: CONTACTS })
    expect(stops.size).toBe(3)
    for (const contact of CONTACTS) {
      expect(stops.get(contact.contactId)).toEqual({
        stopped: true,
        via: 'unknown',
        reason: 'lookup_failed',
      })
    }
  })

  it('stops everybody when the ADDRESS lookup errors too', async () => {
    // Both halves, because a guard on one is a guard on neither.
    replies.set('email_suppressions', { data: null, error: { message: 'boom' } })

    const stops = await contactsStopped({ workspaceId: 'w1', channel: 'email', contacts: CONTACTS })
    expect(stops.size).toBe(3)
    expect(stops.get('c-ada')?.stopped).toBe(true)
  })

  it('returns an empty map for an empty request without querying', async () => {
    const stops = await contactsStopped({ workspaceId: 'w1', channel: 'email', contacts: [] })
    expect(stops.size).toBe(0)
    expect(asked).toHaveLength(0)
  })
})

/* ── The ratchet: nobody asks this question themselves ───────────────────── */

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    let entries: string[]
    try {
      entries = readdirSync(d)
    } catch {
      return
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue
      const full = join(d, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.tsx?$/.test(full)) out.push(full)
    }
  }
  walk(dir)
  return out
}

const PRODUCT = [
  ...sourceFiles(join(ROOT, 'lib')),
  ...sourceFiles(join(ROOT, 'app')),
  ...sourceFiles(join(ROOT, 'components')),
].map((f) => ({
  file: relative(ROOT, f).split('\\').join('/'),
  code: strip(readFileSync(f, 'utf8')),
}))

/**
 * ⚠️ THE TWO THAT MAY TOUCH THE TABLE, AND WHY. Neither decides whether
 * somebody may be contacted; both are CRUD on the list itself. A file that
 * DECIDES belongs in `contact-stop.ts`.
 */
const MAY_QUERY_DIRECTLY = new Set([
  'lib/crm/contact-stop.ts',
  // Writes a suppression, and lists/removes them for the settings screen.
  'lib/email/send.ts',
  'lib/email/suppressions.ts',
])

describe('the module really is the only reader now', () => {
  it('found the files it is policing', () => {
    // Vacuity: a broken walk makes every assertion below pass over nothing.
    expect(PRODUCT.length).toBeGreaterThan(300)
    for (const file of MAY_QUERY_DIRECTLY) {
      expect(PRODUCT.some((f) => f.file === file), `${file} not found`).toBe(true)
    }
  })

  it('nothing else queries email_suppressions', () => {
    const offenders = PRODUCT.filter(
      (f) => !MAY_QUERY_DIRECTLY.has(f.file) && /from\('email_suppressions'\)/.test(f.code),
    ).map((f) => f.file)

    expect(
      offenders,
      'A fourth reader of the suppression list. The previous three each ' +
        'checked addresses and forgot crm_contact_suppressions entirely — use ' +
        'contactIsStopped or contactsStopped instead.',
    ).toEqual([])
  })

  it('nothing else queries crm_contact_suppressions', () => {
    const offenders = PRODUCT.filter(
      (f) => f.file !== 'lib/crm/contact-stop.ts' && /from\('crm_contact_suppressions'\)/.test(f.code),
    ).map((f) => f.file)
    expect(offenders).toEqual([])
  })

  it('the three repaired callers really do call the predicate', () => {
    /*
     * ⚠️ ASSERTED IN BOTH DIRECTIONS. The ratchets above pass if a caller stops
     * checking suppression altogether, which is the worse failure.
     */
    for (const [file, fn] of [
      ['lib/email/enrollment.ts', 'contactsStopped'],
      ['lib/crm/contact-export.ts', 'contactsStopped'],
      ['lib/flows/actions/email.ts', 'contactIsStopped'],
    ] as const) {
      const source = PRODUCT.find((f) => f.file === file)
      expect(source, `${file} not found`).toBeDefined()
      expect(source!.code, `${file} stopped checking suppression`).toMatch(
        new RegExp(`${fn}\\(\\{`),
      )
    }
  })
})

describe('the do-not-contact chain is complete end to end', () => {
  /*
   * ╔═══════════════════════════════════════════════════════════════════════════╗
   * ║  ⚠️ EVERY LINK EXISTED EXCEPT ONE, AND THAT IS WHY NOBODY NOTICED.        ║
   * ║                                                                           ║
   * ║  Migration 0121 created the table. `suppressContact` wrote to it.         ║
   * ║  `contactIsStopped` read it. `enqueueEmail` honoured it. And NOTHING      ║
   * ║  ANYWHERE COULD PUT A ROW IN — no action, no panel, no button. The        ║
   * ║  feature was complete in every respect except being reachable by a human. ║
   * ║                                                                           ║
   * ║  `action-reachability` did not catch it because that guard only scans     ║
   * ║  files containing `'use server'`, and `suppressContact` lives in a        ║
   * ║  `server-only` module. `orphan-module` did not catch it because           ║
   * ║  `contact-stop.ts` is heavily imported — just never for THAT export.      ║
   * ║                                                                           ║
   * ║  So this asserts the chain itself, link by link. It is narrow on purpose: ║
   * ║  a general "every export has a caller" rule over `lib/` is a different    ║
   * ║  and much larger piece of work.                                          ║
   * ╚═══════════════════════════════════════════════════════════════════════════╝
   */
  const find = (file: string) => PRODUCT.find((f) => f.file === file)

  it('the writer has a caller outside its own module', () => {
    const callers = PRODUCT.filter(
      (f) =>
        f.file !== 'lib/crm/contact-stop.ts' &&
        // ⚠️ \b OR THIS MATCHES INSIDE \`unsuppressContact({\`, and the guard
        // passes on the presence of the OPPOSITE function. Caught by mutation.
        /\bsuppressContact\(\{/.test(f.code),
    ).map((f) => f.file)
    expect(
      callers,
      'suppressContact has no caller again — nothing can mark a person ' +
        'do-not-contact, so crm_contact_suppressions is always empty and every ' +
        'reader of it agrees on nothing by accident.',
    ).toContain('lib/crm/contact-actions.ts')
  })

  it('a mark can be lifted, not only made', () => {
    // A mark with no way back is a trap: the people most likely to be marked
    // by accident are the ones being actively worked.
    expect(find('lib/crm/contact-stop.ts')!.code).toMatch(/export async function unsuppressContact/)
    expect(find('lib/crm/contact-actions.ts')!.code).toMatch(/clearDoNotContactAction/)
  })

  it('both actions gate, because an action is a public HTTP endpoint', () => {
    const actions = find('lib/crm/contact-actions.ts')!.code
    const mark = actions.slice(actions.indexOf('export async function markDoNotContactAction'))
    const clear = actions.slice(actions.indexOf('export async function clearDoNotContactAction'))
    for (const [label, body] of [['mark', mark], ['clear', clear]] as const) {
      expect(body.slice(0, 600), `${label} does not assert a permission`).toMatch(
        /assertWorkspacePermission\('crm\.contact\.edit'\)/,
      )
      /*
       * ⚠️ AND SCOPES TO THE WORKSPACE BEFORE WRITING. The service role
       * bypasses RLS, so a posted id from another tenant would otherwise be
       * marked, and the response would look identical to a legitimate one.
       */
      expect(body.slice(0, 2500), `${label} does not scope by workspace`).toMatch(
        /\.eq\('workspace_id', ctx\.workspace\.id\)/,
      )
    }
  })

  it('the panel is rendered on the contact page, not merely written', () => {
    const page = find('app/(product)/crm/contacts/[id]/page.tsx')
    expect(page, 'the contact detail page moved').toBeDefined()
    expect(page!.code).toMatch(/<DoNotContact\b/)
    expect(page!.code).toMatch(/contactStopRecord\(/)
  })

  it('the panel calls the actions rather than importing them', () => {
    /*
     * ⚠️ THIS CHECKS THE CALL, NOT THE IMPORT. `action-reachability` used to be
     * satisfied by an import alone — it matched the name anywhere in another
     * file, so an imported-but-never-invoked action passed it while being
     * exactly as unreachable. That hole is closed now (it strips imports as
     * well as comments), and this stays as the specific check for these two.
     */
    const panel = find('components/crm/ContactPanels.tsx')!.code
    expect(panel).toMatch(/useActionState\(markDoNotContactAction,/)
    expect(panel).toMatch(/useActionState\(clearDoNotContactAction,/)
  })

  it('the client half never imports the server-only module', () => {
    /*
     * ⚠️ THIS FAILED THE BUILD ONCE ALREADY. `contact-stop.ts` is `server-only`,
     * so pulling the scope and reason lists from it put `server-only` in the
     * browser bundle. `contact-stop-copy.ts` exists for the same reason
     * `lib/email/suppression-copy.ts` does.
     */
    const panel = find('components/crm/ContactPanels.tsx')!.code
    expect(panel).toMatch(/from '@\/lib\/crm\/contact-stop-copy'/)
    expect(panel, 'a client component imports the server-only module').not.toMatch(
      /from '@\/lib\/crm\/contact-stop'/,
    )
    expect(find('lib/crm/contact-stop-copy.ts')!.code).not.toContain("import 'server-only'")
  })

  it('a teammate cannot file a mark as the person having unsubscribed', () => {
    /*
     * ⚠️ FORGED CONSENT PROVENANCE. `unsubscribed` records something the
     * RECIPIENT did by clicking a link. A colleague choosing it from a dropdown
     * would make the record claim the person opted out themselves — a stronger
     * and legally different fact than "we wrote it down".
     */
    const copy = find('lib/crm/contact-stop-copy.ts')!.code
    const list = /export const STOP_REASONS = \[([\s\S]*?)\]/.exec(copy)?.[1] ?? ''
    expect(list).not.toContain('unsubscribed')
    expect(list).toContain('explicit_request')
  })
})

describe('a do-not-contact is reported as itself', () => {
  const ENROLLMENT = PRODUCT.find((f) => f.file === 'lib/email/enrollment.ts')!.code

  it('does not tell a DNC’d person they unsubscribed', () => {
    /*
     * ⚠️ THE CAUSE DIFFERS AND SO DOES THE FIX. `suppressed` means this ADDRESS
     * unsubscribed or bounced — nothing the customer can undo. `do_not_contact`
     * means a TEAMMATE marked this person, which they can. Reporting both as
     * "unsubscribed or bounced" sends them looking in the wrong place.
     */
    expect(ENROLLMENT).toMatch(/'do_not_contact'/)
    expect(ENROLLMENT).toMatch(/do_not_contact: 'marked do-not-contact'/)
    expect(ENROLLMENT).toMatch(/suppressed: 'unsubscribed or bounced'/)
  })

  it('treats a failed lookup as a stop rather than as permission', () => {
    // Fail-closed has to survive the trip through the caller, not just live in
    // the predicate.
    expect(ENROLLMENT).toMatch(/Could not check the do-not-contact list/)
  })
})
