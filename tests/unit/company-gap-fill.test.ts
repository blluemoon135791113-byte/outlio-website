/**
 * Filling in a company that already exists.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE COMPANIES SCREEN WAS A COLUMN OF DASHES FOR ONE REASON:          ║
 * ║  `upsertCrmCompany` RETURNED THE MOMENT IT RECOGNISED A ROW.             ║
 * ║                                                                           ║
 * ║  A company is almost always created first by a LEAD extraction, which     ║
 * ║  sees a NAME and nothing else. Every richer sighting afterwards matched    ║
 * ║  that row and threw away everything it knew, so the thinnest possible     ║
 * ║  observation won permanently.                                             ║
 * ║                                                                           ║
 * ║  ⚠️ AND THE OBVIOUS FIX IS WORSE THAN THE BUG. A plain UPDATE with the    ║
 * ║  whole input ERASES a value on every ingest that does not carry it — and  ║
 * ║  a lead extraction carries almost nothing, so importing one CSV would     ║
 * ║  blank the industry on every company in it. Silently, and invisibly until ║
 * ║  somebody noticed the screen had gone empty again.                        ║
 * ║                                                                           ║
 * ║  So: fill gaps, never overwrite, never null out. These tests exist to     ║
 * ║  stop the "simplification" that turns this back into a blind update.      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Reply = { data: unknown; error: unknown }
type Call = {
  table: string
  op: 'select' | 'insert' | 'update'
  filters: Record<string, unknown>
  payload?: Record<string, unknown>
}

const replies = new Map<string, Reply>()
const calls: Call[] = []
/** Queued answers for the successive `select`s a single upsert performs. */
const selectQueue: Reply[] = []

function builder(table: string) {
  const call: Call = { table, op: 'select', filters: {} }

  const thenable = {
    select: () => thenable,
    insert: (payload: Record<string, unknown>) => {
      call.op = 'insert'
      call.payload = payload
      return thenable
    },
    update: (payload: Record<string, unknown>) => {
      call.op = 'update'
      call.payload = payload
      return thenable
    },
    eq: (k: string, v: unknown) => {
      call.filters[k] = v
      return thenable
    },
    is: (k: string, v: unknown) => {
      call.filters[`is:${k}`] = v
      return thenable
    },
    maybeSingle: () => {
      calls.push(call)
      return Promise.resolve(
        selectQueue.shift() ?? replies.get(table) ?? { data: null, error: null },
      )
    },
    single: () => {
      calls.push(call)
      return Promise.resolve(replies.get(`${table}:insert`) ?? { data: { id: 'new' }, error: null })
    },
    then: (resolve: (r: Reply) => unknown) => {
      calls.push(call)
      return Promise.resolve({ data: null, error: null }).then(resolve)
    },
  }

  return thenable
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: (table: string) => builder(table) }),
}))

const { upsertCrmCompany } = await import('@/lib/crm/repository')

beforeEach(() => {
  replies.clear()
  calls.length = 0
  selectQueue.length = 0
})

/** A row that already exists, holding only what a name-only extraction saw. */
const BARE_EXISTING = {
  domain: null,
  normalized_domain: null,
  linkedin_url: null,
  normalized_linkedin_url: null,
  industry: null,
  employee_count: null,
  headquarters: null,
  source_company_id: null,
}

/**
 * The upsert runs its identity `select`s first, then — on a match — reads the
 * current row. Queueing the answers in order drives both halves.
 */
function existingCompany(current: Record<string, unknown>) {
  // The name-match lookup finds it.
  selectQueue.push({ data: { id: 'co-1' }, error: null })
  // …then `fillCompanyGaps` reads its current values.
  selectQueue.push({ data: current, error: null })
}

const update = () => calls.find((c) => c.op === 'update')

describe('the double is wired, so a pass means something', () => {
  it('recognises the existing row rather than inserting a second one', async () => {
    existingCompany(BARE_EXISTING)

    const result = await upsertCrmCompany('w1', { name: 'Acme', industry: 'Software' })

    expect(result).toMatchObject({ id: 'co-1', created: false })
    // A harness that silently missed would insert, and every assertion about
    // the UPDATE below would pass against nothing.
    expect(calls.some((c) => c.op === 'insert')).toBe(false)
    expect(update()).toBeDefined()
  })
})

