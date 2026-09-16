/**
 * A contact has two LinkedIn addresses — 0138, and the XSS found beside it.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  Owner, 2026-09-15: "right now outlio on crm is giving linkedin Sales     ║
 * ║  navigator profile url i need navigator url there as well and linkedin    ║
 * ║  profile url as well".                                                    ║
 * ║                                                                           ║
 * ║  ⚠️ FIXING IT SURFACED A SECOND, WORSE BUG. The contact page rendered     ║
 * ║  `href={contact.linkedInUrl}` — the raw column straight into an href —    ║
 * ║  while the COMPANY url 190 lines above went through a validator. That     ║
 * ║  column is written by importers from uploaded HTML, so a `javascript:`    ║
 * ║  value there is stored XSS on a page every rep opens. The file's own      ║
 * ║  comment said exactly that, about the other link.                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { profileReference } from '@/lib/linkedin/profile-reference'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/**
 * ⚠️ COMMENTS STRIPPED BEFORE ANY SOURCE MATCH. Every file here argues at length
 * about the very strings being searched for — the contact page contains the
 * words `href={contact.linkedInUrl}` inside the comment explaining why that is
 * wrong. Matching raw text would find the explanation and report the opposite of
 * what the code does. This trap has been hit repeatedly in this repository.
 */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
}

/**
 * One function's body, bounded at the next top-level declaration.
 *
 * ⚠️ WITHOUT THE UPPER BOUND, EVERY ASSERTION IS ABOUT THE REST OF THE FILE.
 * `slice(indexOf(decl))` reads to end-of-file, so a `not.toMatch` can fail on
 * code the test never meant to inspect — which is exactly how the first version
 * of this file failed on a correct implementation.
 */
function body(src: string, declaration: string): string {
  const start = src.indexOf(declaration)
  if (start === -1) throw new Error(`body(): ${declaration} not found`)
  const rest = src.slice(start + declaration.length)
  const next = rest.search(/\n(?:export )?(?:async )?function |\n(?:export )?const /)
  return next === -1 ? rest : rest.slice(0, next)
}

describe('the scanner sees what it polices', () => {
  it('strips comments rather than matching the argument', () => {
    const page = 'app/(product)/crm/contacts/[id]/page.tsx'
    /*
     * The rationale quotes the defective line verbatim. If the comment survived
     * stripping, the XSS assertion below would fail on correct code — or worse,
     * pass on broken code for the wrong reason.
     */
    expect(read(page), 'the rationale was deleted').toContain('href={contact.linkedInUrl}')
    expect(code(page), 'comment stripping is not working').not.toContain(
      'href={contact.linkedInUrl}',
    )
  })
})

