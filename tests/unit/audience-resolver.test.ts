/**
 * Who a campaign goes to.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE FAILURES THIS GUARDS ARE ALL SILENT ONES.                        ║
 * ║                                                                           ║
 * ║  `resolveAudience` decides who gets contacted. Every way it can be wrong  ║
 * ║  produces a plausible number and no error:                                ║
 * ║                                                                           ║
 * ║    · a missing workspace filter enrols ANOTHER TENANT'S people — the      ║
 * ║      service role bypasses RLS, so this function's own `.eq()` is the     ║
 * ║      entire tenancy wall                                                  ║
 * ║    · a missing owner filter shows a setter the whole company's pipeline   ║
 * ║    · a missing de-duplication puts one person in an operator's LinkedIn   ║
 * ║      inbox three times                                                    ║
 * ║    · a silent cap drops 3,000 prospects and reports success               ║
 * ║    · counting won and lost deals aims a sequence at customers who         ║
 * ║      already bought                                                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/* ── A PostgREST double that records every filter it was handed ──────────── */

type Reply = { data: unknown; error: unknown }
type Call = { table: string; filters: Record<string, unknown>; limit?: number }

const replies = new Map<string, Reply>()
const asked: Call[] = []

function builder(table: string) {
  const call: Call = { table, filters: {} }

  const thenable = {
    select: () => thenable,
    eq: (k: string, v: unknown) => {
      call.filters[k] = v
      return thenable
    },
    in: (k: string, v: unknown) => {
      call.filters[k] = v
      return thenable
    },
    is: (k: string, v: unknown) => {
      call.filters[`is:${k}`] = v
      return thenable
    },
    not: (k: string, op: string, v: unknown) => {
      call.filters[`not:${k}:${op}`] = v
      return thenable
    },
    limit: (n: number) => {
      call.limit = n
      return thenable
    },
    maybeSingle: () => {
      asked.push(call)
      return Promise.resolve(replies.get(table) ?? { data: null, error: null })
    },
    then: (resolve: (r: Reply) => unknown) => {
      asked.push(call)
      return Promise.resolve(replies.get(table) ?? { data: [], error: null }).then(resolve)
    },
  }

  return thenable
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: (table: string) => builder(table) }),
}))

const { resolveAudience, audienceFromFormData, AudienceNotFoundError, AUDIENCE_LIMIT } =
  await import('@/lib/crm/audience')

beforeEach(() => {
  replies.clear()
  asked.length = 0
})

describe('the double is wired, so a pass means something', () => {
  it('records the filters a real query would carry', async () => {
    replies.set('crm_list_members', { data: [{ contact_id: 'c1' }], error: null })
    replies.set('crm_lists', { data: { id: 'l1' }, error: null })
    replies.set('crm_contacts', { data: [{ id: 'c1' }], error: null })

    await resolveAudience('w1', { kind: 'list', listId: 'l1' })

    // Three tables, not one — a harness that silently matched nothing would
    // make every assertion below pass against an empty recording.
    expect(asked.map((a) => a.table)).toEqual([
      'crm_lists',
      'crm_list_members',
      'crm_contacts',
    ])
  })
})

describe('tenancy', () => {
  /*
   * ⚠️ THE SINGLE MOST IMPORTANT TEST IN THIS FILE. The service role bypasses
   * RLS, so a branch that forgets `workspace_id` reads another customer's CRM
   * and returns contact ids that then get enrolled and messaged.
   */
  it.each([
    ['contacts', { kind: 'contacts' as const, contactIds: ['c1'] }],
    ['list', { kind: 'list' as const, listId: 'l1' }],
    ['stage', { kind: 'stage' as const, stageId: 's1' }],
    ['pipeline', { kind: 'pipeline' as const, pipelineId: 'p1' }],
    ['batch', { kind: 'batch' as const, batchId: 'b1' }],
  ])('scopes every query by workspace — %s', async (_name, source) => {
    replies.set('crm_lists', { data: { id: 'l1' }, error: null })
    replies.set('crm_list_members', { data: [{ contact_id: 'c1' }], error: null })
    replies.set('crm_batch_members', { data: [{ contact_id: 'c1' }], error: null })
    replies.set('crm_opportunities', { data: [{ contact_id: 'c1' }], error: null })
    replies.set('crm_contacts', { data: [{ id: 'c1' }], error: null })

    await resolveAudience('w1', source)

    expect(asked.length).toBeGreaterThan(0)
    for (const call of asked) {
      expect(call.filters.workspace_id, `${call.table} is unscoped`).toBe('w1')
    }
  })

  it('refuses a list belonging to someone else rather than reporting it empty', async () => {
    // The list read returns nothing, which is what a foreign id produces.
    replies.set('crm_lists', { data: null, error: null })

    await expect(
      resolveAudience('w1', { kind: 'list', listId: 'someone-elses' }),
    ).rejects.toBeInstanceOf(AudienceNotFoundError)
  })
})

