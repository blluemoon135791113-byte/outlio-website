/**
 * The save form and the save action must agree on every field name.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE URL VOCABULARY AND THE ACTION VOCABULARY ARE DIFFERENT, ON        ║
 * ║  PURPOSE, AND THAT IS THE TRAP.                                          ║
 * ║                                                                           ║
 * ║      URL     q       owner  company  after         before        email    ║
 * ║      action  search  owner  company  createdAfter  createdBefore hasEmail ║
 * ║                                                                           ║
 * ║  A form that posts the URL's names saves a view that SILENTLY DROPS those ║
 * ║  filters. Nothing errors: `formData.get('search')` returns null, the      ║
 * ║  field becomes `undefined`, `parseDefinition` accepts a definition        ║
 * ║  missing three keys, and the view saves successfully. It restores a WIDER ║
 * ║  list than the one that was on screen when the user pressed Save.        ║
 * ║                                                                           ║
 * ║  ⚠️ AND THE USER WOULD PROBABLY NOT REPORT IT. "My saved view shows a bit  ║
 * ║  more than I expected" is the kind of thing people assume they got wrong. ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const ACTION = readFileSync(join(ROOT, 'app/(product)/crm/saved-view-actions.ts'), 'utf8')
const FORM = readFileSync(join(ROOT, 'components/crm/SavedViews.tsx'), 'utf8')

/** Every key the action reads out of the submitted form. */
function fieldsTheActionReads(): string[] {
  const save = ACTION.slice(ACTION.indexOf('export async function saveViewAction'))
  const body = save.slice(0, save.indexOf('export async function deleteViewAction'))

  const named = [
    ...body.matchAll(/value\('(\w+)'\)/g),
    ...body.matchAll(/formData\.get\('(\w+)'\)/g),
    ...body.matchAll(/formData\.getAll\('(\w+)'\)/g),
  ].map((m) => m[1]!)

  return [...new Set(named)]
}

/** Every `name=` the save form emits. */
function fieldsTheFormSends(): string[] {
  const form = FORM.slice(FORM.indexOf('activeCount > 0 &&'))
  return [...new Set([...form.matchAll(/name="(\w+)"/g)].map((m) => m[1]!))]
}

describe('the scanner itself', () => {
  it('finds fields on both sides', () => {
    // Without this, a refactor empties one list and every assertion below
    // passes against nothing.
    expect(fieldsTheActionReads().length).toBeGreaterThanOrEqual(8)
    expect(fieldsTheFormSends().length).toBeGreaterThanOrEqual(8)
  })

  it('reads only saveViewAction, not the delete action', () => {
    // `viewId` belongs to deleteViewAction; if it leaked in, the comparison
    // below would demand the save form send it.
    expect(fieldsTheActionReads()).not.toContain('viewId')
  })
})

describe('every field the action reads is sent by the form', () => {
  const reads = fieldsTheActionReads()
  const sends = fieldsTheFormSends()

  for (const field of reads) {
    it(`the form sends "${field}"`, () => {
      expect(
        sends,
        `saveViewAction reads "${field}" and the save form never sends it. ` +
          `formData.get returns null, the filter becomes undefined, the view saves ` +
          `successfully — and restores a WIDER list than the one that was on screen.`,
      ).toContain(field)
    })
  }

  it('and the form sends nothing the action ignores', () => {
    /*
     * The other direction. A field the action does not read is dead weight that
     * looks like a working filter — the same shape as the first, from the other
     * side, and the reason this assertion is not just the inverse for symmetry.
     */
    const ignored = sends.filter((f) => !reads.includes(f))
    expect(
      ignored,
      `The save form sends ${ignored.join(', ')}, which saveViewAction never ` +
        `reads. Either wire it up or stop sending it.`,
    ).toEqual([])
  })
})

describe('the URL vocabulary is deliberately different', () => {
  it('the action does NOT read the URL parameter names', () => {
    /*
     * ⚠️ PINS THE DISTINCTION ITSELF. If somebody "tidied" the action to read
     * `q` and `after`, this file's premise would quietly become false and the
     * agreement above would still pass — both sides renamed together, both
     * wrong relative to `contactsHref`.
     */
    const reads = fieldsTheActionReads()
    expect(reads).toContain('search')
    expect(reads).toContain('createdAfter')
    expect(reads).toContain('hasEmail')
    expect(reads).not.toContain('q')
    expect(reads).not.toContain('after')
    expect(reads).not.toContain('email')
  })
})