describe('filling gaps', () => {
  it('writes a fact the existing row does not have', async () => {
    existingCompany(BARE_EXISTING)

    await upsertCrmCompany('w1', {
      name: 'Acme',
      industry: 'Software',
      employeeCount: 240,
      headquarters: 'London, England',
    })

    expect(update()!.payload).toMatchObject({
      industry: 'Software',
      employee_count: 240,
      headquarters: 'London, England',
    })
  })

  /*
   * ⚠️ THE STRUCTURAL LINK, AND THE ONE WITH THE WIDEST BLAST RADIUS. Nothing
   * had ever set `source_company_id`, and `companyDetails` early-returns on a
   * null one — so funding, tech stack, news and socials rendered empty in
   * every workspace while the evidence sat in the database.
   */
  it('fills source_company_id, which nothing had ever written', async () => {
    existingCompany(BARE_EXISTING)

    await upsertCrmCompany('w1', { name: 'Acme', sourceCompanyId: 'research-1' })

    expect(update()!.payload).toMatchObject({ source_company_id: 'research-1' })
  })

  it('moves a normalized pair together, never the display value alone', async () => {
    existingCompany(BARE_EXISTING)

    await upsertCrmCompany('w1', { name: 'Acme', websiteUrl: 'https://acme.example.com' })

    const payload = update()!.payload!
    // A `domain` without its `normalized_domain` would be displayed and never
    // matched on, which is worse than not storing it at all.
    expect(payload.domain).toBeTruthy()
    expect(payload.normalized_domain).toBeTruthy()
  })
})

describe('never overwriting', () => {
  /*
   * ⚠️ THE REGRESSION THIS FILE EXISTS FOR. A lead extraction carries a name
   * and nothing else; if it could overwrite, one import would blank the
   * industry on every company it mentioned.
   */
  it('does not null out a value the input does not carry', async () => {
    existingCompany({
      ...BARE_EXISTING,
      industry: 'Software',
      employee_count: 240,
      headquarters: 'London, England',
    })

    await upsertCrmCompany('w1', { name: 'Acme' })

    // Nothing new to say, so nothing is written at all.
    expect(update()).toBeUndefined()
  })

  it('leaves an existing value alone when the input disagrees', async () => {
    existingCompany({ ...BARE_EXISTING, industry: 'Software' })

    await upsertCrmCompany('w1', { name: 'Acme', industry: 'Information Technology' })

    // First observation wins. A later source may fill a gap, never relabel.
    expect(update()).toBeUndefined()
  })

  it('fills only the gap when some fields are already known', async () => {
    existingCompany({ ...BARE_EXISTING, industry: 'Software' })

    await upsertCrmCompany('w1', {
      name: 'Acme',
      industry: 'Information Technology',
      employeeCount: 240,
    })

    const payload = update()!.payload!
    expect(payload.employee_count).toBe(240)
    expect(payload).not.toHaveProperty('industry')
  })

  /*
   * ⚠️ `employee_count` IS A NUMBER, SO ZERO IS A VALUE. Testing it with
   * falsiness would treat a recorded 0 as "not known" and let a later source
   * overwrite it.
   */
  it('treats a recorded zero headcount as known', async () => {
    existingCompany({ ...BARE_EXISTING, employee_count: 0 })

    await upsertCrmCompany('w1', { name: 'Acme', employeeCount: 500 })

    expect(update()).toBeUndefined()
  })
})

describe('tenancy', () => {
  it('scopes both the read and the write by workspace', async () => {
    existingCompany(BARE_EXISTING)

    await upsertCrmCompany('w1', { name: 'Acme', industry: 'Software' })

    // The service role bypasses RLS, so these filters are the tenancy wall.
    const touched = calls.filter((c) => c.table === 'crm_companies')
    expect(touched.length).toBeGreaterThan(0)
    for (const call of touched) {
      expect(call.filters.workspace_id, `a ${call.op} is unscoped`).toBe('w1')
    }
  })
})