describe('owner scope', () => {
  it('narrows contacts to the owner when one is given', async () => {
    replies.set('crm_contacts', { data: [{ id: 'c1' }], error: null })

    await resolveAudience('w1', { kind: 'contacts', contactIds: ['c1'] }, {
      ownerUserId: 'u-setter',
    })

    expect(asked.find((a) => a.table === 'crm_contacts')!.filters.owner_user_id).toBe(
      'u-setter',
    )
  })

  it('does not narrow when no owner is given', async () => {
    replies.set('crm_contacts', { data: [{ id: 'c1' }], error: null })

    await resolveAudience('w1', { kind: 'contacts', contactIds: ['c1'] })

    expect(
      asked.find((a) => a.table === 'crm_contacts')!.filters.owner_user_id,
    ).toBeUndefined()
  })

  /*
   * ⚠️ BOTH HALVES. A setter's deal can point at a contact somebody else owns.
   * Filtering only the contact would drop people out of their own stage;
   * filtering only the deal would hand them a contact they may not see.
   */
  it('scopes deals on the deal owner as well as the contact owner', async () => {
    replies.set('crm_opportunities', { data: [{ contact_id: 'c1' }], error: null })
    replies.set('crm_contacts', { data: [{ id: 'c1' }], error: null })

    await resolveAudience('w1', { kind: 'stage', stageId: 's1' }, { ownerUserId: 'u1' })

    expect(asked.find((a) => a.table === 'crm_opportunities')!.filters.owner_user_id).toBe('u1')
    expect(asked.find((a) => a.table === 'crm_contacts')!.filters.owner_user_id).toBe('u1')
  })
})

describe('deals', () => {
  /*
   * ⚠️ OPEN ONLY. On an established pipeline the won and lost deals in a stage
   * outnumber the live ones, and they include customers who already bought —
   * so "everyone in Proposal" would aim a cold sequence at existing accounts.
   */
  it('counts open deals only', async () => {
    replies.set('crm_opportunities', { data: [], error: null })

    await resolveAudience('w1', { kind: 'stage', stageId: 's1' })

    expect(asked.find((a) => a.table === 'crm_opportunities')!.filters.status).toBe('open')
  })

  it('reads a stage by stage and a pipeline by pipeline', async () => {
    replies.set('crm_opportunities', { data: [], error: null })

    await resolveAudience('w1', { kind: 'stage', stageId: 's1' })
    expect(asked.at(-1)!.filters.stage_id).toBe('s1')
    expect(asked.at(-1)!.filters.pipeline_id).toBeUndefined()

    asked.length = 0
    await resolveAudience('w1', { kind: 'pipeline', pipelineId: 'p1' })
    expect(asked.at(-1)!.filters.pipeline_id).toBe('p1')
    expect(asked.at(-1)!.filters.stage_id).toBeUndefined()
  })

  it('drops deals that carry no contact rather than counting them', async () => {
    // `crm_opportunities.contact_id` is nullable — a deal need not have a person.
    replies.set('crm_opportunities', {
      data: [{ contact_id: 'c1' }, { contact_id: null }, { contact_id: 'c2' }],
      error: null,
    })
    replies.set('crm_contacts', { data: [{ id: 'c1' }, { id: 'c2' }], error: null })

    const result = await resolveAudience('w1', { kind: 'stage', stageId: 's1' })

    expect(result.contactIds).toEqual(['c1', 'c2'])
  })
})

describe('de-duplication', () => {
  /*
   * ⚠️ NOT COSMETIC. One person can sit on two deals in the same pipeline, or
   * arrive on a list through two imports. For LinkedIn, every duplicate is
   * another task card in an operator's inbox for the same stranger.
   */
  it('asks about each contact once, however many times the source names them', async () => {
    replies.set('crm_opportunities', {
      data: [{ contact_id: 'c1' }, { contact_id: 'c1' }, { contact_id: 'c2' }],
      error: null,
    })
    replies.set('crm_contacts', { data: [{ id: 'c1' }, { id: 'c2' }], error: null })

    await resolveAudience('w1', { kind: 'pipeline', pipelineId: 'p1' })

    expect(asked.find((a) => a.table === 'crm_contacts')!.filters.id).toEqual(['c1', 'c2'])
  })

  it('de-duplicates an explicit selection too', async () => {
    replies.set('crm_contacts', { data: [{ id: 'c1' }], error: null })

    await resolveAudience('w1', { kind: 'contacts', contactIds: ['c1', 'c1', 'c1'] })

    expect(asked.find((a) => a.table === 'crm_contacts')!.filters.id).toEqual(['c1'])
  })
})

