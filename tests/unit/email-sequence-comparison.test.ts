/**
 * Ranking sequences against each other.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE DENOMINATOR IS THE WHOLE FEATURE.                                ║
 * ║                                                                           ║
 * ║  `/email/analytics` measures replies per MESSAGE, which is right for a    ║
 * ║  mailbox health screen. Ranking SEQUENCES by that number punishes         ║
 * ║  following up: a four-step sequence reaches the same people four times    ║
 * ║  and quarters its own rate against a one-step blast, so the blast wins a  ║
 * ║  comparison it should lose — and a manager deletes the sequence that was  ║
 * ║  working.                                                                 ║
 * ║                                                                           ║
 * ║  `lib/crm/metrics.ts` already made this call for the reports page: using  ║
 * ║  the event count "would punish doing the job properly". The two figures   ║
 * ║  now sit two clicks apart, so it is asserted here rather than assumed.    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Reply = { data: unknown; error: unknown }
type Call = { table: string; filters: Record<string, unknown> }

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
      call.filters[`in:${k}`] = v
      return thenable
    },
    is: (k: string, v: unknown) => {
      call.filters[`is:${k}`] = v
      return thenable
    },
    not: () => thenable,
    gte: (k: string, v: unknown) => {
      call.filters[`gte:${k}`] = v
      return thenable
    },
    lte: (k: string, v: unknown) => {
      call.filters[`lte:${k}`] = v
      return thenable
    },
    order: () => thenable,
    limit: () => thenable,
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

const { gatherSequenceStats, totalsOf, rateOf, caveatFor, REPLY_FIX_DATE, RATE_FLOOR } =
  await import('@/lib/email/analysis')

beforeEach(() => {
  replies.clear()
  asked.length = 0
})

const campaign = (id: string, name: string) => ({
  id,
  name,
  type: 'sales_sequence',
  status: 'running',
})

const event = (
  campaignId: string,
  contactId: string | null,
  type: string,
  occurredAt = '2026-09-10T09:00:00.000Z',
) => ({ campaign_id: campaignId, contact_id: contactId, type, occurred_at: occurredAt })

/** `n` people, each contacted once by `campaignId`. */
function contacted(campaignId: string, n: number, prefix = 'p') {
  return Array.from({ length: n }, (_, i) => event(campaignId, `${prefix}${i}`, 'sent'))
}

describe('the double is wired, so a pass means something', () => {
  it('reads campaigns and events and returns a row per active sequence', async () => {
    replies.set('email_campaigns', { data: [campaign('c1', 'Founders')], error: null })
    replies.set('email_events', { data: contacted('c1', 3), error: null })

    const rows = await gatherSequenceStats('w1')

    expect(asked.map((a) => a.table)).toEqual(['email_campaigns', 'email_events'])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.contacted).toBe(3)
  })
})

describe('the reply rate is per person, not per message', () => {
  /*
   * ⚠️ THE CENTRAL TEST. Same people, same repliers — one sequence follows up
   * three extra times. Per MESSAGE it would look four times worse; per person
   * the two are identical, which is the truth.
   */
  it('does not punish a sequence for following up', async () => {
    replies.set('email_campaigns', {
      data: [campaign('blast', 'One-shot'), campaign('seq', 'Four steps')],
      error: null,
    })

    const people = Array.from({ length: 40 }, (_, i) => `p${i}`)
    const events = [
      // One message each.
      ...people.map((p) => event('blast', p, 'sent')),
      // Four messages each, to the same forty people.
      ...[0, 1, 2, 3].flatMap(() => people.map((p) => event('seq', p, 'sent'))),
      // Ten repliers in both.
      ...people.slice(0, 10).map((p) => event('blast', p, 'replied')),
      ...people.slice(0, 10).map((p) => event('seq', p, 'replied')),
    ]

    replies.set('email_events', { data: events, error: null })

    const rows = await gatherSequenceStats('w1')
    const blast = rows.find((r) => r.campaignId === 'blast')!
    const seq = rows.find((r) => r.campaignId === 'seq')!

    expect(blast.sent).toBe(40)
    expect(seq.sent).toBe(160)
    // The messages differ fourfold; the people and the repliers do not.
    expect(blast.contacted).toBe(40)
    expect(seq.contacted).toBe(40)
    expect(blast.replyRate).toBe(25)
    expect(seq.replyRate).toBe(25)
  })

  it('counts a person once however many times they replied', async () => {
    replies.set('email_campaigns', { data: [campaign('c1', 'Founders')], error: null })
    replies.set('email_events', {
      data: [
        ...contacted('c1', 20),
        event('c1', 'p0', 'replied'),
        // A thread with three messages back is one person replying.
        event('c1', 'p0', 'replied'),
        event('c1', 'p0', 'replied'),
      ],
      error: null,
    })

    const rows = await gatherSequenceStats('w1')

    expect(rows[0]!.replied).toBe(1)
    expect(rows[0]!.replyRate).toBe(5)
  })
})

