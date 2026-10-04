import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildImportPlan, parseCsv } from '@/lib/crm/csv-import'

// Exercise runCsvImport itself. Only the database boundary is replaced; the
// ingest double follows 0081: company_id is projected on INSERT, not a match.
type Row = Record<string, unknown>
type Call = { table: string; op: string; values?: Row | Row[]; filters: [string, string, unknown][] }
const calls: Call[] = []
const contacts: Row[] = []
const relationships: Row[] = []
const jobs: Row[] = []
let readError = false
let projectionError = false
let relationshipError = false
let beforeProjection: (() => void) | undefined
let beforeRelationship: (() => void) | undefined
let omitContactRead = false

function matches(row: Row, call: Call) {
  return call.filters.every(([op, key, value]) =>
    op === 'in' ? (value as unknown[]).includes(row[key]) : row[key] === value,
  )
}

function builder(table: string) {
  const call: Call = { table, op: 'select', filters: [] }
  let single = false
  const query = {
    select: () => query,
    insert: (values: Row | Row[]) => { call.op = 'insert'; call.values = values; return query },
    update: (values: Row) => { call.op = 'update'; call.values = values; return query },
    eq: (key: string, value: unknown) => { call.filters.push(['eq', key, value]); return query },
    is: (key: string, value: unknown) => { call.filters.push(['is', key, value]); return query },
    in: (key: string, value: unknown) => { call.filters.push(['in', key, value]); return query },
    maybeSingle: () => { single = true; return query },
    single: () => { single = true; return query },
    then: (resolve: (value: { data: unknown; error: unknown }) => unknown) => {
      calls.push(call)
      let rows: Row[]
      if (table === 'crm_contacts') {
        if (call.op === 'select' && readError) return Promise.resolve({ data: null, error: { message: 'read failed' } }).then(resolve)
        if (call.op === 'select' && omitContactRead) return Promise.resolve({ data: [], error: null }).then(resolve)
        if (call.op === 'update') {
          beforeProjection?.()
          beforeProjection = undefined
          if (projectionError) return Promise.resolve({ data: null, error: { message: 'projection failed' } }).then(resolve)
        }
        rows = contacts
      } else if (table === 'crm_contact_company_relationships') {
        if (call.op === 'insert') {
          beforeRelationship?.()
          beforeRelationship = undefined
          if (relationshipError) return Promise.resolve({ data: null, error: { message: 'relationship failed' } }).then(resolve)
          const added: Row[] = (Array.isArray(call.values) ? call.values : [call.values!]).map((r) => ({ deleted_at: null, ...r }))
          // Both partial unique indexes in 0071 apply, including conflicts
          // within a single statement (two CSV rows can match one person).
          const candidate = [...relationships]
          for (const row of added) {
            if (candidate.some((r) => r.workspace_id === row.workspace_id && r.contact_id === row.contact_id && r.deleted_at === null && (r.company_id === row.company_id || (r.is_primary && row.is_primary)))) {
              return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate relationship' } }).then(resolve)
            }
            candidate.push(row)
          }
          relationships.push(...added)
          return Promise.resolve({ data: added, error: null }).then(resolve)
        }
        rows = relationships
      } else if (table === 'crm_import_jobs') rows = jobs
      else if (table === 'crm_lead_batches') rows = [{ id: 'batch', workspace_id: 'workspace' }]
      else throw new Error(`Unexpected table: ${table}`)
      const selected = rows.filter((row) => matches(row, call))
      if (call.op === 'update') selected.forEach((row) => Object.assign(row, call.values))
      return Promise.resolve({ data: single ? selected[0] ?? null : selected.map((r) => ({ ...r })), error: null }).then(resolve)
    },
  }
  return query
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: builder,
    rpc: async (name: string, args: { p_workspace_id: string; p_contacts: { ref: string; company_id: string | null; emails: { identity_key: string }[] }[] }) => {
      if (name !== 'crm_ingest_contacts') throw new Error(`Unexpected RPC: ${name}`)
      const data = args.p_contacts.map((payload) => {
        let contact = contacts.find((c) => c.workspace_id === args.p_workspace_id && c.email === payload.emails[0].identity_key && c.deleted_at === null)
        const created = !contact
        if (!contact) {
          contact = { id: 'created', email: payload.emails[0].identity_key, workspace_id: args.p_workspace_id, primary_company_id: payload.company_id, deleted_at: null }
          contacts.push(contact)
        }
        return { ref: payload.ref, contact_id: contact.id, created }
      })
      return { data, error: null }
    },
  }),
}))
vi.mock('@/lib/crm/repository', () => ({ upsertCrmCompany: async () => ({ id: 'file-account' }) }))
vi.mock('@/lib/crm/lead-role-service', () => ({ applyAutoRolesQuietly: vi.fn() }))
vi.mock('@/lib/events/emit', () => ({ emitDomainEvent: vi.fn() }))

