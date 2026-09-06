/**
 * Company backfill — enumeration and paging.
 *
 * REGRESSION TEST FOR A REAL INCIDENT (2026-08-15).
 *
 * The first version of `listUsersWithUnlinkedLeads` used `.limit(5000)`.
 * PostgREST silently caps every response at `db-max-rows` (1000 on Supabase),
 * so a backfill over 2,213 unlinked leads enumerated only the accounts that
 * happened to fall in the first 1,000 rows — and then reported `hasMore: false`.
 * Two entire accounts, 50 perfectly linkable leads, were skipped while the
 * admin UI said the job had finished.
 *
 * A maintenance job that skips accounts while claiming success is worse than
 * one that fails loudly, so both halves are tested here: that every account is
 * found across page boundaries, and that a truncated scan admits it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  backfillCompaniesForUser,
  listUsersWithUnlinkedLeads,
} from '@/lib/companies/backfill'
import {
  adminClient,
  createAuthUser,
  deleteTestUser,
  hasSupabaseEnv,
  seedJob,
  type TestAuthUser,
} from './helpers'

async function schemaReady(): Promise<boolean> {
  if (!hasSupabaseEnv) return false
  const { error } = await adminClient().from('companies').select('id').limit(1)
  return error === null
}

const ready = await schemaReady()
const describeIf = hasSupabaseEnv && ready ? describe : describe.skip

/**
 * Small enough to guarantee several pages ACROSS THIS FIXTURE'S OWN ROWS.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THIS WAS 50, AND THE FIXTURE SEEDS 6 ROWS — 3 accounts × 2 leads.      ║
 * ║                                                                           ║
 * ║  So the first page was never full, `listUsersWithUnlinkedLeads` always     ║
 * ║  returned `truncated: false`, and the truncation test could not pass.      ║
 * ║  The paging test passed while paging exactly once, which is not paging.   ║
 * ║                                                                           ║
 * ║  ⚠️ IT USED TO PASS, AND THAT IS THE INTERESTING PART. The scan is GLOBAL  ║
 * ║  — no user filter — and until Phase 1 this suite ran against `.env.local`, ║
 * ║  which points at PRODUCTION, where `extracted_leads` holds 1,193 rows.     ║
 * ║  Somebody else's data filled the page. Moving to staging removed the       ║
 * ║  accident and left the test asserting something it had never actually      ║
 * ║  demonstrated.                                                            ║
 * ║                                                                           ║
 * ║  Below the fixture's own row count, so both tests now hold on an empty     ║
 * ║  database and on a busy one: 6 rows over pages of 2 is three real pages.  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
const SMALL_PAGE = 2

describeIf('listUsersWithUnlinkedLeads', () => {
  const users: TestAuthUser[] = []

  beforeAll(async () => {
    const admin = adminClient()

    // Three accounts, each with unlinked leads, so the scan has to survive
    // page boundaries — the exact shape that broke in production.
    for (let i = 0; i < 3; i += 1) {
      const user = await createAuthUser(`backfill-scan-${i}`)
      users.push(user)
      const jobId = await seedJob(user.id)

      await admin.from('extracted_leads').insert(
        Array.from({ length: 2 }, (_, n) => ({
          user_id: user.id,
          extraction_job_id: jobId,
          full_name: `Fabricated Person ${i}-${n}`,
          company_name: `Fabricated Co ${i}`,
          company_url: `https://www.linkedin.com/sales/company/${900000 + i}`,
          dedupe_key: `scan-${user.id}-${n}`,
          dedupe_strategy: 'row_hash' as const,
        })),
      )
    }
  })

  afterAll(async () => {
    await Promise.allSettled(users.map((user) => deleteTestUser(user.id)))
  })

  it('finds every account when the results span multiple pages', async () => {
    // A page size well below the number of unlinked rows forces the loop to
    // page. The old `.limit()` implementation stopped at the first response and
    // reported only the accounts inside it.
    const scan = await listUsersWithUnlinkedLeads(1000, SMALL_PAGE)

    expect(scan.truncated).toBe(false)
    for (const user of users) {
      expect(scan.userIds, `account ${user.id} was not enumerated`).toContain(user.id)
    }
  })

  it('admits truncation instead of reporting a complete scan', async () => {
    // One short page, then give up: the caller must be told more remain.
    const scan = await listUsersWithUnlinkedLeads(1, SMALL_PAGE)

    expect(scan.truncated).toBe(true)
  })

  it('stops listing an account once its leads are linked', async () => {
    const target = users[0]!

    const result = await backfillCompaniesForUser(target.id)
    expect(result.leadsLinked).toBe(2)
    expect(result.hasMore).toBe(false)

    const scan = await listUsersWithUnlinkedLeads(1000, SMALL_PAGE)
    expect(scan.userIds).not.toContain(target.id)
  })
})

describeIf('backfillCompaniesForUser — paging past unlinkable leads', () => {
  let user: TestAuthUser
  let jobId: string

  beforeAll(async () => {
    user = await createAuthUser('backfill-paging')
    jobId = await seedJob(user.id)

    const admin = adminClient()

    // Leads that can NEVER be linked: no name, no company page, no website.
    // These stay `company_id is null` forever and collect at the front of every
    // page, which is what stalled the naive offset-free loop.
    await admin.from('extracted_leads').insert(
      Array.from({ length: 4 }, (_, n) => ({
        user_id: user.id,
        extraction_job_id: jobId,
        full_name: `Fabricated Nameless ${n}`,
        dedupe_key: `paging-stuck-${user.id}-${n}`,
        dedupe_strategy: 'row_hash' as const,
      })),
    )

    await admin.from('extracted_leads').insert(
      Array.from({ length: 4 }, (_, n) => ({
        user_id: user.id,
        extraction_job_id: jobId,
        full_name: `Fabricated Linkable ${n}`,
        company_name: 'Pageable Systems',
        company_url: 'https://www.linkedin.com/sales/company/910001',
        dedupe_key: `paging-ok-${user.id}-${n}`,
        dedupe_strategy: 'row_hash' as const,
      })),
    )
  })

  afterAll(async () => {
    if (user) await deleteTestUser(user.id)
  })

  it('links every linkable lead and counts each lead exactly once', async () => {
    const result = await backfillCompaniesForUser(user.id)

    expect(result.leadsLinked).toBe(4)
    expect(result.leadsUnidentified).toBe(4)
    // 8 distinct leads. The old loop re-read the stuck rows on every page and
    // reported more examined than exist.
    expect(result.leadsExamined).toBe(8)
    expect(result.hasMore).toBe(false)

    const { count } = await adminClient()
      .from('extracted_leads')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('company_id', null)

    // Only the four genuinely unidentifiable leads remain.
    expect(count).toBe(4)
  })

  it('is idempotent — a second run finds nothing left to do', async () => {
    const result = await backfillCompaniesForUser(user.id)

    expect(result.leadsLinked).toBe(0)
    expect(result.hasMore).toBe(false)
  })
})
