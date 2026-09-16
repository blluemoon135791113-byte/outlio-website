/**
 * Imported and extracted leads are routed, and a routing failure never
 * un-does the import in the person's eyes.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  BEFORE THIS, THE LEADS THAT ARRIVE UNASSIGNED ON PURPOSE WERE NEVER      ║
 * ║  ROUTED. CSV import and extractor intake emitted no event at all, so no   ║
 * ║  flow and no rule ever saw them.                                          ║
 * ║                                                                           ║
 * ║  ⚠️ ROUTING RUNS AFTER THE CONTACTS EXIST. If a routing failure reached   ║
 * ║  the import's own catch, the message would be "Nothing was changed" about ║
 * ║  an import that changed a great deal.                                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Fixtures are fabricated.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const WS = '00000000-0000-4000-8000-000000000001'
const BATCH = '00000000-0000-4000-8000-00000000ba7c'

const mocks = vi.hoisted(() => ({
  ingestResult: null as null | Record<string, unknown>,
  ingestThrows: false,
  routing: null as null | { assigned: number; unassigned: number; alreadyOwned: number },
  routingThrows: false,
  routeCalls: [] as [string, string][],
}))

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/workspaces/context', () => ({
  assertWorkspacePermission: async () => ({ userId: 'u1', role: 'manager', workspace: { id: WS } }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/crm/ingest', () => ({
  ingestExtractionJob: async () => {
    if (mocks.ingestThrows) throw new Error('no such extraction job')
    return mocks.ingestResult
  },
  runCsvImport: async () => mocks.ingestResult,
  undoBatch: async () => ({ contactsDeleted: 0 }),
}))
vi.mock('@/lib/crm/routing', () => ({
  routeBatch: async (workspaceId: string, batchId: string) => {
    mocks.routeCalls.push([workspaceId, batchId])
    if (mocks.routingThrows) throw new Error('routeBatch failed: boom')
    return mocks.routing
  },
}))

const { sendExtractionToCrm } = await import('@/app/(product)/crm/import/actions')

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  mocks.ingestResult = {
    batchId: BATCH,
    rowsSeen: 10,
    contactsCreated: 8,
    contactsMatched: 2,
    rowsSkipped: 0,
    reRun: false,
  }
  mocks.ingestThrows = false
  mocks.routing = { assigned: 5, unassigned: 3, alreadyOwned: 0 }
  mocks.routingThrows = false
  mocks.routeCalls = []
})

describe('extractor intake', () => {
  it('routes the batch it just created', async () => {
    await sendExtractionToCrm(null, form({ jobId: 'job-1' }))

    expect(mocks.routeCalls).toEqual([[WS, BATCH]])
  })

  it('says how many leads were routed and how many are waiting', async () => {
    const state = await sendExtractionToCrm(null, form({ jobId: 'job-1' }))

    expect(state?.ok).toBe(true)
    if (state && state.ok) {
      expect(state.message).toContain('8 added')
      expect(state.message).toContain('5 routed to an owner')
      expect(state.message).toContain('3 waiting for an owner')
    }
  })

  it('still reports a successful import when routing fails', async () => {
    mocks.routingThrows = true

    const state = await sendExtractionToCrm(null, form({ jobId: 'job-1' }))

    expect(state?.ok, 'a routing failure was reported as a failed import').toBe(true)
    if (state && state.ok) {
      expect(state.message).toContain('8 added')
      expect(state.message).toMatch(/routing did not run/i)
    }
  })

  it('does not route when the import itself failed', async () => {
    mocks.ingestThrows = true

    const state = await sendExtractionToCrm(null, form({ jobId: 'job-1' }))

    expect(state?.ok).toBe(false)
    expect(mocks.routeCalls).toEqual([])
  })

  it('says nothing about routing when the import created nobody', async () => {
    mocks.ingestResult = { ...mocks.ingestResult!, contactsCreated: 0, contactsMatched: 4 }
    mocks.routing = { assigned: 0, unassigned: 0, alreadyOwned: 0 }

    const state = await sendExtractionToCrm(null, form({ jobId: 'job-1' }))

    if (state && state.ok) expect(state.message).not.toMatch(/rout|waiting/i)
  })
})

describe('CSV import', () => {
  /*
   * The CSV action reads an uploaded file, writes an import job and runs a
   * parsed plan — a behavioural test would mostly exercise the mocks. The wiring
   * that matters is pinned from source: routing runs on the batch the import
   * returned, through the helper that cannot throw, and its result reaches the
   * screen.
   */
  const SRC = readFileSync(
    join(__dirname, '..', '..', 'app', '(product)', 'crm', 'import', 'actions.ts'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '')

  /*
   * ⚠️ BOUNDED TO THE CSV ACTION'S OWN BODY. The first version searched for the
   * routing call anywhere after `runCsvImport` — and the extractor action lower
   * in the same file makes exactly that call, so deleting CSV routing entirely
   * left every test green. Found by removing it on purpose.
   */
  const CSV_BODY = (() => {
    const run = SRC.indexOf('await runCsvImport(')
    expect(run, 'runCsvImport is no longer called').toBeGreaterThan(-1)
    const end = SRC.indexOf('export async function', run)
    expect(end, 'could not find where the CSV action ends').toBeGreaterThan(run)
    return SRC.slice(run, end)
  })()

  it('routes the batch runCsvImport returned, inside the CSV action itself', () => {
    expect(CSV_BODY, 'CSV import does not route its batch').toContain(
      'const routing = await routeImportedBatch(ctx.workspace.id, result.batchId)',
    )
  })

  it('routes through the helper that swallows failures, never routeBatch directly', () => {
    const helper = SRC.slice(SRC.indexOf('async function routeImportedBatch'))
    expect(helper).toMatch(/try \{\s*return await routeBatch\(workspaceId, batchId\)\s*\} catch \{\s*return null/)
    const directCalls = SRC.match(/await routeBatch\(/g) ?? []
    expect(directCalls, 'routeBatch is called outside the safe helper').toHaveLength(1)
  })

  it('hands the routing result to the result screen', () => {
    expect(SRC).toMatch(/skipped: result\.rowsSkipped,\s*routing,/)
  })
})