describe('deleted contacts', () => {
  /*
   * A server action is a public HTTP endpoint and the checkboxes are a claim.
   * A contact can also be deleted between rendering the page and submitting it.
   */
  it('excludes soft-deleted contacts on every source', async () => {
    replies.set('crm_contacts', { data: [], error: null })
    replies.set('crm_batch_members', { data: [{ contact_id: 'c1' }], error: null })

    await resolveAudience('w1', { kind: 'batch', batchId: 'b1' })

    expect(asked.find((a) => a.table === 'crm_contacts')!.filters['is:deleted_at']).toBeNull()
  })

  it('returns only the contacts that came back alive, not the ones asked about', async () => {
    replies.set('crm_list_members', {
      data: [{ contact_id: 'c1' }, { contact_id: 'c-deleted' }],
      error: null,
    })
    replies.set('crm_lists', { data: { id: 'l1' }, error: null })
    // The database answers with one row: `c-deleted` is gone.
    replies.set('crm_contacts', { data: [{ id: 'c1' }], error: null })

    const result = await resolveAudience('w1', { kind: 'list', listId: 'l1' })

    expect(result.contactIds).toEqual(['c1'])
  })
})

describe('the cap', () => {
  /*
   * ⚠️ REPORTED, NOT SWALLOWED. Enrolling the first 5,000 of 8,000 and saying
   * "done" is only discovered when somebody asks why 3,000 prospects were
   * never contacted.
   */
  it('flags truncation when the source holds more than the limit', async () => {
    const many = Array.from({ length: AUDIENCE_LIMIT + 10 }, (_, i) => `c${i}`)
    replies.set('crm_contacts', { data: [], error: null })

    const result = await resolveAudience('w1', { kind: 'contacts', contactIds: many })

    expect(result.truncated).toBe(true)
    expect(
      (asked.find((a) => a.table === 'crm_contacts')!.filters.id as string[]).length,
    ).toBe(AUDIENCE_LIMIT)
  })

  it('does not flag truncation for an ordinary audience', async () => {
    replies.set('crm_contacts', { data: [{ id: 'c1' }], error: null })

    const result = await resolveAudience('w1', { kind: 'contacts', contactIds: ['c1'] })

    expect(result.truncated).toBe(false)
  })

  it('asks the database for one more than the cap, so truncation is detectable', async () => {
    replies.set('crm_batch_members', { data: [], error: null })

    await resolveAudience('w1', { kind: 'batch', batchId: 'b1' })

    // Fetching exactly AUDIENCE_LIMIT rows cannot distinguish "exactly at the
    // cap" from "over it", so the flag would never fire on a full page.
    expect(asked.find((a) => a.table === 'crm_batch_members')!.limit).toBe(AUDIENCE_LIMIT + 1)
  })
})

describe('empty sources', () => {
  it('returns nothing without touching the database', async () => {
    const result = await resolveAudience('w1', { kind: 'contacts', contactIds: [] })

    expect(result).toEqual({ contactIds: [], truncated: false })
    expect(asked).toHaveLength(0)
  })
})

describe('audienceFromFormData', () => {
  const form = (entries: [string, string][]) => {
    const data = new FormData()
    for (const [k, v] of entries) data.append(k, v)
    return data
  }

  it('reads repeated contactId fields, matching every other bulk action', async () => {
    const source = audienceFromFormData(
      form([
        ['audienceKind', 'contacts'],
        ['contactId', 'c1'],
        ['contactId', 'c2'],
      ]),
    )

    expect(source).toEqual({ kind: 'contacts', contactIds: ['c1', 'c2'] })
  })

  it.each([
    ['list', 'listId'],
    ['stage', 'stageId'],
    ['pipeline', 'pipelineId'],
    ['batch', 'batchId'],
  ])('maps %s to its own id field', async (kind, field) => {
    const source = audienceFromFormData(
      form([
        ['audienceKind', kind],
        ['audienceId', 'x1'],
      ]),
    )

    expect(source).toEqual({ kind, [field]: 'x1' })
  })

  /*
   * ⚠️ NULL, NOT A THROW AND NOT A DEFAULT. "You did not choose" has to reach
   * the user as a sentence; defaulting to some source would enrol a group
   * nobody picked.
   */
  it('returns null when nothing was chosen', async () => {
    expect(audienceFromFormData(form([]))).toBeNull()
    expect(audienceFromFormData(form([['audienceKind', 'list']]))).toBeNull()
    expect(audienceFromFormData(form([['audienceKind', 'contacts']]))).toBeNull()
    expect(
      audienceFromFormData(form([['audienceKind', 'nonsense'], ['audienceId', 'x']])),
    ).toBeNull()
  })
})
