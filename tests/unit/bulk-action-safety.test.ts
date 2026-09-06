/**
 * Every bulk action must be permission-gated, bounded, and workspace-scoped.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  A BULK ACTION MULTIPLIES THE COST OF A MISSING CHECK BY THE SELECTION.  ║
 * ║                                                                           ║
 * ║  Three things must hold, and omitting any one of them looks like working  ║
 * ║  code — the action succeeds, the page revalidates, the user sees a count: ║
 * ║                                                                           ║
 * ║   1. A PERMISSION, checked server-side.                                   ║
 * ║   2. A BOUND. An unbounded UPDATE is how one form submission rewrites a   ║
 * ║      whole book of business.                                              ║
 * ║   3. A WORKSPACE FILTER. Ids arrive from a form — they are a CLAIM, not a ║
 * ║      fact — and `createAdminClient` bypasses RLS, so nothing else stops   ║
 * ║      an id that belongs to another tenant.                               ║
 * ║                                                                           ║
 * ║  ⚠️ NUMBER 3 IS THE ONE THAT WOULD SURVIVE REVIEW. The action works        ║
 * ║  perfectly for every id the user legitimately has; it is only wrong for   ║
 * ║  an id they were never shown, which no ordinary use produces.            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const SOURCE = readFileSync(join(ROOT, 'lib/crm/contact-actions.ts'), 'utf8')

/** Comments removed by whole line, so a blank line is never manufactured. */
const stripComments = (s: string) =>
  s.replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*\n/gm, '').replace(/^[ \t]*\/\/.*\n/gm, '')

const CODE = stripComments(SOURCE)

/**
 * The query chain starting at `.from('x')`, to the end of that STATEMENT.
 *
 * ⚠️ A FIXED WINDOW LIES, AND DID. The first version read 300 characters after
 * `.from('crm_tags')` and asked whether `workspace_id` appeared. Removing the
 * tag's workspace check still passed, because the window ran on into the NEXT
 * query — the contact lookup — which mentions `workspace_id` for its own
 * reasons. The guard was reading a different statement's safety and crediting
 * it to this one.
 */
function chainFrom(body: string, marker: string): string {
  const start = body.indexOf(marker)
  if (start === -1) return ''
  let depth = 0
  for (let i = start; i < body.length; i += 1) {
    const c = body[i]!
    if (c === '(' || c === '{' || c === '[') depth += 1
    else if (c === ')' || c === '}' || c === ']') depth -= 1
    // A blank line at depth zero ends the statement.
    else if (depth === 0 && c === '\n' && body[i + 1] === '\n') return body.slice(start, i)
  }
  return body.slice(start)
}

/** The body of one exported async function, by bracket depth. */
function bodyOf(name: string): string {
  const start = CODE.indexOf(`export async function ${name}`)
  if (start === -1) return ''
  const open = CODE.indexOf('{', start)
  let depth = 0
  for (let i = open; i < CODE.length; i += 1) {
    if (CODE[i] === '{') depth += 1
    else if (CODE[i] === '}') {
      depth -= 1
      if (depth === 0) return CODE.slice(open, i)
    }
  }
  return CODE.slice(open)
}

