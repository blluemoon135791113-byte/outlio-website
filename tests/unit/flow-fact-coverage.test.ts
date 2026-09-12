/**
 * The fact set a branch actually reads — M7 Phase 10.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  flow-branch-and-update PROVES THE SOURCE TEXTS AGREE. THIS PROVES THE   ║
 * ║  CODE DOES. Three things a source regex cannot see:                      ║
 * ║                                                                          ║
 * ║  1. The builder's runtime output is exactly the picker's key list —      ║
 * ║     not a superset, not a subset, key for key.                           ║
 * ║                                                                          ║
 * ║  2. The three kinds of missing read differently, and only one of them     ║
 * ║     is "zero". A count of 0 (we looked; there are none) is a VALUE —     ║
 * ║     is_empty on it is false. A null company is an ABSENCE — is_empty      ║
 * ║     is true. A failed query removes the whole domain, so no branch ever   ║
 * ║     reads a confident zero the database never returned.                   ║
 * ║                                                                          ║
 * ║  3. Every table read is workspace-scoped in code. These queries run on   ║
 * ║     the service role, where the WHERE clause is the only tenancy wall.   ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { evaluateCondition } from '@/lib/flows/engine'
import { buildDomainFacts } from '@/lib/flows/facts'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const BUILDER = read('components/flows/FlowBuilder.tsx')
const FACTS = read('lib/flows/facts.ts')
const ENGINE = read('lib/flows/engine.ts')

/** The keys the branch picker offers, straight from its own source. */
const offeredKeys = [
  ...BUILDER.matchAll(
    /\{ key: '((?:contact|company|opportunity|activity|task|email|conversation)\.[a-z_]+)', label:/g,
  ),
].map((m) => m[1]!)

/**
 * The fields whose fact is a number, straight from the editor's own set.
 * The editor needs this set to type the value box and coerce what it stores;
 * the tests need it to prove the set agrees with what `buildDomainFacts`
 * actually returns. One source: FlowBuilder's literal, read here.
 */
const numericFields = [
  ...BUILDER.matchAll(/const NUMERIC_FIELDS = new Set\(\[([\s\S]*?)\]\)/g),
].flatMap((m) => [...m[1]!.matchAll(/'([^']+)'/g)].map((q) => q[1]!))

/** One fixture where every offered key holds its natural type. */
function fullyPopulatedFacts() {
  return buildDomainFacts({
    contact: {
      full_name: 'Iris Chen',
      first_name: 'Iris',
      last_name: 'Chen',
      job_title: 'VP Sales',
      headline: 'Selling platforms',
      location: 'Berlin',
      owner_user_id: 'user-1',
      primary_company_id: 'company-1',
    },
    company: {
      name: 'Example Corp',
      domain: 'example.com',
      industry: 'Software',
      headquarters: 'Berlin',
      employee_count: 50,
      owner_user_id: 'user-1',
    },
    opportunities: [
      { status: 'open', title: 'Platform deal', value_amount: 1000, updated_at: '2026-01-03T00:00:00Z' },
      { status: 'won', title: 'Pilot won', value_amount: 2500, updated_at: '2026-02-01T00:00:00Z' },
    ],
    activities: [{ activity_type: 'ENGAGEMENT', occurred_at: '2026-01-05T00:00:00Z' }],
    tasks: [{ status: 'open' }, { status: 'completed' }],
    messages: [
      { status: 'sent', updated_at: '2026-01-01T00:00:00Z' },
      { status: 'failed', updated_at: '2026-02-01T00:00:00Z' },
    ],
    threads: [{ status: 'open', last_direction: 'outbound', last_message_at: '2026-03-01T00:00:00Z' }],
  })
}

describe('numeric facts are numbers, and only the numeric ones', () => {
  it('the extraction of NUMERIC_FIELDS is not vacuous', () => {
    expect(numericFields.length).toBeGreaterThanOrEqual(13)
    expect(new Set(numericFields).size).toBe(numericFields.length)
    for (const field of numericFields) expect(offeredKeys).toContain(field)
  })

  it('every NUMERIC_FIELDS key reads as a number against a full fixture', () => {
    const facts = fullyPopulatedFacts()
    for (const field of numericFields) {
      expect(facts[field], `${field} must be a number`).toEqual(expect.any(Number))
    }
  })

  it('no offered non-numeric key reads as a number', () => {
    /*
     * The other direction. A string fact listed in NUMERIC_FIELDS would type
     * the value box as number while the fact is text — equals on it can never
     * be true, and the editor would show a number box lying about the fact.
     */
    const facts = fullyPopulatedFacts()
    for (const key of offeredKeys) {
      if (numericFields.includes(key)) continue
      expect(facts[key], `${key} must not be a number`).not.toEqual(expect.any(Number))
    }
  })

  it('equals on a numeric fact is strict — the string form never matches', () => {
    /*
     * This is the shipped defect, pinned. `task.count` is the number 2; the
     * pre-fix editor stored '2' for equals, and `2 === '2'` is false — every
     * contact takes the same path while the branch looks configured.
     */
    const facts = fullyPopulatedFacts()
    const condition = { field: 'task.count', operator: 'equals' as const }
    expect(evaluateCondition({ ...condition, value: 2 }, facts)).toBe(true)
    expect(evaluateCondition({ ...condition, value: '2' }, facts)).toBe(false)
  })
})

describe('a facts read the run cannot trust fails the run', () => {
  it('the engine catches a throwing gather and fails the run in-band', () => {
    /*
     * `gatherFacts` throws rather than return {} on a failed contact query —
     * an empty set would make every is_empty condition read TRUE, and a cold
     * sequence could send outbound email because the database hiccuped. The
     * engine must convert that throw into a failed run, not an unhandled
     * rejection that leaves the run 'running' until the lease expires.
     */
    expect(ENGINE).toContain("code: 'FACTS_UNAVAILABLE'")
    /*
     * The finish must sit INSIDE the catch: `await finish(db, runId, 'failed')`
     * appears three times in engine.ts, so a whole-file containment would stay
     * green even if the catch returned 'failed' without writing it — leaving
     * the run 'running' until the lease expires. The contiguous block pins
     * the catch's own finish, not a finish elsewhere in the file.
     */
    expect(ENGINE).toContain(
      "await finish(db, runId, 'failed')\n    return {\n      status: 'failed',\n      stepsExecuted,\n      error: {\n        stepId: run.current_step,\n        code: 'FACTS_UNAVAILABLE',",
    )
    expect(FACTS).toContain('if (error) throw new Error(`gatherFacts failed: ${error.message}`)')
  })
})

/*
 * A deliberately under-filled contact: cold-outbound data is null-heavy by
 * default, and the builder must carry the nulls through untouched.
 */
const CONTACT = {
  full_name: 'Dana Reyes',
  first_name: 'Dana',
  last_name: 'Reyes',
  job_title: null,
  headline: null,
  location: 'Lisbon',
  owner_user_id: null,
  primary_company_id: null,
}

describe('the builder produces exactly the offered keys', () => {
  it('runtime output equals the picker, key for key', () => {
    /*
     * The equality is load-bearing in both directions. A produced-but-
     * unoffered key is invisible forever; an offered-but-unproduced key is
     * the silent no-branch bug — every contact takes the same path while
     * the branch looks configured.
     */
    const result = buildDomainFacts({
      contact: CONTACT,
      company: null,
      opportunities: [],
      activities: [],
      tasks: [],
      messages: [],
      threads: [],
    })
    expect(Object.keys(result).sort()).toEqual([...offeredKeys].sort())
  })

  it('the picker extraction is not vacuous', () => {
    // If the regex stops matching, the equality above compares against an
    // empty list and passes for nothing. The floor keeps that visible.
    expect(offeredKeys.length).toBeGreaterThanOrEqual(33)
    expect(new Set(offeredKeys).size).toBe(offeredKeys.length)
  })
})

describe('observed zero, observed absent, could-not-observe', () => {
  // Every domain observed, every domain empty: we looked, and there are none.
  const facts = buildDomainFacts({
    contact: CONTACT,
    company: null,
    opportunities: [],
    activities: [],
    tasks: [],
    messages: [],
    threads: [],
  })

  it('no company is null keys, not zeroes — is_empty reads true', () => {
    expect(facts['company.name']).toBe(null)
    // null, never 0 — a contact with no company has no employee count.
    expect(facts['company.employee_count']).toBe(null)
    expect(evaluateCondition({ field: 'company.employee_count', operator: 'is_empty' }, facts)).toBe(true)
  })

  it('zero opportunities is a count of 0, a value — is_empty reads false', () => {
    expect(facts['opportunity.count']).toBe(0)
    expect(facts['opportunity.open_count']).toBe(0)
    expect(facts['opportunity.total_value']).toBe(0)
    expect(
      evaluateCondition({ field: 'opportunity.count', operator: 'greater_than', value: 0 }, facts),
    ).toBe(false)
    /*
     * The subtle one. 0 is an OBSERVED value — we queried and the table was
     * empty — so "is empty" is false. Collapsing it into the null story
     * would make every no-deal contact read as data-missing.
     */
    expect(evaluateCondition({ field: 'opportunity.count', operator: 'is_empty' }, facts)).toBe(false)
  })

  it('with no opportunities there is no latest anything', () => {
    expect(facts['opportunity.latest_status']).toBe(null)
    expect(facts['opportunity.latest_title']).toBe(null)
    expect(facts['opportunity.latest_value']).toBe(null)
    for (const field of [
      'opportunity.latest_status',
      'opportunity.latest_title',
      'opportunity.latest_value',
    ]) {
      expect(evaluateCondition({ field, operator: 'is_empty' }, facts)).toBe(true)
    }
  })

  it('empty activities, tasks, emails and conversations follow the same story', () => {
    expect(facts['activity.count']).toBe(0)
    expect(facts['activity.latest_type']).toBe(null)
    expect(facts['activity.latest_at']).toBe(null)
    expect(facts['task.count']).toBe(0)
    expect(facts['task.open_count']).toBe(0)
    expect(facts['email.count']).toBe(0)
    expect(facts['email.sent_count']).toBe(0)
    expect(facts['email.failed_count']).toBe(0)
    expect(facts['email.latest_status']).toBe(null)
    expect(evaluateCondition({ field: 'email.latest_status', operator: 'is_empty' }, facts)).toBe(true)
    expect(facts['conversation.count']).toBe(0)
    expect(facts['conversation.open_count']).toBe(0)
    expect(facts['conversation.latest_direction']).toBe(null)
    expect(facts['conversation.latest_message_at']).toBe(null)
  })

  it('a domain that could not be observed is absent entirely, never a zero', () => {
    const result = buildDomainFacts({
      contact: CONTACT,
      company: null,
      // opportunities: deliberately omitted — its query failed upstream.
      activities: [],
      tasks: [],
      messages: [],
      threads: [],
    })
    /*
     * A failed query fabricating "0 open opportunities" would route a contact
     * as deal-less because the database hiccuped. Omission is the honest
     * answer: absent keys read as undefined, and is_empty on them is true.
     */
    expect(Object.keys(result).filter((k) => k.startsWith('opportunity.'))).toEqual([])
  })

  it('a run with no contact keeps the historical empty fact set', () => {
    expect(buildDomainFacts({ contact: null })).toEqual({})
  })
})

describe('counts and latests from real row shapes', () => {
  it('opportunities: count, open count, totals and the newest row', () => {
    const facts = buildDomainFacts({
      contact: CONTACT,
      opportunities: [
        { status: 'open', title: 'Platform deal', value_amount: 1000, updated_at: '2026-01-03T00:00:00Z' },
        { status: 'open', title: 'Expansion', value_amount: 500, updated_at: '2026-01-01T00:00:00Z' },
        { status: 'won', title: 'Pilot won', value_amount: 2500, updated_at: '2026-02-01T00:00:00Z' },
        // A null value_amount is observed-missing: it adds nothing to the total.
        { status: 'lost', title: 'No budget', value_amount: null, updated_at: '2026-01-15T00:00:00Z' },
      ],
    })
    expect(facts['opportunity.count']).toBe(4)
    expect(facts['opportunity.open_count']).toBe(2)
    expect(facts['opportunity.total_value']).toBe(4000)
    // latest_* come from the most recent updated_at, not the first row read.
    expect(facts['opportunity.latest_status']).toBe('won')
    expect(facts['opportunity.latest_title']).toBe('Pilot won')
    expect(facts['opportunity.latest_value']).toBe(2500)
  })

  it('threads, messages and tasks count their statuses', () => {
    const facts = buildDomainFacts({
      contact: CONTACT,
      threads: [
        { status: 'open', last_direction: 'outbound', last_message_at: '2026-01-05T00:00:00Z' },
        { status: 'open', last_direction: 'inbound', last_message_at: '2026-01-02T00:00:00Z' },
        { status: 'resolved', last_direction: 'outbound', last_message_at: '2026-03-01T00:00:00Z' },
      ],
      messages: [
        { status: 'sent', updated_at: '2026-01-01T00:00:00Z' },
        { status: 'sent', updated_at: '2026-01-02T00:00:00Z' },
        { status: 'sent', updated_at: '2026-01-03T00:00:00Z' },
        { status: 'failed', updated_at: '2026-02-01T00:00:00Z' },
      ],
      tasks: [{ status: 'open' }, { status: 'open' }, { status: 'completed' }],
    })
    expect(facts['conversation.count']).toBe(3)
    expect(facts['conversation.open_count']).toBe(2)
    // The latest thread is the resolved one — newest, not first, not majority.
    expect(facts['conversation.latest_direction']).toBe('outbound')
    expect(facts['conversation.latest_message_at']).toBe('2026-03-01T00:00:00Z')
    expect(facts['email.count']).toBe(4)
    expect(facts['email.sent_count']).toBe(3)
    expect(facts['email.failed_count']).toBe(1)
    expect(facts['email.latest_status']).toBe('failed')
    expect(facts['task.count']).toBe(3)
    expect(facts['task.open_count']).toBe(2)
  })
})

describe('the gather scopes every query it makes', () => {
  it('every table read carries the workspace scope', () => {
    const fromCalls = FACTS.match(/\.from\('/g)?.length ?? 0
    const scoped = FACTS.match(/\.eq\('workspace_id', workspaceId\)/g)?.length ?? 0
    expect(fromCalls).toBe(7)
    /*
     * These queries run on the service role, which bypasses RLS. The WHERE
     * clause is the only tenancy wall they have — a read missing it is a
     * cross-tenant leak, not a slow query.
     */
    expect(scoped, 'a read missing its workspace scope is a cross-tenant read').toBeGreaterThanOrEqual(fromCalls)
  })

  it('soft-deleted tables are filtered, append-only ones are not', () => {
    expect(FACTS).toContain(".is('deleted_at', null)")
    const segment = (table: string) => {
      const start = FACTS.indexOf(`.from('${table}')`)
      expect(start, `${table} is not read at all`).toBeGreaterThan(0)
      return FACTS.slice(start, FACTS.indexOf('.then(', start))
    }
    /*
     * crm_activities is append-only and the email tables have no deleted_at
     * column — filtering there is an SQL error on every run, and someone
     * "fixing" it by copying the filter would discover it only in production.
     */
    for (const table of ['crm_activities', 'email_messages', 'email_threads']) {
      expect(segment(table), `${table} must not filter deleted_at`).not.toContain('deleted_at')
    }
  })
})

describe('the contact facts are unchanged', () => {
  const pinned = {
    full_name: 'Ada Lovelace',
    first_name: 'Ada',
    last_name: 'Lovelace',
    job_title: 'Mathematician',
    headline: 'First programmer',
    location: 'London',
    owner_user_id: 'user-9',
    primary_company_id: 'company-7',
  }
  const facts = buildDomainFacts({ contact: pinned })

  it('carries all eight keys with the same values', () => {
    expect(facts['contact.full_name']).toBe('Ada Lovelace')
    expect(facts['contact.first_name']).toBe('Ada')
    expect(facts['contact.last_name']).toBe('Lovelace')
    expect(facts['contact.job_title']).toBe('Mathematician')
    expect(facts['contact.headline']).toBe('First programmer')
    expect(facts['contact.location']).toBe('London')
    expect(facts['contact.owner_user_id']).toBe('user-9')
  })

  it('maps primary_company_id onto contact.company_id', () => {
    /*
     * The one rename in the set: the picker says company_id, the row says
     * primary_company_id. A regression here blanks the picker's "company"
     * for every contact while every other fact keeps working — invisible
     * except as branches that suddenly never match.
     */
    expect(facts['contact.company_id']).toBe('company-7')
  })

  it('with no domains observed, returns only the eight', () => {
    const contactKeys = offeredKeys.filter((k) => k.startsWith('contact.'))
    expect(Object.keys(facts).sort()).toEqual([...contactKeys].sort())
  })
})
