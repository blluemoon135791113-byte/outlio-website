/**
 * §6.4 — the two rights must describe the same person.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE ERASURE PATH WAS BUILT AND UNREACHABLE FOR ITS ENTIRE LIFE.          ║
 * ║                                                                           ║
 * ║  `crm_erase_contact` landed in migration 0075 and was revised twice        ║
 * ║  (0091, 0109) to satisfy the append-only guard. `eraseContact` wrapped it. ║
 * ║  Integration tests exercised it. Its only callers were those tests: no     ║
 * ║  server action, no UI. A data subject could not have their data erased     ║
 * ║  because nothing in the product could ask — for a right with a one-month   ║
 * ║  statutory deadline.                                                      ║
 * ║                                                                           ║
 * ║  ⚠️ NEITHER EXISTING GUARD COULD SEE IT, and that is worth knowing rather  ║
 * ║  than patching over. `orphan-module.test.ts` works at MODULE granularity   ║
 * ║  and `lib/crm/activities.ts` has many other importers.                     ║
 * ║  `action-reachability.test.ts` checks that server actions are called, and  ║
 * ║  there was no action to check.                                            ║
 * ║                                                                           ║
 * ║  A blanket "exported function only tests call" guard was measured and      ║
 * ║  REJECTED: it flags 218 functions, most of them pure helpers exported for  ║
 * ║  unit testing and used only inside their own module. A signal that has to  ║
 * ║  be searched is not a signal. This file guards the specific path instead.  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ERASED_BUT_NOT_EXPORTED } from '@/lib/crm/subject-export'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const ERASE_SQL = read('supabase/migrations/0075_crm_operations.sql')
const SUBJECT_EXPORT = strip(read('lib/crm/subject-export.ts'))
const ACTIONS = strip(read('lib/crm/contact-actions.ts'))
const CONTACT_PAGE = strip(read('app/(product)/crm/contacts/[id]/page.tsx'))
const PANELS = strip(read('components/crm/ContactPanels.tsx'))
const EXPORT_ROUTE = strip(read('app/(product)/crm/contacts/[id]/subject-export/route.ts'))

/** Tables the erasure RPC hard-deletes rows from, read from the migration. */
const erasedTables = (() => {
  const body = strip(ERASE_SQL).slice(strip(ERASE_SQL).indexOf('crm_erase_contact'))
  return new Set([...body.matchAll(/delete\s+from\s+public\.([a-z_]+)/g)].map((m) => m[1]!))
})()

describe('the scanners can see what they police', () => {
  it('found the tables the erasure destroys', () => {
    /*
     * Vacuity: a rename in the migration would otherwise make every assertion
     * below pass against an empty set.
     */
    expect(erasedTables.size).toBeGreaterThanOrEqual(5)
    expect(erasedTables.has('crm_contacts')).toBe(true)
    expect(erasedTables.has('crm_activities')).toBe(true)
  })
})

describe('the right to erasure is reachable', () => {
  it('a gated server action exists', () => {
    expect(ACTIONS).toContain('export async function eraseContactAction')
    // Gated, and on the strongest contact permission that exists.
    expect(ACTIONS).toMatch(/eraseContactAction[\s\S]{0,900}assertWorkspacePermission\('crm\.contact\.delete'\)/)
  })

  it('the action calls the erasure path rather than deleting by hand', () => {
    // A hand-rolled delete would be refused by the append-only guard, or worse,
    // would rewrite history instead of erasing a person.
    expect(ACTIONS).toMatch(/eraseContact\(/)
  })

  it('confirmation is checked on the SERVER, not only in the form', () => {
    /*
     * The form is an HTTP endpoint. A disabled button is a courtesy to the
     * person typing; it is not a control on the only irreversible operation in
     * the CRM.
     */
    expect(ACTIONS).toMatch(/confirm[\s\S]{0,200}!==\s*'ERASE'/)
  })

  it('a human can actually reach it — component and page, not just an export', () => {
    // The whole defect was a correct function nothing could call.
    expect(PANELS).toContain('eraseContactAction')
    expect(PANELS).toContain('export function EraseContact')
    expect(CONTACT_PAGE).toContain('<EraseContact')
  })
})

describe('the right of access is reachable', () => {
  it('a gated route serves one subject’s data', () => {
    expect(EXPORT_ROUTE).toContain('collectSubjectExport')
    expect(EXPORT_ROUTE).toContain("assertWorkspacePermission('crm.contact.view')")
  })

  it('a setter cannot pull a colleague’s contact through it', () => {
    // Scope re-applied on the row that was read, not on the request.
    expect(EXPORT_ROUTE).toContain('dataScope(ctx.role)')
    expect(EXPORT_ROUTE).toMatch(/owner_user_id !== ctx\.userId/)
  })

  it('the page links to it', () => {
    expect(CONTACT_PAGE).toContain('/subject-export')
  })

  it('is never cached — it is one person’s file', () => {
    expect(EXPORT_ROUTE).toContain("'Cache-Control': 'no-store'")
  })
})

describe('the two rights describe the same person', () => {
  /*
   * ⚠️ THE INVARIANT. Erasing data that was never disclosable means an access
   * request and an erasure request give two different accounts of one person.
   * Every table the erasure destroys is either exported or written down as an
   * exclusion with a reason.
   */
  it('every erased table is exported or explicitly excluded', () => {
    const exported = [...erasedTables].filter((t) => SUBJECT_EXPORT.includes(`'${t}'`))
    const excluded = new Set<string>(ERASED_BUT_NOT_EXPORTED)

    const unaccounted = [...erasedTables].filter(
      (t) => !exported.includes(t) && !excluded.has(t),
    )

    expect(
      unaccounted,
      'The erasure destroys these and the subject export neither includes them ' +
        'nor says why not. Either export them, or add them to ' +
        'ERASED_BUT_NOT_EXPORTED with a reason:\n' + unaccounted.join('\n'),
    ).toEqual([])
  })

  it('every written-down exclusion is really erased', () => {
    /*
     * The other direction, and the one that rots: an exclusion for a table the
     * erasure no longer touches is a stale note that quietly pre-excuses the
     * next omission.
     */
    const stale = ERASED_BUT_NOT_EXPORTED.filter((t) => !erasedTables.has(t))
    expect(
      stale,
      'These are excluded from the export as "erased anyway", but the erasure ' +
        'no longer touches them:\n' + stale.join('\n'),
    ).toEqual([])
  })

  it('the exclusion list is short and reasoned, not a dumping ground', () => {
    // Two entries, both internal records about our handling rather than
    // content held about the person. A growing list is a smell.
    expect(ERASED_BUT_NOT_EXPORTED).toHaveLength(2)
  })

  it('soft-deleted rows are exported, because erasure destroys them too', () => {
    /*
     * "We still hold it but chose not to show you" is not an answer to Art. 15.
     * The note and task selects carry `deleted_at` and do not filter on it.
     */
    expect(SUBJECT_EXPORT).not.toMatch(/crm_notes[\s\S]{0,400}deleted_at', null/)
    expect(SUBJECT_EXPORT).toMatch(/deleted_at/)
  })

  it('every query in the export is workspace-scoped', () => {
    /*
     * The service role bypasses RLS, so the WHERE clause is the only tenancy
     * wall — and this document is produced specifically to be handed out.
     */
    const froms = [...SUBJECT_EXPORT.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1]!)
    expect(froms.length).toBeGreaterThanOrEqual(4)
    const scoped = SUBJECT_EXPORT.match(/\.eq\('workspace_id', workspaceId\)/g) ?? []
    expect(scoped.length).toBe(froms.length)
  })
})