describe('both addresses are carried, and neither is derived from the other', () => {
  it('0138 adds the column without a backfill', () => {
    const sql = read('supabase/migrations/0138_crm_contacts_navigator_url.sql')
    expect(sql).toMatch(/add column if not exists sales_navigator_url/)
    /*
     * ⚠️ NO BACKFILL, DELIBERATELY. The data to split existing rows exists only
     * for lead-engine contacts; CSV imports and extension captures have no
     * source row. A backfill would fix some, leave others, and leave nobody able
     * to tell which.
     */
    expect(sql, 'a backfill was added without deciding what to do about non-lead-engine rows')
      .not.toMatch(/^\s*update\s+public\.crm_contacts/im)
  })

  it('ingest writes the Navigator url instead of discarding it', () => {
    const src = code('lib/crm/ingest.ts')
    expect(src).toContain('recordNavigatorUrls')
    // The coalesce survives — it is correct for IDENTITY, which is all it now does.
    expect(src).toContain('lead.linkedin_url ?? lead.sales_navigator_url')
  })

  it('never overwrites a Navigator url it already has', () => {
    /*
     * ⚠️ INGESTION IS RE-RUNNABLE (`reRun`), and the same person arrives from
     * several sources. §4.5 makes a clobber unrecoverable: the two URLs cannot
     * be derived from each other, so the lost one is gone.
     *
     * Two walls are asserted, because the read-then-write is racy on its own:
     * the filter to empty rows, and the `.is(...)` predicate on the UPDATE that
     * stops a concurrent ingest from winning.
     */
    const src = code('lib/crm/ingest.ts')
    const fn = body(src, 'async function recordNavigatorUrls')
    expect(fn).toMatch(/filter\(\(row\) => !row\.sales_navigator_url\)/)
    expect(fn, 'the UPDATE has no null guard, so a concurrent ingest can clobber').toMatch(
      /\.is\('sales_navigator_url', null\)/,
    )
  })

  it('fails CLOSED on the read and OPEN on the write, which are different questions', () => {
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  ⚠️ TWO DIRECTIONS IN ONE FUNCTION, AND MY FIRST TWO VERSIONS OF THIS  ║
     * ║  TEST GOT IT WRONG BOTH TIMES.                                        ║
     * ║                                                                       ║
     * ║  Attempt 1 sliced from `.update(` to end-of-file and matched a throw   ║
     * ║  in a different function. Attempt 2 bounded the slice correctly and    ║
     * ║  still failed — because `recordNavigatorUrls` genuinely DOES throw,    ║
     * ║  on the read.                                                          ║
     * ║                                                                       ║
     * ║  That throw is right. Failing to learn which rows are empty means not  ║
     * ║  knowing whether a write would clobber, and §4.5 makes a clobber       ║
     * ║  unrecoverable — so the honest move is to stop, not to guess.          ║
     * ║                                                                       ║
     * ║  The UPDATE is the opposite: the contact is already ingested and       ║
     * ║  canonical, so a missing supplementary field must not discard a whole  ║
     * ║  successful batch. `resolveCompanies` makes the same call — "a company ║
     * ║  we cannot resolve must not cost us the PEOPLE".                      ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    const src = code('lib/crm/ingest.ts')
    const fn = body(src, 'async function recordNavigatorUrls')

    // Fail closed on the read.
    expect(fn).toMatch(/if \(error\) throw new Error\(`recordNavigatorUrls failed/)

    // Fail open on the write. Bounded to the loop that performs it.
    const loop = fn.slice(fn.indexOf('for (const pair of pairs)'))
    expect(loop, 'the write loop was not found — re-anchor this test').toContain('.update(')
    expect(loop, 'a supplementary field throws and discards the batch').not.toMatch(
      /throw new Error/,
    )
    expect(loop, 'the write failure is swallowed silently').toMatch(/console\.error/)
  })
})

describe('the contact page cannot be made to run a javascript: url', () => {
  it('renders no LinkedIn href without passing it through the allowlist', () => {
    /*
     * ⚠️ THE REGRESSION GUARD, AND IT IS THE POINT OF THIS FILE. Asserting that
     * `profileReference` is *imported* would pass on a page that imported it and
     * then rendered the raw column anyway — which is precisely the state this
     * page was in for the company url versus the contact url.
     */
    const page = code('app/(product)/crm/contacts/[id]/page.tsx')
    expect(page).toContain('profileReference')
    expect(page, 'a raw contact url reached an href').not.toMatch(
      /href=\{contact\.(linkedInUrl|salesNavigatorUrl)\}/,
    )
    // Both links are rendered from validated references.
    expect(page).toMatch(/href=\{publicProfile\.href\}/)
    expect(page).toMatch(/href=\{navigatorProfile\.href\}/)
  })

  it('buckets by what the URL IS, not which column held it', () => {
    /*
     * ⚠️ BECAUSE HISTORIC ROWS ARE MIXED. Before 0138, ingest coalesced both
     * addresses into `linkedin_url`, and on a Sales Navigator save — Outlio's
     * primary input — it is usually the Navigator one. Trusting the column name
     * would label a `/sales/lead/…` address "LinkedIn profile" on every contact
     * created before today.
     */
    const page = code('app/(product)/crm/contacts/[id]/page.tsx')
    expect(page).toMatch(/kind === 'public'/)
    expect(page).toMatch(/kind === 'sales_navigator'/)
  })

  it('rejects the protocols an allowlist exists to reject', () => {
    // Behavioural, not a source scan: the validator is pure.
    expect(profileReference('javascript:alert(1)')).toBeNull()
    expect(profileReference('data:text/html,<script>alert(1)</script>')).toBeNull()
    // The classic decorative-allowlist failure.
    expect(profileReference('https://linkedin.com.evil.example/in/someone')).toBeNull()
    // And an action path, which is read-only-allowlisted out.
    expect(profileReference('https://www.linkedin.com/in/someone/invite')).toBeNull()
  })

  it('accepts and distinguishes the two real shapes', () => {
    const pub = profileReference('https://www.linkedin.com/in/fabricated-1')
    expect(pub?.kind).toBe('public')

    const nav = profileReference('https://www.linkedin.com/sales/lead/fabricated-1')
    expect(nav?.kind).toBe('sales_navigator')
  })
})

describe('0137 puts the owner’s decisions in the database, not only in comments', () => {
  const sql = read('supabase/migrations/0137_linkedin_workflows.sql')

  it('physically cannot store a comment draft', () => {
    /*
     * Owner: "outlio does not prepares the comment draft it would just be marked
     * as comments/engagement done". Verified against real Postgres during the
     * migration smoke test; pinned here so removing the constraint is a visible
     * change rather than a silent one.
     */
    expect(sql).toMatch(/linkedin_workflow_steps_bodyless/)
    const constraint = sql.slice(sql.indexOf('linkedin_workflow_steps_bodyless'))
    expect(constraint).toContain('COMMENT_POST')
    expect(constraint).toContain('body is null')
  })

  it('refuses to orphan somebody by deleting the step they stand on', () => {
    const pointer = sql.slice(sql.indexOf('add column if not exists current_step_id'))
    expect(pointer, 'set null would make an orphan look like a completion').toMatch(
      /on delete restrict/,
    )
  })

  it('adds no duplicate VISIT_PROFILE task kind', () => {
    /*
     * The step action is named for the owner's UI label; the task it produces is
     * the existing `REVIEW_PROFILE`. A second kind would split Phase 10 history
     * across two labels for one act.
     */
    expect(sql).toMatch(/add value if not exists 'LIKE_POST'/)
    expect(sql.replace(/\/\*[\s\S]*?\*\//g, ''), 'a duplicate kind was added').not.toMatch(
      /linkedin_task_kind add value if not exists 'VISIT_PROFILE'/,
    )
  })

  it('declares no VOICE_NOTE action — deferred by the owner', () => {
    const enumBlock = sql.slice(
      sql.indexOf('create type public.linkedin_step_action'),
      sql.indexOf('alter type public.linkedin_task_kind'),
    )
    expect(enumBlock).toContain("'WAIT'")
    expect(enumBlock, 'VOICE_NOTE was added while still unimplemented').not.toContain('VOICE_NOTE')
  })
})