const { runCsvImport } = await import('@/lib/crm/ingest')
const plan = () => buildImportPlan(parseCsv('Name,Email\nExample Person,person@example.com'), { Name: 'full_name', Email: 'email' })
const run = () => runCsvImport('workspace', 'job', plan(), { companyId: 'account', actorUserId: 'actor' })
const completed = () => calls.some((c) => c.table === 'crm_import_jobs' && c.op === 'update' && (c.values as Row).status === 'completed')
const people = (companyId: string) => contacts.filter((c) => c.workspace_id === 'workspace' && c.primary_company_id === companyId && c.deleted_at === null)

beforeEach(() => {
  calls.length = contacts.length = relationships.length = jobs.length = 0
  readError = projectionError = relationshipError = omitContactRead = false
  beforeProjection = beforeRelationship = undefined
  contacts.push({ id: 'matched', workspace_id: 'workspace', email: 'person@example.com', primary_company_id: null, deleted_at: null })
  jobs.push({ id: 'job', workspace_id: 'workspace', filename: 'people.csv', batch_id: 'batch' })
})

describe('CSV account-preselected imports', () => {
  it('makes a matched, unlinked contact visible to the Account People query', async () => {
    const result = await run()
    expect(result).toMatchObject({ contactsCreated: 0, contactsMatched: 1 })
    expect(relationships).toMatchObject([{ contact_id: 'matched', company_id: 'account', is_primary: true }])
    expect(people('account').map((c) => c.id)).toEqual(['matched'])
    expect(completed()).toBe(true)
  })

  it('does not move or create a relationship for someone at another account', async () => {
    contacts[0].primary_company_id = 'other-account'
    await run()
    expect(people('other-account')).toHaveLength(1)
    expect(relationships).toEqual([])
  })

  it('keeps the newly created contact path working', async () => {
    contacts.length = 0
    expect(await run()).toMatchObject({ contactsCreated: 1, contactsMatched: 0 })
    expect(people('account')).toHaveLength(1)
    expect(relationships).toHaveLength(1)
  })

  it('repairs a previous relationship-only import, and is repeatable', async () => {
    relationships.push({ workspace_id: 'workspace', contact_id: 'matched', company_id: 'account', is_primary: true, deleted_at: null })
    await run()
    await run()
    expect(people('account')).toHaveLength(1)
    expect(relationships).toHaveLength(1)
  })

  it('deduplicates relationships when several CSV rows match the same contact', async () => {
    const input = plan()
    input.rows.push({ ...input.rows[0], line: 3 })
    input.rowsTotal = 2
    await runCsvImport('workspace', 'job', input, { companyId: 'account' })
    expect(people('account')).toHaveLength(1)
    expect(relationships).toHaveLength(1)
  })

  it('preserves an explicit company in the file instead of the page fallback', async () => {
    contacts.length = 0
    const input = plan()
    input.rows[0].company = { name: 'File Account', websiteUrl: null, linkedInUrl: null }
    await runCsvImport('workspace', 'job', input, { companyId: 'account' })
    expect(people('file-account')).toHaveLength(1)
    expect(people('account')).toEqual([])
  })

  it('scopes every contact read/update to the workspace and live contacts', async () => {
    contacts.push({ id: 'foreign', workspace_id: 'other-workspace', primary_company_id: null, deleted_at: null })
    await run()
    for (const call of calls.filter((c) => c.table === 'crm_contacts')) {
      expect(call.filters).toContainEqual(['eq', 'workspace_id', 'workspace'])
      expect(call.filters).toContainEqual(['is', 'deleted_at', null])
      expect(call.filters.some(([op, key]) => op === 'in' && key === 'id')).toBe(true)
    }
    expect(contacts[1].primary_company_id).toBeNull()
  })

  it('refuses a foreign import job before ingesting', async () => {
    jobs[0].workspace_id = 'other-workspace'
    await expect(run()).rejects.toThrow('no such import job')
    expect(relationships).toEqual([])
    expect(completed()).toBe(false)
  })

  it.each(['read', 'missing', 'relationship', 'projection'])('never reports completion after a %s failure', async (failure) => {
    readError = failure === 'read'
    omitContactRead = failure === 'missing'
    relationshipError = failure === 'relationship'
    projectionError = failure === 'projection'
    await expect(run()).rejects.toThrow()
    expect(contacts[0].primary_company_id).toBeNull()
    expect(completed()).toBe(false)
  })

  it('repairs on retry after the projection write failed', async () => {
    projectionError = true
    await expect(run()).rejects.toThrow()
    expect(relationships).toHaveLength(1)
    projectionError = false
    await run()
    expect(relationships).toHaveLength(1)
    expect(people('account')).toHaveLength(1)
  })

  it('does not overwrite an account assigned concurrently before the projection write', async () => {
    beforeProjection = () => { contacts[0].primary_company_id = 'concurrent-account' }
    await expect(run()).rejects.toThrow()
    expect(people('concurrent-account')).toHaveLength(1)
    expect(completed()).toBe(false)
    const update = calls.find((c) => c.table === 'crm_contacts' && c.op === 'update')!
    expect(update.filters).toContainEqual(['is', 'primary_company_id', null])
  })

  it('does not claim completion on a concurrent primary-relationship conflict', async () => {
    beforeRelationship = () => relationships.push({ workspace_id: 'workspace', contact_id: 'matched', company_id: 'concurrent-account', is_primary: true, deleted_at: null })
    await expect(run()).rejects.toThrow('duplicate relationship')
    expect(contacts[0].primary_company_id).toBeNull()
    expect(completed()).toBe(false)
  })

  it('can retry after another import inserted the same relationship concurrently', async () => {
    beforeRelationship = () => relationships.push({ workspace_id: 'workspace', contact_id: 'matched', company_id: 'account', is_primary: true, deleted_at: null })
    await expect(run()).rejects.toThrow('duplicate relationship')
    expect(completed()).toBe(false)
    await run()
    expect(relationships).toHaveLength(1)
    expect(people('account')).toHaveLength(1)
  })

  it.each(['error', 'missing'])('does not claim completion when final verification returns %s', async (failure) => {
    beforeProjection = () => {
      readError = failure === 'error'
      omitContactRead = failure === 'missing'
    }
    await expect(run()).rejects.toThrow()
    expect(completed()).toBe(false)
  })

  it('chunks projection queries for imports larger than 200 contacts', async () => {
    contacts.length = 0
    for (let i = 0; i < 201; i += 1) {
      contacts.push({ id: `matched-${i}`, workspace_id: 'workspace', email: `person${i}@example.com`, primary_company_id: null, deleted_at: null })
    }
    const input = plan()
    input.rows = contacts.map((c, i) => ({ line: i + 2, company: null, contact: { fullName: `Example ${i}`, emails: [String(c.email)] } }))
    input.rowsTotal = input.rows.length
    expect(await runCsvImport('workspace', 'job', input, { companyId: 'account' })).toMatchObject({ contactsCreated: 0, contactsMatched: 201 })
    expect(people('account')).toHaveLength(201)
    expect(relationships).toHaveLength(201)
    for (const call of calls.filter((c) => c.table === 'crm_contacts')) {
      const ids = call.filters.find(([op, key]) => op === 'in' && key === 'id')![2] as string[]
      expect(ids.length).toBeLessThanOrEqual(200)
    }
  })
})
