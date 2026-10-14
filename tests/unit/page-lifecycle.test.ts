/**
 * Saved pages: scrubbed when read, fingerprinted, removed once spent.
 *
 * Pinned: LinkedIn session/CSRF VALUES are removed (names kept) and nothing
 * else is touched; the fingerprint is counts only; a page is MARKED before it
 * is removed, nothing is removed if the mark fails, and a failed removal is
 * un-marked for the next sweep; only the job's own, parsed pages go; nothing
 * uploaded before the cut-off is ever touched; and a path outside its owner's
 * folder is never removed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const USER = '11111111-1111-4111-8111-111111111111'
const JOB = '22222222-2222-4222-8222-222222222222'

type Row = { id: string; user_id: string; storage_path: string; status: string; created_at: string; content_purged_at: string | null }
let rows: Row[] = []
let markFails = false
let removeFails = false
let readFails = false
const removed: string[] = []
const filtersSeen: Array<Record<string, unknown>> = []

vi.mock('@/lib/upload/process', () => ({ STORAGE_BUCKET: 'uploads' }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          if (removeFails) return { error: { message: 'storage down' } }
          removed.push(...paths)
          return { error: null }
        },
      }),
    },
    from: () => {
      const filters: Record<string, unknown> = {}
      let update: Record<string, unknown> | null = null
      const matches = (row: Row) =>
        (filters.user_id === undefined || row.user_id === filters.user_id) &&
        (filters.status === undefined || row.status === filters.status) &&
        (filters.unpurged !== true || row.content_purged_at === null) &&
        (filters.gte === undefined || row.created_at >= (filters.gte as string)) &&
        (filters.lt === undefined || row.created_at < (filters.lt as string)) &&
        (filters.ids === undefined || (filters.ids as string[]).includes(row.id))
      const chain: Record<string, unknown> = {}
      const run = () => {
        filtersSeen.push({ ...filters, update })
        if (update) {
          if (markFails && update.content_purged_at !== null) return { data: null, error: { message: 'column missing' } }
          for (const row of rows.filter(matches)) Object.assign(row, update)
          return { data: null, error: null }
        }
        if (readFails) return { data: null, error: { code: '42703', message: 'column does not exist' } }
        return { data: rows.filter(matches).map(({ id, user_id, storage_path }) => ({ id, user_id, storage_path })), error: null }
      }
      Object.assign(chain, {
        select: () => chain,
        update: (values: Record<string, unknown>) => { update = values; return chain },
        eq: (column: string, value: unknown) => { filters[column === 'extraction_job_id' ? 'job' : column] = value; return chain },
        is: (column: string, value: unknown) => { if (column === 'content_purged_at' && value === null) filters.unpurged = true; return chain },
        in: (column: string, values: unknown[]) => { if (column === 'id') filters.ids = values; return chain },
        gte: (_column: string, value: string) => { filters.gte = value; return chain },
        lt: (_column: string, value: string) => { filters.lt = value; return chain },
        order: () => chain,
        limit: () => chain,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(run()).then(resolve),
      })
      return chain
    },
  }),
}))

const load = () => import('@/lib/upload/page-lifecycle')
const path = (n: number, user = USER) => `${user}/${JOB}/${n}.html`

beforeEach(() => {
  rows = []
  markFails = false
  removeFails = false
  readFails = false
  removed.length = 0
  filtersSeen.length = 0
  // The deploy instant an owner would set. Unset, purging is OFF (tested below).
  vi.stubEnv('RAW_PAGE_PURGE_FROM', '2026-10-14T12:00:00Z')
})

afterEach(() => vi.unstubAllEnvs())

describe('scrubLinkedInCredentials', () => {
  it('removes session and CSRF VALUES, keeps the names, touches nothing else', async () => {
    const { scrubLinkedInCredentials } = await load()
    const page = [
      '<meta name="csrf-token" content="ajax:1234567890123456789">',
      '<script>document.cookie="li_at=AQEDFabricatedTokenValue123; JSESSIONID=\\"ajax:9876543210987654321\\""</script>',
      '<script>{"csrfToken":"ajax:5555555555555555555","clientCsrfToken":"fabricated-token-xyz"}</script>',
      '<span data-anonymize="person-name">Jamie Rivera</span>',
      '<p>Mentions JSESSIONID in prose only.</p>',
    ].join('\n')

    const { html, removed: count } = scrubLinkedInCredentials(page)

    expect(html).not.toMatch(/AQEDFabricated|1234567890123456789|9876543210987654321|5555555555555555555|fabricated-token-xyz/)
    expect(html).toContain('li_at=[removed]')
    expect(html).toContain('<span data-anonymize="person-name">Jamie Rivera</span>')
    expect(html).toContain('<p>Mentions JSESSIONID in prose only.</p>')
    expect(count).toBeGreaterThanOrEqual(4)
  })

  it('stays linear on a hostile page of unclosed meta tags', async () => {
    const { scrubLinkedInCredentials } = await load()
    const hostile = '<meta name=csrf-token '.repeat(200_000)
    const started = Date.now()
    scrubLinkedInCredentials(hostile)
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('never changes what any parser fixture yields', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const { scrubLinkedInCredentials } = await load()
    const { detectSavedPageType } = await import('@/lib/leads/page-type')
    const { parseSearchResults } = await import('@/lib/leads/parse')
    const dir = 'tests/fixtures/html'
    let compared = 0
    for (const name of readdirSync(dir)) {
      const raw = readFileSync(`${dir}/${name}`, 'utf8')
      if (detectSavedPageType(raw) !== 'lead_search') continue
      const before = (() => { try { return JSON.stringify(parseSearchResults(raw)) } catch (e) { return String(e) } })()
      const after = (() => { try { return JSON.stringify(parseSearchResults(scrubLinkedInCredentials(raw).html)) } catch (e) { return String(e) } })()
      expect(after, name).toBe(before)
      compared += 1
    }
    expect(compared).toBeGreaterThan(0)
  })

  it('leaves a page with no credentials byte-for-byte unchanged', async () => {
    const { scrubLinkedInCredentials } = await load()
    const page = '<html><span data-anonymize="title">Founder</span></html>'
    expect(scrubLinkedInCredentials(page)).toEqual({ html: page, removed: 0 })
  })
})

describe('pageCensus', () => {
  it('is counts only — no value from the page is copied into it', async () => {
    const { pageCensus } = await load()
    const html = '<span data-anonymize="person-name">Jamie Rivera</span><span data-anonymize="person-name">Priya Shah</span><span data-anonymize="title">Founder</span>'
    const census = pageCensus({ html, pageType: 'lead_search', bytes: 1000, encoding: 'utf-8', credentialsScrubbed: 0 })

    expect(census.anchors['person-name']).toBe(2)
    expect(census.anchors.title).toBe(1)
    expect(JSON.stringify(census)).not.toMatch(/Jamie|Priya|Founder/)
  })
})

describe('purgeFrom', () => {
  it('is OFF until an owner sets it — no built-in date can delete anything', async () => {
    const { purgeFrom, discardProcessedPages, purgeDuePages } = await load()
    vi.stubEnv('RAW_PAGE_PURGE_FROM', '')
    expect(purgeFrom()).toBeNull()
    vi.stubEnv('RAW_PAGE_PURGE_FROM', 'not a date')
    expect(purgeFrom()).toBeNull()

    rows = [{ id: 'a', user_id: USER, storage_path: path(1), status: 'processed', created_at: '2026-12-01T00:00:00Z', content_purged_at: null }]
    expect(await discardProcessedPages(JOB, USER)).toBe(0)
    expect(await purgeDuePages(200, new Date('2027-01-01T00:00:00Z'))).toEqual({ processed: 0, expired: 0 })
    expect(removed).toEqual([])
  })

  it('reads the instant an owner sets', async () => {
    const { purgeFrom } = await load()
    vi.stubEnv('RAW_PAGE_PURGE_FROM', '2026-08-01T00:00:00Z')
    expect(purgeFrom()?.toISOString()).toBe('2026-08-01T00:00:00.000Z')
  })
})

describe('discardProcessedPages', () => {
  const NEW = '2026-10-15T10:00:00Z'

  it("removes the finished job's parsed pages, marking them first", async () => {
    rows = [
      { id: 'a', user_id: USER, storage_path: path(1), status: 'processed', created_at: NEW, content_purged_at: null },
      { id: 'b', user_id: USER, storage_path: path(2), status: 'failed', created_at: NEW, content_purged_at: null },
    ]
    const { discardProcessedPages } = await load()

    expect(await discardProcessedPages(JOB, USER)).toBe(1)
    expect(removed).toEqual([path(1)])
    expect(rows[0]!.content_purged_at).not.toBeNull()
    // A failed page stays for the 14-day window.
    expect(rows[1]!.content_purged_at).toBeNull()
    // Scoped by the owner and the job.
    expect(filtersSeen[0]).toMatchObject({ user_id: USER, job: JOB, status: 'processed' })
  })

  it('removes NOTHING when the mark cannot be written (0157 not applied)', async () => {
    rows = [{ id: 'a', user_id: USER, storage_path: path(1), status: 'processed', created_at: NEW, content_purged_at: null }]
    markFails = true
    const { discardProcessedPages } = await load()

    expect(await discardProcessedPages(JOB, USER)).toBe(0)
    expect(removed).toEqual([])
  })

  it('un-marks a page whose removal failed, so the sweep retries it', async () => {
    rows = [{ id: 'a', user_id: USER, storage_path: path(1), status: 'processed', created_at: NEW, content_purged_at: null }]
    removeFails = true
    const { discardProcessedPages } = await load()

    expect(await discardProcessedPages(JOB, USER)).toBe(0)
    expect(rows[0]!.content_purged_at).toBeNull()
  })

  it('never touches a page uploaded before the cut-off', async () => {
    rows = [{ id: 'old', user_id: USER, storage_path: path(1), status: 'processed', created_at: '2026-09-01T00:00:00Z', content_purged_at: null }]
    const { discardProcessedPages } = await load()

    expect(await discardProcessedPages(JOB, USER)).toBe(0)
    expect(removed).toEqual([])
  })

  it("never removes a path outside its owner's folder", async () => {
    const OTHER = '33333333-3333-4333-8333-333333333333'
    rows = [{ id: 'a', user_id: USER, storage_path: path(1, OTHER), status: 'processed', created_at: NEW, content_purged_at: null }]
    const { discardProcessedPages } = await load()

    expect(await discardProcessedPages(JOB, USER)).toBe(0)
    expect(removed).toEqual([])
  })
})

describe('purgeDuePages', () => {
  it('THROWS when it cannot read, so the tick records a failure instead of "0 removed"', async () => {
    readFails = true
    const { purgeDuePages } = await load()
    await expect(purgeDuePages(200, new Date('2026-11-20T00:00:00Z'))).rejects.toThrow('page sweep read failed')
  })

  it('expires pages older than 14 days, but only from the cut-off on', async () => {
    const now = new Date('2026-11-20T00:00:00Z')
    rows = [
      { id: 'old-failed', user_id: USER, storage_path: path(1), status: 'failed', created_at: '2026-10-20T00:00:00Z', content_purged_at: null },
      { id: 'recent-failed', user_id: USER, storage_path: path(2), status: 'failed', created_at: '2026-11-15T00:00:00Z', content_purged_at: null },
      { id: 'pre-cutoff', user_id: USER, storage_path: path(3), status: 'failed', created_at: '2026-09-01T00:00:00Z', content_purged_at: null },
    ]
    const { purgeDuePages } = await load()
    const outcome = await purgeDuePages(200, now)

    expect(outcome.expired).toBe(1)
    expect(removed).toEqual([path(1)])
  })
})
