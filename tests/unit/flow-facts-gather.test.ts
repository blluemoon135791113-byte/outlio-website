/**
 * gatherFacts itself — M7 Phase 10.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  flow-fact-coverage PROVES THE FACTS ARE RIGHT ONCE GATHERED. THIS      ║
 * ║  DRIVES THE GATHER, against a mocked admin client. The seam between     ║
 * ║  the database and the facts is where this phase's defect lived:         ║
 * ║                                                                          ║
 * ║  a failed contact query used to return {} — indistinguishable from      ║
 * ║  "no contact" — so every is_empty condition on the run read TRUE,       ║
 * ║  and a cold sequence could enroll a contact and send outbound email     ║
 * ║  because the database hiccuped. gatherFacts throws on that path now,     ║
 * ║  and this file pins both sides of the difference at runtime.            ║
 * ║                                                                          ║
 * ║  Also pinned at runtime rather than as source text: every table read    ║
 * ║  carries the workspace scope (the service role has no other tenancy     ║
 * ║  wall), a contact with no company skips the company query rather       ║
 * ║  than reads one, and a domain query that errors is omitted from the     ║
 * ║  fact set — never counted as zero.                                      ║
 * ║                                                                          ║
 * ║  Every assertion was proven able to fail by mutation; the table lives   ║
 * ║  in PHASE_10_EVIDENCE.md, per this project's rule.                       ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { gatherFacts } from '@/lib/flows/facts'

const mocks = vi.hoisted(() => ({
  clientCalls: 0,
  fromCalls: [] as string[],
  eqCalls: [] as Array<{ table: string; column: string; value: unknown }>,
  tables: {} as Record<string, { data: unknown; error: { message: string } | null }>,
}))

vi.mock('server-only', () => ({}))

/*
 * The admin client as a recording stub. Every `.eq()` is written down with
 * the table it was made against, so the scoping assertions below are about
 * what the gather really passed, not what its source looks like. The chain
 * grows a `.then()` because PostgREST builders are thenable — the five
 * domain queries await the builder itself; only the contact and company
 * reads go through `.maybeSingle()`.
 *
 * A table with no seeded entry answers `{ data: [], error: null }` — an
 * honest observed-empty page — so an unexpected read shows up in the
 * assertions instead of being silently papered over.
 */
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    mocks.clientCalls += 1
    const entryFor = (table: string): { data: unknown; error: { message: string } | null } =>
      mocks.tables[table] ?? { data: [], error: null }
    const build = (table: string) => {
      const chain: {
        select: () => unknown
        eq: (column: string, value: unknown) => unknown
        is: (column: string, value: unknown) => unknown
        maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>
        then: <T>(
          onFulfilled: (value: { data: unknown; error: { message: string } | null }) => T,
          onRejected?: (reason: unknown) => T,
        ) => Promise<T>
      } = {
        select: () => chain,
        eq: (column, value) => {
          mocks.eqCalls.push({ table, column, value })
          return chain
        },
        is: () => chain,
        maybeSingle: () => Promise.resolve(entryFor(table)),
        then: (onFulfilled, onRejected) =>
          Promise.resolve(entryFor(table)).then(onFulfilled, onRejected),
      }
      return chain
    }
    return {
      from: (table: string) => {
        mocks.fromCalls.push(table)
        return build(table)
      },
    }
  },
}))

const SEVEN_TABLES = [
  'crm_contacts',
  'crm_companies',
  'crm_opportunities',
  'crm_activities',
  'crm_tasks',
  'email_messages',
  'email_threads',
]

beforeEach(() => {
  mocks.clientCalls = 0
  mocks.fromCalls = []
  mocks.eqCalls = []
  mocks.tables = {}
})

/** Fabricated data throughout — invented names, example.com domains only. */
const CONTACT = {
  id: 'contact-1',
  full_name: 'Iris Chen',
  first_name: 'Iris',
  last_name: 'Chen',
  job_title: 'VP Sales',
  headline: 'Selling platforms',
  location: 'Berlin',
  owner_user_id: 'user-1',
}

function seedGather(primaryCompanyId: string | null) {
  mocks.tables['crm_contacts'] = {
    data: { ...CONTACT, primary_company_id: primaryCompanyId },
    error: null,
  }
  if (primaryCompanyId !== null) {
    mocks.tables['crm_companies'] = {
      data: {
        name: 'Example Corp',
        domain: 'example.com',
        industry: 'Software',
        headquarters: 'Berlin',
        employee_count: 50,
        owner_user_id: 'user-1',
      },
      error: null,
    }
  }
  mocks.tables['crm_opportunities'] = {
    data: [
      { status: 'open', title: 'Platform deal', value_amount: 1000, updated_at: '2026-01-03T00:00:00Z' },
      { status: 'won', title: 'Pilot won', value_amount: 2500, updated_at: '2026-02-01T00:00:00Z' },
    ],
    error: null,
  }
  mocks.tables['crm_activities'] = {
    data: [{ activity_type: 'ENGAGEMENT', occurred_at: '2026-01-05T00:00:00Z' }],
    error: null,
  }
  mocks.tables['crm_tasks'] = { data: [{ status: 'open' }, { status: 'completed' }], error: null }
  mocks.tables['email_messages'] = {
    data: [
      { status: 'sent', updated_at: '2026-01-01T00:00:00Z' },
      { status: 'failed', updated_at: '2026-02-01T00:00:00Z' },
    ],
    error: null,
  }
  mocks.tables['email_threads'] = {
    data: [{ status: 'open', last_direction: 'outbound', last_message_at: '2026-03-01T00:00:00Z' }],
    error: null,
  }
}

