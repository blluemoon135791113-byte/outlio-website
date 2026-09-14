/**
 * A task may name a deal, and only one in its own workspace.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  WHY THE COLUMN EXISTS AT ALL.                                            ║
 * ║                                                                           ║
 * ║  `crm_tasks` carried `contact_id` and `company_id` and nothing else, so a ║
 * ║  task could say which PERSON it was about but never which DEAL. §8        ║
 * ║  defines the next action as "the earliest permitted open activity linked  ║
 * ║  to that deal", which is unanswerable without the link — and the same     ║
 * ║  absence blocked next-action coverage in reporting and the "deals without ║
 * ║  a next action" row of My Work. 0124 adds it.                             ║
 * ║                                                                           ║
 * ║  ⚠️ THE DATABASE IS THE REAL WALL. 0124's composite FK on                  ║
 * ║  (opportunity_id, workspace_id) makes a cross-tenant link                  ║
 * ║  UNREPRESENTABLE, and the smoke test proves that against a real Postgres. ║
 * ║  The check asserted here is about the ANSWER: a raw FK violation reads as ║
 * ║  "Could not create that task", which tells nobody anything.               ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ PROVEN NON-VACUOUS BY BREAKING IT (§2.1): dropping the workspace filter
 * from the deal lookup fails "refuses a deal from another workspace", and
 * removing `opportunity_id` from the insert fails "writes the link it was
 * given".
 *
 * Fixtures are fabricated.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const WS = '00000000-0000-4000-8000-000000000001'
const OTHER_WS = '00000000-0000-4000-8000-000000000002'
const USER = '00000000-0000-4000-8000-000000000003'
const DEAL = '00000000-0000-4000-8000-000000000010'

const mocks = vi.hoisted(() => ({
  /** Deals keyed by id, with the workspace that owns them. */
  deals: new Map<string, string>(),
  inserted: [] as Record<string, unknown>[],
  /** Every (table, workspace_id, id) the action looked up. */
  lookups: [] as { table: string; workspaceId: string | undefined; id: string | undefined }[],
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

vi.mock('@/lib/workspaces/context', () => ({
  assertWorkspacePermission: async () => ({
    userId: USER,
    role: 'manager',
    workspace: { id: WS },
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const eq: Record<string, string> = {}
      const chain: Record<string, unknown> = {}
      Object.assign(chain, {
        select: () => chain,
        is: () => chain,
        eq: (column: string, value: string) => {
          eq[column] = value
          return chain
        },
        maybeSingle: async () => {
          mocks.lookups.push({ table, workspaceId: eq.workspace_id, id: eq.id })
          if (table === 'crm_opportunities') {
            const owner = mocks.deals.get(eq.id ?? '')
            /*
             * ⚠️ NO WORKSPACE FILTER MEANS THE ROW IS FOUND, which is what a
             * real query does. The first version of this stub returned "not
             * visible" when `workspace_id` was absent, so removing the filter
             * from the action still refused the cross-tenant deal — the test
             * passed under the mutation, for a reason that has nothing to do
             * with the code. A stub that cannot express the bug cannot catch
             * it.
             */
            if (owner === undefined) return { data: null, error: null }
            const visible = eq.workspace_id === undefined || owner === eq.workspace_id
            return { data: visible ? { id: eq.id } : null, error: null }
          }
          return { data: { id: eq.id }, error: null }
        },
        insert: async (row: Record<string, unknown>) => {
          mocks.inserted.push(row)
          return { error: null }
        },
      })
      return chain
    },
  }),
}))

const { createTaskAction } = await import('@/app/(product)/crm/tasks/actions')

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  mocks.deals = new Map([[DEAL, WS]])
  mocks.inserted = []
  mocks.lookups = []
})

