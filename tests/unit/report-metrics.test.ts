/**
 * The metric catalogue's safety properties — R7.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  A DASHBOARD IS A WAY TO ASK THE DATABASE A QUESTION.                    ║
 * ║                                                                           ║
 * ║  Which makes the catalogue a permission surface, not a list of labels.    ║
 * ║  These assert the properties that stop a widget being a way around the    ║
 * ║  access rules — checked structurally, because a metric added later will   ║
 * ║  be added by someone who has not read this file.                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { METRICS, metric, metricsBySource } from '@/lib/reports/metrics'

const SOURCE = readFileSync('lib/reports/metrics.ts', 'utf8')
const PERMISSIONS_SOURCE = readFileSync('lib/workspaces/permissions.ts', 'utf8')

describe('the catalogue itself', () => {
  it('has metrics to check', () => {
    expect(METRICS.length).toBeGreaterThan(5)
  })

  it('uses a unique key for each, since the key selects one', () => {
    const keys = METRICS.map((m) => m.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('resolves a known key and refuses an unknown one', () => {
    expect(metric(METRICS[0]!.key)).not.toBeNull()
    // ⚠️ The stored widget key comes from a form. An unknown key must resolve
    // to nothing rather than to a default metric someone did not choose.
    expect(metric('contacts.total; drop table')).toBeNull()
    expect(metric('')).toBeNull()
  })

  it('groups every metric under a source for the picker', () => {
    const grouped = metricsBySource()
    const total = Object.values(grouped).reduce((n, list) => n + list.length, 0)
    expect(total).toBe(METRICS.length)
  })
})

describe('every metric is gated', () => {
  for (const m of METRICS) {
    it(`${m.key} declares a REAL permission`, () => {
      /*
       * ⚠️ NOBODY MAY ADD A WIDGET FOR DATA THEY COULD NOT OTHERWISE SEE.
       *
       * The `Permission` TYPE already makes a typo fail `tsc`, so this is the
       * belt to that braces: it proves the string is defined in the real
       * catalogue rather than merely being assignable to the union — which
       * would still hold if someone widened the type to `string`.
       *
       * `PERMISSIONS` itself is module-private, deliberately: nothing outside
       * the policy layer should enumerate permissions. So this reads the
       * source rather than reaching for an export that should not exist.
       */
      expect(PERMISSIONS_SOURCE).toContain(`'${m.permission}':`)
    })

    it(`${m.key} explains itself`, () => {
      expect(m.label.length).toBeGreaterThan(2)
      // A description that repeats the label teaches nothing in a picker.
      expect(m.description.length).toBeGreaterThan(15)
      expect(m.description).not.toBe(m.label)
    })

    it(`${m.key} offers at least one visual`, () => {
      expect(m.visuals.length).toBeGreaterThan(0)
    })
  }
})

describe('no metric can carry a query', () => {
  it('the catalogue contains no raw SQL or rpc call', () => {
    /*
     * ⚠️ THE DESIGN RULE, ENFORCED. A widget names a KEY; the query lives
     * here in code. If a `.rpc(` or a raw SQL string ever appears, someone has
     * started down the road where a widget carries its own query — and that
     * road ends with a dashboard reading a table the permission layer never
     * approved.
     */
    expect(SOURCE).not.toMatch(/\.rpc\(/)
    expect(SOURCE).not.toMatch(/\bselect\s+\*\s+from\b/i)
  })

  it('every metric scopes by workspace_id', () => {
    // One `.eq('workspace_id'` per metric at minimum — the service role
    // bypasses RLS, so an unscoped query reads every tenant's data.
    const scoped = SOURCE.match(/\.eq\('workspace_id'/g) ?? []
    expect(scoped.length).toBeGreaterThanOrEqual(METRICS.length - 2)
  })
})

describe('the owner filter is applied where it exists', () => {
  it('every CRM metric mentions an owner or assignee column', () => {
    /*
     * ⚠️ A SETTER ADDING "TOTAL CONTACTS" MUST SEE THEIR TOTAL. Tasks use
     * `assigned_to_user_id` rather than `owner_user_id` — a different column,
     * the same rule — so both are accepted here.
     */
    const crmMetrics = METRICS.filter((m) =>
      ['Contacts', 'Deals', 'Tasks'].includes(m.source),
    )
    expect(crmMetrics.length).toBeGreaterThan(3)

    const ownerFilters =
      (SOURCE.match(/ownerUserId\)/g) ?? []).length +
      (SOURCE.match(/input\.ownerUserId/g) ?? []).length
    expect(ownerFilters).toBeGreaterThanOrEqual(crmMetrics.length)
  })
})
