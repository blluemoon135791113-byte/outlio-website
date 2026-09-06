/**
 * One unreadable plan must not take the plans page down with it.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ TWO DIFFERENT QUESTIONS, TWO DIFFERENT ANSWERS, AND CONFLATING THEM   ║
 * ║  IS HOW THIS BREAKS EITHER WAY.                                          ║
 * ║                                                                           ║
 * ║  "Which plans can somebody choose?"   → a LISTING. Drop what we cannot    ║
 * ║    read. A dropped plan cannot be seen or bought: fail-CLOSED.            ║
 * ║                                                                           ║
 * ║  "What is THIS user allowed to do?"   → a DECISION. Throw. Proceeding     ║
 * ║    against a plan we cannot read means inventing an allowance, which is   ║
 * ║    fail-OPEN and is exactly what the schema's "fail loudly" rule forbids. ║
 * ║                                                                           ║
 * ║  Production's `agency` blob is missing `credits_per_month`, so it is the  ║
 * ║  live instance of this. It is inactive today; flipping one boolean would  ║
 * ║  have broken /admin and /dashboard/access for every user in the system.  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const GOOD_LIMITS = {
  credits_per_month: 100,
  files_per_extraction: 10,
  extractions_per_day: null,
  extractions_per_month: null,
  records_per_extraction: null,
  records_per_month: 2500,
  storage_bytes: 1073741824,
  exports_per_month: null,
  retention_days: 30,
}

/** The production agency shape: every key but the required allowance. */
const MALFORMED_LIMITS = { ...GOOD_LIMITS, credits_per_month: undefined }

const rows = {
  active: [
    { id: 'p1', key: 'starter', name: 'Lead Engine', is_active: true, limits: GOOD_LIMITS },
    { id: 'p2', key: 'agency', name: 'Agency', is_active: true, limits: MALFORMED_LIMITS },
    { id: 'p3', key: 'custom', name: 'Pro + Hubble', is_active: true, limits: GOOD_LIMITS },
  ],
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({ data: rows.active, error: null }),
          maybeSingle: () => ({ data: rows.active[1], error: null }),
        }),
      }),
    }),
  }),
}))

const { getPlanById, getPlanByKey, listActivePlans } = await import('@/lib/limits/plans')

describe('listActivePlans', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('returns the readable plans and drops the one it cannot parse', async () => {
    // Silenced so the expected report does not look like a test failure.
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const plans = await listActivePlans()

    expect(
      plans.map((p) => p.key),
      'one malformed plan rejected the whole listing — /admin and ' +
        '/dashboard/access would both be down for every user',
    ).toEqual(['starter', 'custom'])
  })

  it('reports the plan it dropped, by key', async () => {
    /*
     * ⚠️ SILENTLY SKIPPING WOULD BE ITS OWN BUG. A plan that vanishes from the
     * pricing page with no trace is a support ticket nobody can reproduce —
     * "the Agency tier isn't showing" with a clean error log. The point of
     * degrading is to stay up, not to stop telling anyone.
     */
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await listActivePlans()

    expect(spy).toHaveBeenCalled()
    const logged = spy.mock.calls.flat().map((a) => JSON.stringify(a)).join(' ')
    expect(logged).toContain('agency')
  })

  it('does not invent limits for the plan it dropped', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const plans = await listActivePlans()

    // The failure mode worth more than the outage: an agency row appearing
    // with a defaulted allowance nobody priced.
    expect(plans.some((p) => p.key === 'agency')).toBe(false)
  })
})

describe('an access decision still refuses to guess', () => {
  it('getPlanById throws on a plan it cannot read', async () => {
    /*
     * ⚠️ THE ASYMMETRY IS THE DESIGN. This is the call behind "what is this
     * user allowed to do". Returning null here would read as "no plan" — which
     * downgrades a paying customer — and returning defaults would grant an
     * allowance nobody set. Throwing is the only answer that is not a lie.
     */
    await expect(getPlanById('p2')).rejects.toThrow(/malformed limits blob/i)
  })

  it('getPlanByKey throws too', async () => {
    await expect(getPlanByKey('agency' as never)).rejects.toThrow(/malformed limits blob/i)
  })
})