describe('linking a task to a deal', () => {
  it('writes the link it was given', async () => {
    const state = await createTaskAction(null, form({ title: 'Send the proposal', opportunityId: DEAL }))

    expect(state?.ok).toBe(true)
    expect(mocks.inserted).toHaveLength(1)
    expect(mocks.inserted[0]!.opportunity_id).toBe(DEAL)
  })

  it('refuses a deal from another workspace', async () => {
    /*
     * ⚠️ AN ID FROM A FORM IS A CLAIM. The service role bypasses RLS, so
     * without the workspace filter this lookup finds the row and the task is
     * written against another tenant's deal. 0124's FK would also refuse it —
     * this is about saying which claim was rejected rather than "could not
     * create that task".
     */
    mocks.deals = new Map([[DEAL, OTHER_WS]])

    const state = await createTaskAction(null, form({ title: 'Snoop', opportunityId: DEAL }))

    expect(state?.ok).toBe(false)
    if (state && !state.ok) expect(state.error).toMatch(/not in this workspace/i)
    expect(mocks.inserted, 'a task was written anyway').toHaveLength(0)
  })

  it('scopes the lookup by workspace, not by id alone', async () => {
    await createTaskAction(null, form({ title: 'Send the proposal', opportunityId: DEAL }))

    const dealLookup = mocks.lookups.find((l) => l.table === 'crm_opportunities')
    expect(dealLookup?.workspaceId, 'the deal was looked up without a workspace filter').toBe(WS)
  })

  it('leaves the link null when none is given', async () => {
    // Most tasks are about a person. A task with no deal is the normal case,
    // and every task that existed before 0124 has none.
    const state = await createTaskAction(null, form({ title: 'Call them back' }))

    expect(state?.ok).toBe(true)
    expect(mocks.inserted[0]!.opportunity_id).toBeNull()
  })

  it('does not look up a deal that was not named', async () => {
    await createTaskAction(null, form({ title: 'Call them back' }))

    expect(mocks.lookups.filter((l) => l.table === 'crm_opportunities')).toHaveLength(0)
  })
})

/*
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE PICKER'S OWN QUERIES ARE NOT COVERED BY THE EXISTING SCAN, and that  ║
 * ║  was established by breaking one rather than assumed.                     ║
 * ║                                                                           ║
 * ║  `service-role-scoping.test.ts` asks "is this read filtered AT ALL?" — a  ║
 * ║  deliberate weakening documented in that file, because the strict         ║
 * ║  question produced findings that were all correct code. Both deal-picker  ║
 * ║  queries carry `.eq('status', 'open')`, so DELETING THEIR WORKSPACE       ║
 * ║  FILTER LEAVES THAT SCAN GREEN — verified by removing it from the tasks   ║
 * ║  page and watching all 7 of its tests pass.                               ║
 * ║                                                                           ║
 * ║  An unscoped picker would list another tenant's deal TITLES to whoever    ║
 * ║  opened the form. The action would still refuse the link, so nothing      ║
 * ║  would be written and nothing would look broken — the leak is the         ║
 * ║  dropdown itself.                                                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
describe('the pages that offer the picker', () => {
  const PAGES = [
    'app/(product)/crm/tasks/page.tsx',
    'app/(product)/crm/contacts/[id]/page.tsx',
  ]

  /** The method chain following `.from('crm_opportunities')`, comments removed. */
  function dealQuery(file: string): string {
    const src = readFileSync(join(__dirname, '..', '..', file), 'utf8')
      // ⚠️ `\r?\n`, not `\n`: `.` does not match `\r`, so against a CRLF
      // checkout a `//.*\n` strip matches nothing and every comment survives
      // into the "code". Same regression this repo has now hit three times.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*\r?\n/g, '\n')

    const at = src.indexOf(".from('crm_opportunities')")
    expect(at, `${file} no longer queries crm_opportunities`).toBeGreaterThan(-1)

    // To the end of the statement: the chain is one expression, so the first
    // blank line after it is past the end.
    const rest = src.slice(at)
    return rest.slice(0, rest.search(/\n\s*\n/))
  }

  for (const file of PAGES) {
    it(`${file} scopes its deal list by workspace`, () => {
      expect(dealQuery(file)).toContain("eq('workspace_id'")
    })

    it(`${file} offers open deals only`, () => {
      // A won or lost deal has no future work, so it is not something a new
      // task can be the next action for.
      expect(dealQuery(file)).toContain("eq('status', 'open')")
    })
  }
})