describe('what is and is not a reply', () => {
  /*
   * 0090 keeps `auto_replied` as its own event type precisely so an
   * out-of-office does not inflate the number a manager ranks sequences on.
   */
  it('never counts an auto-reply as a reply', async () => {
    replies.set('email_campaigns', { data: [campaign('c1', 'Founders')], error: null })
    replies.set('email_events', {
      data: [...contacted('c1', 20), event('c1', 'p0', 'auto_replied')],
      error: null,
    })

    const rows = await gatherSequenceStats('w1')

    expect(rows[0]!.replied).toBe(0)
    expect(rows[0]!.autoReplied).toBe(1)
    expect(rows[0]!.replyRate).toBe(0)
  })

  /*
   * ⚠️ OPENS ARE NOT RANKED ON. Apple Mail Privacy Protection pre-fetches every
   * image, so an "open" means a machine loaded a pixel — 0090 says so and this
   * table must not quietly start treating them as engagement.
   */
  it('ignores opens and clicks', async () => {
    replies.set('email_campaigns', { data: [campaign('c1', 'Founders')], error: null })
    replies.set('email_events', {
      data: [
        ...contacted('c1', 20),
        event('c1', 'p0', 'opened'),
        event('c1', 'p1', 'clicked'),
      ],
      error: null,
    })

    const rows = await gatherSequenceStats('w1')

    expect(rows[0]!.replied).toBe(0)
    expect(rows[0]!.contacted).toBe(20)
  })
})

describe('rates refuse to lie', () => {
  it('is null below the floor, never zero', async () => {
    expect(rateOf(0, RATE_FLOOR - 1)).toBeNull()
    // At the floor, zero replies is a real finding and is reported as one.
    expect(rateOf(0, RATE_FLOOR)).toBe(0)
  })

  /*
   * ⚠️ ABOVE 100 IS THE FALSE-REPLY SHAPE — replies counted against outreach
   * that was never recorded, which is exactly what the pre-2026-09-07 rows do.
   * Refusing the number beats printing an impossible one.
   */
  it('refuses a rate above 100', async () => {
    expect(rateOf(300, 30)).toBeNull()
  })

  it('recomputes the total from the totals, not by averaging the rows', async () => {
    const overall = totalsOf([
      // A tiny sequence with a spectacular rate…
      {
        campaignId: 'a', name: 'a', type: 's', status: 'running',
        contacted: 20, sent: 20, delivered: 20, replied: 20, autoReplied: 0,
        bounced: 0, unsubscribed: 0, replyRate: 100, bounceRate: null,
      },
      // …and a large one with a modest one.
      {
        campaignId: 'b', name: 'b', type: 's', status: 'running',
        contacted: 980, sent: 980, delivered: 980, replied: 0, autoReplied: 0,
        bounced: 0, unsubscribed: 0, replyRate: 0, bounceRate: null,
      },
    ])

    // Averaging the two rates would say 50%. The truth is 20 of 1,000.
    expect(overall.replyRate).toBe(2)
  })
})

describe('the window', () => {
  it('pushes the dates into the query, inclusive of the last day', async () => {
    replies.set('email_campaigns', { data: [campaign('c1', 'Founders')], error: null })

    await gatherSequenceStats('w1', { from: '2026-09-01', to: '2026-09-30', userIds: [] })

    const events = asked.find((a) => a.table === 'email_events')!
    expect(events.filters['gte:occurred_at']).toBe('2026-09-01T00:00:00.000Z')
    // The whole of the 30th, not its midnight.
    expect(events.filters['lte:occurred_at']).toBe('2026-09-30T23:59:59.999Z')
  })

  /*
   * ⚠️ A SEQUENCE THAT DID NOT RUN IN THE PERIOD IS ABSENT, NOT ZERO. Listing
   * it as a 0% row puts an apparent failure next to real results, and this
   * table exists for a manager to rank them.
   */
  it('drops sequences with nothing in the period', async () => {
    replies.set('email_campaigns', {
      data: [campaign('c1', 'Ran'), campaign('c2', 'Idle')],
      error: null,
    })
    replies.set('email_events', { data: contacted('c1', 5), error: null })

    const rows = await gatherSequenceStats('w1')

    expect(rows.map((r) => r.campaignId)).toEqual(['c1'])
  })
})

describe('the false-reply caveat', () => {
  const overall = (contacted: number) =>
    totalsOf([
      {
        campaignId: 'a', name: 'a', type: 's', status: 'running',
        contacted, sent: contacted, delivered: contacted, replied: 1, autoReplied: 0,
        bounced: 0, unsubscribed: 0, replyRate: null, bounceRate: null,
      },
    ])

  /*
   * ⚠️ WARNED, NOT SILENTLY EXCLUDED. Before 2026-09-07 every message in a
   * connected mailbox counted as a prospect reply — production held 254 such
   * rows. Filtering real events out on a date guess would discard genuine
   * replies too; this is the owner's data to decide about.
   */
  it('warns when the period reaches back before the reply fix', async () => {
    const note = caveatFor(overall(100), { from: '2026-08-01', to: null, userIds: [] })
    expect(note).toContain(REPLY_FIX_DATE)
  })

  it('warns when no start date is given at all', async () => {
    // Unbounded reaches back past the fix by definition.
    expect(caveatFor(overall(100), { from: null, to: null, userIds: [] })).toContain(
      REPLY_FIX_DATE,
    )
  })

  it('says nothing about it once the period starts after the fix', async () => {
    const note = caveatFor(overall(100), { from: '2026-09-08', to: null, userIds: [] })
    expect(note).toBeNull()
  })

  it('still reports a thin period when the dates are clean', async () => {
    const note = caveatFor(overall(3), { from: '2026-09-08', to: null, userIds: [] })
    expect(note).toContain('too few')
  })
})

describe('tenancy', () => {
  it('scopes every read by workspace', async () => {
    replies.set('email_campaigns', { data: [campaign('c1', 'Founders')], error: null })

    await gatherSequenceStats('w1')

    expect(asked.length).toBeGreaterThan(0)
    for (const call of asked) {
      // The service role bypasses RLS; these filters are the tenancy wall.
      expect(call.filters.workspace_id, `${call.table} is unscoped`).toBe('w1')
    }
  })
})
