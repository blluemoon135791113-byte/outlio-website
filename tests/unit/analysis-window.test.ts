/**
 * Narrowing the strategy analysis to a period and to named people.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ EVERY FAILURE MODE HERE PRODUCES A PLAUSIBLE REPORT ABOUT A REAL     ║
 * ║  PERSON, AND A MANAGER ACTS ON IT.                                        ║
 * ║                                                                           ║
 * ║  The dangerous one is the interaction, not either filter alone:            ║
 * ║  `gatherStats` uses the task rows for TWO things — counting, which must    ║
 * ║  respect the window, and attribution, which must not. Filtering the read   ║
 * ║  would rebuild `repOfContact` from in-window tasks only, so every reply    ║
 * ║  to EARLIER outreach falls through to the `null` rep and is reported as    ║
 * ║  "Unattributed". It gets worse the narrower the window — precisely when    ║
 * ║  somebody is looking closely.                                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
      filters[`in:${k}`] = v
      return thenable
    },
    gte: (k: string, v: unknown) => {
      filters[`gte:${k}`] = v
      return thenable
    },
    lte: (k: string, v: unknown) => {
      filters[`lte:${k}`] = v
      return thenable
    },
    not: () => thenable,
    order: () => thenable,
    limit: () => thenable,
    maybeSingle: () => {
      asked.push({ table, filters })
      return Promise.resolve(replies.get(table) ?? { data: null, error: null })
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

const { gatherStats } = await import('@/lib/linkedin/analysis')

beforeEach(() => {
  replies.clear()
  asked.length = 0
  // Nobody writes prospect messages in these fixtures unless a test says so.
  replies.set('linkedin_prospect_messages', { data: [], error: null })
  replies.set('profiles', { data: [], error: null })
})

const ADA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BEN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

/** A completed "message sent" task. */
const sent = (by: string, contact: string, completedAt: string) => ({
  id: `t-${contact}-${completedAt}`,
  outcome: 'MESSAGE_MARKED_SENT',
  completed_by: by,
  contact_id: contact,
  completed_at: completedAt,
})

const reply = (contact: string, observedAt: string) => ({
  kind: 'REPLY_RECORDED',
  contact_id: contact,
  evidence_was_unconfirmed: false,
  observed_at: observedAt,
})

const statsFor = (result: Awaited<ReturnType<typeof gatherStats>>, userId: string | null) =>
  result.perRep.find((r) => r.userId === userId)

describe('the double is wired, so a pass means something', () => {
  it('counts an unfiltered run', async () => {
    replies.set('linkedin_tasks', {
      data: [sent(ADA, 'c1', '2026-03-10T09:00:00.000Z')],
      error: null,
    })
    replies.set('linkedin_observations', {
      data: [reply('c1', '2026-03-11T09:00:00.000Z')],
      error: null,
    })

    const result = await gatherStats('w1')

    expect(result.overall.sent).toBe(1)
    expect(result.overall.replies).toBe(1)
  })
})

describe('the period', () => {
  it('counts only actions completed inside it', async () => {
    replies.set('linkedin_tasks', {
      data: [
        sent(ADA, 'c1', '2026-02-28T12:00:00.000Z'),
        sent(ADA, 'c2', '2026-03-15T12:00:00.000Z'),
        sent(ADA, 'c3', '2026-04-02T12:00:00.000Z'),
      ],
      error: null,
    })

    const result = await gatherStats('w1', {
      from: '2026-03-01',
      to: '2026-03-31',
      userIds: [],
    })

    expect(result.overall.sent).toBe(1)
  })

  /*
   * ⚠️ THE BOUNDARY BUG THIS EXISTS TO STOP. A naive `<= '2026-03-31'` compares
   * against midnight and silently discards that entire day's work — a whole
   * day of somebody's outreach missing, with nothing to indicate it.
   */
  it('includes the whole of the last day, not just its midnight', async () => {
    replies.set('linkedin_tasks', {
      data: [
        sent(ADA, 'c1', '2026-03-31T23:59:00.000Z'),
        sent(ADA, 'c2', '2026-03-01T00:00:00.000Z'),
      ],
      error: null,
    })

    const result = await gatherStats('w1', {
      from: '2026-03-01',
      to: '2026-03-31',
      userIds: [],
    })

    // Both ends inclusive: the first instant of the 1st and the last of the 31st.
    expect(result.overall.sent).toBe(2)
  })

  it('reads everything when no dates are given', async () => {
    replies.set('linkedin_tasks', {
      data: [
        sent(ADA, 'c1', '2020-01-01T00:00:00.000Z'),
        sent(ADA, 'c2', '2026-09-01T00:00:00.000Z'),
      ],
      error: null,
    })

    const result = await gatherStats('w1')

    expect(result.overall.sent).toBe(2)
  })

  it('counts observations by when they were observed', async () => {
    replies.set('linkedin_tasks', {
      data: [sent(ADA, 'c1', '2026-03-10T09:00:00.000Z')],
      error: null,
    })
    replies.set('linkedin_observations', {
      data: [
        reply('c1', '2026-03-12T09:00:00.000Z'),
        // Same contact, same outreach — but the reply landed in April.
        reply('c1', '2026-04-12T09:00:00.000Z'),
      ],
      error: null,
    })

    const result = await gatherStats('w1', {
      from: '2026-03-01',
      to: '2026-03-31',
      userIds: [],
    })

    expect(result.overall.replies).toBe(1)
  })
})