/** Every exported action whose name marks it as operating on a selection. */
function bulkActions(): string[] {
  return [...CODE.matchAll(/export async function (bulk\w+)\s*\(/g)].map((m) => m[1]!)
}

describe('the scanner itself', () => {
  it('finds the bulk actions', () => {
    // Without this, a naming change empties the list and every assertion below
    // passes against nothing.
    const found = bulkActions()
    expect(found.length).toBeGreaterThanOrEqual(4)
    expect(found).toContain('bulkAssignAction')
    expect(found).toContain('bulkDeleteAction')
  })

  it('extracts a real body', () => {
    expect(bodyOf('bulkAssignAction').length).toBeGreaterThan(200)
  })

  it('chainFrom stops at the end of its own statement', () => {
    // The regression: two statements, only the second scoped.
    const two = ".from('crm_tags')\n  .select('id')\n  .eq('id', x)\n\n  .from('crm_contacts')\n  .eq('workspace_id', w)"
    expect(chainFrom(two, ".from('crm_tags')")).not.toContain('workspace_id')
  })

  it('returns nothing for a function that does not exist', () => {
    // Proves a missing action fails loudly rather than passing vacuously.
    expect(bodyOf('bulkNonexistentAction')).toBe('')
  })
})

describe('every bulk action is safe', () => {
  for (const action of bulkActions()) {
    const body = bodyOf(action)

    it(`${action} checks a permission`, () => {
      /*
       * Either directly, or via `bulkSelection`, which takes the permission as
       * an argument — centralising it is better than repeating it, so both
       * count.
       */
      expect(
        /assertWorkspacePermission\(|bulkSelection\(/.test(body),
        `${action} never checks a permission. A server action is a public ` +
          `endpoint; hiding the button is not access control (CLAUDE.md).`,
      ).toBe(true)
    })

    it(`${action} bounds the selection`, () => {
      /*
       * ⚠️ DELEGATING TO `bulkSelection` COUNTS, AND IS BETTER THAN INLINING.
       * The first version of this test only looked at the action's own body and
       * failed three actions that centralise the bound — the same mistake
       * Phase 1's gate scanner made, where a helper-held check read as absent.
       * The helper's own bound is asserted separately below, so delegation is
       * verified rather than assumed.
       */
      expect(
        /BULK_LIMIT|ids\.length >|length > \d+|bulkSelection\(/.test(body),
        `${action} accepts an unbounded number of ids. One crafted submission ` +
          `would rewrite every contact in the workspace.`,
      ).toBe(true)
    })

    it(`${action} scopes every write by workspace`, () => {
      /*
       * ⚠️ THE MOST IMPORTANT OF THE THREE. `createAdminClient` bypasses RLS,
       * so a `.in('id', ids)` with no workspace filter reaches another tenant's
       * rows — and behaves perfectly for every id a real user could produce.
       */
      const writes = [...body.matchAll(/\.from\('(\w+)'\)([\s\S]{0,400}?)(?=\n\n|\n  const|$)/g)]
      const unscoped = writes
        .filter(([, , chain]) => /\.(update|delete|upsert|insert)\(/.test(chain))
        .filter(([, , chain]) => !/workspace_id/.test(chain))
        .map(([, table]) => table)

      expect(
        unscoped,
        `${action} writes to ${unscoped.join(', ')} without naming workspace_id. ` +
          `Ids come from a form and the service role ignores RLS.`,
      ).toEqual([])
    })
  }
})

describe('the shared selection helper', () => {
  /*
   * Everything that delegates its bound to `bulkSelection` is only as safe as
   * this. Without it the delegation above would be an untested assumption.
   */
  const helper = CODE.slice(CODE.indexOf('async function bulkSelection'))

  it('enforces a bound', () => {
    expect(helper.slice(0, 900)).toMatch(/ids\.length > BULK_LIMIT/)
  })

  it('the bound is a real number, not undefined', () => {
    expect(CODE).toMatch(/const BULK_LIMIT = \d+/)
  })

  it('refuses an empty selection', () => {
    expect(helper.slice(0, 900)).toMatch(/ids\.length === 0/)
  })

  it('checks the permission it was given', () => {
    expect(helper.slice(0, 900)).toContain('assertWorkspacePermission(permission)')
  })
})

describe('actions that write a join row validate the parent first', () => {
  /*
   * ⚠️ A JOIN TABLE IS WRITTEN DIRECTLY, SO ITS PARENT ID IS NEVER CHECKED BY
   * ANYTHING ELSE. `bulkTagAction` inserts into `crm_contact_tags`; if the tag
   * id were taken on trust, a crafted request would attach ANOTHER TENANT'S tag
   * — and every later read would treat that association as real, leaking their
   * taxonomy back through this workspace's UI.
   */
  for (const [action, parent] of [
    ['bulkTagAction', 'crm_tags'],
    ['bulkAddToListAction', 'crm_lists'],
  ] as const) {
    it(`${action} confirms the ${parent} row belongs to this workspace`, () => {
      const body = bodyOf(action)
      expect(body).toContain(`.from('${parent}')`)
      const lookup = chainFrom(body, `.from('${parent}')`)
      expect(
        lookup,
        `${action} uses a ${parent} id from the form without checking it is ` +
          `this workspace's.`,
      ).toContain('workspace_id')
    })

    it(`${action} filters the contact ids before writing the join rows`, () => {
      const body = bodyOf(action)
      expect(
        body,
        `${action} inserts join rows from form-supplied contact ids without ` +
          `first confirming they belong to this workspace.`,
      ).toMatch(/from\('crm_contacts'\)[\s\S]{0,200}workspace_id/)
    })
  }
})
