/**
 * Opportunities board lists (stages): add, rename, reorder, remove.
 * An in-memory table fake stands in for PostgREST so the ordering and the
 * refusal rules are exercised for real, not just the calls made.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
let tables: Record<string, Row[]> = {}

function query(table: string) {
  const filters: Array<(r: Row) => boolean> = []
  let order: { key: string; asc: boolean } | null = null
  let mode: 'select' | 'update' | 'insert' = 'select'
  let patch: Row = {}
  let head = false

  const rows = () => {
    const out = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
    if (order) {
      const { key, asc } = order
      out.sort((a, b) => ((a[key] as number) - (b[key] as number)) * (asc ? 1 : -1))
    }
    return out
  }

  const chain: Record<string, unknown> = {
    select: (_cols?: string, opts?: { head?: boolean }) => {
      head = Boolean(opts?.head)
      return chain
    },
    eq: (k: string, v: unknown) => {
      filters.push((r) => r[k] === v)
      return chain
    },
    is: (k: string, v: unknown) => {
      filters.push((r) => (r[k] ?? null) === v)
      return chain
    },
    order: (key: string, opts: { ascending: boolean }) => {
      order = { key, asc: opts.ascending }
      return chain
    },
    update: (p: Row) => {
      mode = 'update'
      patch = p
      return chain
    },
    insert: (row: Row) => {
      ;(tables[table] ??= []).push({ id: `new-${tables[table].length}`, archived_at: null, ...row })
      return Promise.resolve({ error: null })
    },
    maybeSingle: () => Promise.resolve({ data: rows()[0] ? { ...rows()[0] } : null, error: null }),
    then: (resolve: (r: unknown) => unknown) => {
      if (mode === 'update') {
        for (const r of rows()) Object.assign(r, patch)
        return Promise.resolve({ error: null }).then(resolve)
      }
      // Copies, as PostgREST returns: a caller must not see later writes.
      const data = rows().map((r) => ({ ...r }))
      return Promise.resolve(head ? { count: data.length, error: null } : { data, error: null }).then(resolve)
    },
  }
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: query }) }))

const { PipelineLists, ListRuleError } = await import('@/lib/crm/stages')

const W = 'w1'
const P = 'p1'

function stage(id: string, kind: string, sort_order: number, workspace_id = W): Row {
  return { id, workspace_id, pipeline_id: P, name: id, kind, sort_order, archived_at: null }
}

const active = () =>
  tables.crm_pipeline_stages
    .filter((s) => s.archived_at === null)
    .sort((a, b) => (a.sort_order as number) - (b.sort_order as number))
    .map((s) => s.name)

beforeEach(() => {
  tables = {
    crm_pipelines: [{ id: P, workspace_id: W, archived_at: null }],
    crm_pipeline_stages: [stage('Lead', 'open', 1), stage('Call', 'open', 2), stage('Won', 'won', 3), stage('Lost', 'lost', 4)],
    crm_opportunities: [],
  }
})

describe('PipelineLists', () => {
  it('adds a list before the closing columns', async () => {
    await new PipelineLists(W, P).add('  Follow up  ')
    expect(active()).toEqual(['Lead', 'Call', 'Follow up', 'Won', 'Lost'])
  })

  it('moves a list one place and is a no-op at the edge', async () => {
    const lists = new PipelineLists(W, P)
    await lists.move('Call', -1)
    expect(active()).toEqual(['Call', 'Lead', 'Won', 'Lost'])
    await lists.move('Call', -1)
    expect(active()).toEqual(['Call', 'Lead', 'Won', 'Lost'])
  })

  it('renames, and refuses an empty name', async () => {
    const lists = new PipelineLists(W, P)
    await lists.rename('Call', 'Discovery call')
    expect(tables.crm_pipeline_stages.find((s) => s.id === 'Call')?.name).toBe('Discovery call')
    await expect(lists.rename('Call', '   ')).rejects.toBeInstanceOf(ListRuleError)
  })

  it('archives an empty list instead of deleting it', async () => {
    await new PipelineLists(W, P).remove('Call')
    expect(active()).toEqual(['Lead', 'Won', 'Lost'])
    expect(tables.crm_pipeline_stages).toHaveLength(4)
  })

  it('refuses to remove a list that still has open cards', async () => {
    tables.crm_opportunities.push({ id: 'o1', workspace_id: W, stage_id: 'Call', status: 'open', deleted_at: null })
    await expect(new PipelineLists(W, P).remove('Call')).rejects.toThrow('Move the cards out')
  })

  it('refuses to remove the last open list', async () => {
    const lists = new PipelineLists(W, P)
    await lists.remove('Call')
    await expect(lists.remove('Lead')).rejects.toThrow('at least one open list')
  })

  it('treats another workspace’s board as missing', async () => {
    await expect(new PipelineLists('w-other', P).rename('Call', 'x')).rejects.toBeInstanceOf(ListRuleError)
    expect(tables.crm_pipeline_stages.find((s) => s.id === 'Call')?.name).toBe('Call')
  })
})