describe('the trust seam — a failed read is not an absent one', () => {
  it('a failed contact query throws; it never becomes an empty fact set', async () => {
    mocks.tables['crm_contacts'] = { data: null, error: { message: 'connection refused' } }
    await expect(gatherFacts('ws-1', 'contact-1')).rejects.toThrow(
      'gatherFacts failed: connection refused',
    )
    // The six-domain fan-out never ran — the run stops before it can act on
    // facts it does not have.
    expect(mocks.clientCalls).toBe(1)
    expect(mocks.fromCalls).toEqual(['crm_contacts'])
  })

  it('a contact that does not exist is an honest empty, read once', async () => {
    mocks.tables['crm_contacts'] = { data: null, error: null }
    await expect(gatherFacts('ws-1', 'contact-1')).resolves.toEqual({})
    /*
     * One client, not two: with no contact there are no domains to read.
     * This is also the pin that `if (!data) return {}` fires before the
     * fan-out — the old code would have carried on and queried six more
     * tables for a contact that does not exist.
     */
    expect(mocks.clientCalls).toBe(1)
  })

  it('a run with no contact queries nothing at all', async () => {
    await expect(gatherFacts('ws-1', null)).resolves.toEqual({})
    expect(mocks.clientCalls).toBe(0)
  })
})

describe('what the gather asks, and what it does with the answers', () => {
  it('reads seven tables, every one scoped by workspace, and assembles the facts', async () => {
    seedGather('company-1')
    const facts = await gatherFacts('ws-1', 'contact-1')

    expect(mocks.clientCalls).toBe(2)
    expect([...mocks.fromCalls].sort()).toEqual([...SEVEN_TABLES].sort())
    /*
     * The service role bypasses RLS, so the WHERE clause is the only tenancy
     * wall each of these queries has. This is the runtime version of the
     * source check in flow-fact-coverage: what was actually passed.
     */
    for (const table of SEVEN_TABLES) {
      expect(mocks.eqCalls).toContainEqual({ table, column: 'workspace_id', value: 'ws-1' })
    }
    // And the rows are this contact's, not the workspace's at large.
    expect(mocks.eqCalls).toContainEqual({ table: 'crm_contacts', column: 'id', value: 'contact-1' })
    for (const table of [
      'crm_opportunities',
      'crm_activities',
      'crm_tasks',
      'email_messages',
      'email_threads',
    ]) {
      expect(mocks.eqCalls).toContainEqual({ table, column: 'contact_id', value: 'contact-1' })
    }

    expect(facts['contact.full_name']).toBe('Iris Chen')
    expect(facts['company.name']).toBe('Example Corp')
    expect(facts['company.employee_count']).toBe(50)
    expect(facts['opportunity.count']).toBe(2)
    expect(facts['opportunity.total_value']).toBe(3500)
    expect(facts['opportunity.latest_status']).toBe('won')
    expect(facts['activity.latest_type']).toBe('ENGAGEMENT')
    expect(facts['task.open_count']).toBe(1)
    expect(facts['email.count']).toBe(2)
    expect(facts['email.failed_count']).toBe(1)
    expect(facts['conversation.latest_direction']).toBe('outbound')
  })

  it('a contact with no company reads null company keys and never queries crm_companies', async () => {
    seedGather(null)
    const facts = await gatherFacts('ws-1', 'contact-1')

    /*
     * Observed-absent, the second of the three stories: a null
     * primary_company_id IS the answer. The keys exist with null values,
     * and the company table is never read.
     */
    expect(facts['company.name']).toBe(null)
    expect(facts['company.employee_count']).toBe(null)
    expect('company.name' in facts).toBe(true)
    expect(mocks.fromCalls).not.toContain('crm_companies')
    expect(mocks.fromCalls).toHaveLength(6)
    // The other domains still read honestly.
    expect(facts['task.count']).toBe(2)
  })

  it('one gather can hold a value, an observed zero and an omitted domain at once', async () => {
    seedGather('company-1')
    // The task query succeeded and found none — an observed zero.
    mocks.tables['crm_tasks'] = { data: [], error: null }
    // The opportunity query failed — could-not-observe, not "there are none".
    mocks.tables['crm_opportunities'] = { data: null, error: { message: 'statement timeout' } }

    const facts = await gatherFacts('ws-1', 'contact-1')

    expect(facts['company.name']).toBe('Example Corp')
    expect(facts['task.count']).toBe(0)
    /*
     * The omitted domain contributes no keys at all — a fabricated
     * opportunity.count of 0 here would route a contact as deal-less
     * because the database hiccuped.
     */
    expect('opportunity.count' in facts).toBe(false)
    expect(facts['opportunity.count']).toBe(undefined)
  })
})