describe('attribution does not depend on the window', () => {
  /*
   * ⚠️ THE CENTRAL TEST OF THIS FILE. February's outreach, March's reply: the
   * reply belongs to Ada, whose work it was, even though her task is outside
   * the window being counted.
   */
  it('credits a reply to whoever did the outreach, even from before the period', async () => {
    replies.set('linkedin_tasks', {
      data: [sent(ADA, 'c1', '2026-02-20T09:00:00.000Z')],
      error: null,
    })
    replies.set('linkedin_observations', {
      data: [reply('c1', '2026-03-05T09:00:00.000Z')],
      error: null,
    })

    const result = await gatherStats('w1', {
      from: '2026-03-01',
      to: '2026-03-31',
      userIds: [],
    })

    // The action is outside the window and is not counted…
    expect(result.overall.sent).toBe(0)
    // …but the reply is inside it, and it is HERS, not "Unattributed".
    expect(statsFor(result, ADA)?.replies).toBe(1)
    expect(statsFor(result, null)).toBeUndefined()
  })
})

describe('selecting people', () => {
  it('counts only the people selected', async () => {
    replies.set('linkedin_tasks', {
      data: [
        sent(ADA, 'c1', '2026-03-10T09:00:00.000Z'),
        sent(BEN, 'c2', '2026-03-10T09:00:00.000Z'),
      ],
      error: null,
    })

    const result = await gatherStats('w1', { from: null, to: null, userIds: [ADA] })

    expect(result.overall.sent).toBe(1)
    expect(statsFor(result, ADA)?.sent).toBe(1)
    expect(statsFor(result, BEN)).toBeUndefined()
  })

  /*
   * ⚠️ AN EMPTY SELECTION IS EVERYONE, NEVER NOBODY. Getting this backwards
   * produces a report of zeroes that reads exactly like a team who did no work
   * — and it is the default state of the form.
   */
  it('treats an empty selection as the whole team', async () => {
    replies.set('linkedin_tasks', {
      data: [
        sent(ADA, 'c1', '2026-03-10T09:00:00.000Z'),
        sent(BEN, 'c2', '2026-03-10T09:00:00.000Z'),
      ],
      error: null,
    })

    const result = await gatherStats('w1', { from: null, to: null, userIds: [] })

    expect(result.overall.sent).toBe(2)
  })

  /*
   * ⚠️ AN EXCLUDED PERSON'S REPLY IS DROPPED, NOT MOVED TO "Unattributed".
   * Folding it in would add replies with no sends behind them — the shape that
   * produces a reply rate above 100%, which `rateOf` then refuses, so the
   * manager sees "not enough data" on a rep who has plenty.
   */
  it('drops a reply belonging to somebody who was not selected', async () => {
    replies.set('linkedin_tasks', {
      data: [
        sent(ADA, 'c1', '2026-03-10T09:00:00.000Z'),
        sent(BEN, 'c2', '2026-03-10T09:00:00.000Z'),
      ],
      error: null,
    })
    replies.set('linkedin_observations', {
      data: [reply('c1', '2026-03-12T09:00:00.000Z'), reply('c2', '2026-03-12T09:00:00.000Z')],
      error: null,
    })

    const result = await gatherStats('w1', { from: null, to: null, userIds: [ADA] })

    expect(result.overall.replies).toBe(1)
    expect(statsFor(result, ADA)?.replies).toBe(1)
    expect(statsFor(result, null)).toBeUndefined()
  })
})

describe('the messages query carries the same window', () => {
  /*
   * ⚠️ FILTERED IN SQL, unlike the two reads above, and the `limit` is why.
   * Ordered by recency and capped, an unfiltered read of a busy workspace
   * returns messages from outside the window and none from inside it — a
   * report about the wrong period, with nothing to show anything was missing.
   */
  it('pushes the dates and the people into the query', async () => {
    replies.set('linkedin_tasks', { data: [], error: null })

    await gatherStats('w1', { from: '2026-03-01', to: '2026-03-31', userIds: [ADA] })

    const messages = asked.find((a) => a.table === 'linkedin_prospect_messages')!
    expect(messages.filters['gte:updated_at']).toBe('2026-03-01T00:00:00.000Z')
    expect(messages.filters['lte:updated_at']).toBe('2026-03-31T23:59:59.999Z')
    expect(messages.filters['in:authored_by']).toEqual([ADA])
    // The service role bypasses RLS; this filter is the tenancy wall.
    expect(messages.filters.workspace_id).toBe('w1')
  })

  it('adds no author filter when everyone is selected', async () => {
    replies.set('linkedin_tasks', { data: [], error: null })

    await gatherStats('w1', { from: null, to: null, userIds: [] })

    const messages = asked.find((a) => a.table === 'linkedin_prospect_messages')!
    expect(messages.filters['in:authored_by']).toBeUndefined()
    expect(messages.filters['gte:updated_at']).toBeUndefined()
  })
})

describe('tenancy', () => {
  it('scopes every read by workspace', async () => {
    replies.set('linkedin_tasks', { data: [], error: null })

    await gatherStats('w1', { from: '2026-03-01', to: '2026-03-31', userIds: [ADA] })

    expect(asked.length).toBeGreaterThan(0)
    for (const call of asked) {
      expect(call.filters.workspace_id, `${call.table} is unscoped`).toBe('w1')
    }
  })
})
