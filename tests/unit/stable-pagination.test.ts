/**
 * Every paginated query needs a unique tiebreaker, or it loses rows.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ TIES ARE THE COMMON CASE HERE, NOT AN EDGE CASE.                      ║
 * ║                                                                           ║
 * ║  Batch ingestion inserts a whole extraction job in ONE transaction, so     ║
 * ║  `now()` — and therefore `created_at` — is IDENTICAL across every row in   ║
 * ║  the batch. Measured on production while writing this: 51 contacts across  ║
 * ║  9 distinct timestamps, one group of 25, and 44 of 51 rows sitting in a    ║
 * ║  tie.                                                                     ║
 * ║                                                                           ║
 * ║  Inside a tie group Postgres has NO defined order. So `?offset=10` can     ║
 * ║  return rows already sent on page 1 while others are never returned at     ║
 * ║  all — and nothing errors, no count is short, and the caller cannot tell.  ║
 * ║                                                                           ║
 * ║  `lib/crm/contacts-list.ts` has always got this right and says why: "two   ║
 * ║  contacts added in the same second can swap places between page 1 and      ║
 * ║  page 2 and a row is seen twice while another is never seen at all." The   ║
 * ║  public API, the companies page, and two worker loops did not.            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    let entries: string[]
    try {
      entries = readdirSync(d)
    } catch {
      return
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue
      const full = join(d, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.tsx?$/.test(full)) out.push(full)
    }
  }
  walk(dir)
  return out
}

const PRODUCT = [...sourceFiles(join(ROOT, 'lib')), ...sourceFiles(join(ROOT, 'app'))].map(
  (f) => ({ file: relative(ROOT, f).split('\\').join('/'), code: readFileSync(f, 'utf8') }),
)

/**
 * Columns unique enough to make an ordering total.
 *
 * ⚠️ `created_at` IS NOT ONE, which is the whole finding. Nor is `name`,
 * `user_id`, or `due_at` — anything a batch insert or an ordinary duplicate can
 * repeat.
 */
const UNIQUE_ENOUGH = ['id', 'source_row_index']

/** Every `.range(...)` call, with the `.order(...)` columns that precede it. */
function paginatedQueries(code: string): { orders: string[]; at: number }[] {
  const out: { orders: string[]; at: number }[] = []
  for (const match of code.matchAll(/\.range\(/g)) {
    const window = code.slice(Math.max(0, match.index! - 900), match.index!)
    const orders = [...window.matchAll(/\.order\('(\w+)'/g)].map((m) => m[1]!)
    if (orders.length > 0) out.push({ orders, at: match.index! })
  }
  return out
}

describe('the scanner sees what it polices', () => {
  it('reads the product and finds paginated queries', () => {
    // Vacuity: no queries found would make the assertion below pass over
    // nothing, which is how this defect survived in six routes at once.
    expect(PRODUCT.length).toBeGreaterThan(300)
    const total = PRODUCT.reduce((n, f) => n + paginatedQueries(f.code).length, 0)
    expect(total).toBeGreaterThanOrEqual(8)
  })

  it('does not accept a non-unique column as a tiebreaker', () => {
    // Proves the matcher can fail: `created_at` alone must not satisfy it.
    expect(UNIQUE_ENOUGH).not.toContain('created_at')
    expect(UNIQUE_ENOUGH).not.toContain('name')
    expect(UNIQUE_ENOUGH).not.toContain('user_id')
  })
})

describe('no paginated query can lose a row', () => {
  it('every .range() is ordered by something unique', () => {
    const offenders: string[] = []
    for (const { file, code } of PRODUCT) {
      for (const { orders } of paginatedQueries(code)) {
        if (!orders.some((column) => UNIQUE_ENOUGH.includes(column))) {
          offenders.push(`${file}  (order by ${orders.join(', ')})`)
        }
      }
    }

    expect(
      offenders,
      'These pages through rows with no unique tiebreaker. Ties are the normal ' +
        'case — a batch insert gives every row in an extraction job the same ' +
        'created_at — and inside a tie group Postgres has no defined order, so ' +
        'a row is returned twice and another never at all. Add ' +
        "`.order('id', { ascending: true })`.",
    ).toEqual([])
  })

  it('the public API is stable specifically', () => {
    /*
     * ⚠️ NAMED, NOT JUST COVERED BY THE SWEEP. This is the surface where the
     * damage is invisible and permanent: an integration paging through
     * contacts silently syncs an incomplete set, and neither side can tell.
     */
    for (const route of [
      'app/api/v1/contacts/route.ts',
      'app/api/v1/companies/route.ts',
      'app/api/v1/opportunities/route.ts',
      'app/api/v1/activities/route.ts',
      'app/api/v1/tasks/route.ts',
      'app/api/v1/lists/route.ts',
    ]) {
      const source = PRODUCT.find((f) => f.file === route)
      expect(source, `${route} moved`).toBeDefined()
      expect(source!.code, `${route} can lose rows between pages`).toMatch(
        /\.order\('id', \{ ascending: true \}\)/,
      )
    }
  })

  it('the internal list that always had it still has it', () => {
    /*
     * ⚠️ THE REFERENCE IMPLEMENTATION. It got this right long before the API
     * did, and its comment is the clearest statement of the rule in the
     * codebase. If it ever loses the tiebreaker, the explanation goes with it.
     */
    const list = PRODUCT.find((f) => f.file === 'lib/crm/contacts-list.ts')!.code
    expect(list).toMatch(/\.order\('id', \{ ascending: true \}\)/)
    // ⚠️ A SHORT FRAGMENT: the sentence wraps across lines with ` * ` between,
    // so matching the whole thing fails on the comment's formatting rather than
    // on its absence.
    expect(list).toMatch(/a row is seen twice while/)
  })
})
