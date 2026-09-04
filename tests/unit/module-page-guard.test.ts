/**
 * A module layout does not stop its pages running.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ NEXT RENDERS THE LAYOUT AND THE PAGE TOGETHER. A layout that returns   ║
 * ║  an EmptyState INSTEAD of `{children}` hides the page's output — it does   ║
 * ║  not stop the page component executing, querying, or having its result     ║
 * ║  serialised into the RSC flight payload that ships to the browser.        ║
 * ║                                                                           ║
 * ║  Measured on staging, 2026-09-05:                                         ║
 * ║                                                                           ║
 * ║    /flows as a `setter`      → flow name absent on screen, PRESENT in the ║
 * ║                                payload as `"children":"ZZFLOW …"`         ║
 * ║    /crm/contacts, module off → "not included in your plan" on screen,     ║
 * ║                                contact rows PRESENT in the payload        ║
 * ║                                                                           ║
 * ║  Each of the three module layouts calls itself THE ACCESS BOUNDARY. Each  ║
 * ║  was defeated by a rendering detail rather than a missing check — which   ║
 * ║  is why this is a structural guard and not a code review note.            ║
 * ║                                                                           ║
 * ║  ⚠️ THE FIX IS NOT A REDIRECT. The layout distinguishes "not in your plan" ║
 * ║  from "not your role", and support needs those to stay different. Pages    ║
 * ║  call `workspaceContextIfPermitted` and return null; the layout keeps      ║
 * ║  saying why.                                                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')

/** Route groups whose layout is the access boundary, and what it checks. */
const MODULE_SURFACES = {
  crm: 'crm.contact.view',
  email: 'email.campaign.view',
  flows: 'flow.view',
} as const

/**
 * ⚠️ PLAIN RECURSION, NOT A GLOB. The route group directory is literally named
 * `(product)`, and every glob library reads those parentheses as a pattern
 * group — the first version of this file matched nothing and reported every
 * page as compliant.
 */
function pagesUnder(group: string): string[] {
  const root = join(ROOT, 'app/(product)', group)
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === 'page.tsx') out.push(relative(ROOT, full))
    }
  }
  walk(root)
  return out
}

describe('the scanner itself', () => {
  it('finds the pages under every module surface', () => {
    // Without this a moved directory empties the list and everything below
    // passes against nothing.
    for (const group of Object.keys(MODULE_SURFACES)) {
      expect(pagesUnder(group).length, `no pages found under ${group}`).toBeGreaterThan(0)
    }
    expect(pagesUnder('crm').length).toBeGreaterThanOrEqual(10)
  })

  it('confirms each layout still checks the permission this guard assumes', () => {
    /*
     * ⚠️ PINS THE PREMISE. If a layout were changed to check something else,
     * every page below would be gated on the WRONG permission and this file
     * would still pass — both halves consistent, both wrong.
     */
    for (const [group, permission] of Object.entries(MODULE_SURFACES)) {
      const layout = readFileSync(join(ROOT, `app/(product)/${group}/layout.tsx`), 'utf8')
      expect(
        layout.includes(`'${permission}'`),
        `app/(product)/${group}/layout.tsx no longer checks ${permission}`,
      ).toBe(true)
    }
  })
})

describe('every page under a module layout guards itself', () => {
  for (const [group, permission] of Object.entries(MODULE_SURFACES)) {
    for (const rel of pagesUnder(group)) {
      const source = readFileSync(join(ROOT, rel), 'utf8')

      // A page that never resolves a workspace has nothing to leak.
      if (!/await\s+(requireWorkspace|workspaceContextIfPermitted|getWorkspaceContext)\b/.test(source)) {
        continue
      }

      it(`${rel} calls workspaceContextIfPermitted('${permission}')`, () => {
        expect(
          source.includes(`workspaceContextIfPermitted('${permission}')`),
          `${rel} relies on the ${group} layout to refuse unauthorised callers. The ` +
            `layout hides the output; it does NOT stop this page querying and ` +
            `serialising its result into the RSC payload, where View Source reads it.`,
        ).toBe(true)
      })

      it(`${rel} does not fall back to the ungated requireWorkspace`, () => {
        /*
         * ⚠️ THE PARTIAL REVERT. A page can import the right helper, satisfy the
         * substring check above, and still call `requireWorkspace()` on the path
         * that actually renders.
         */
        expect(
          /\bawait requireWorkspace\(\)/.test(source),
          `${rel} still calls requireWorkspace() directly.`,
        ).toBe(false)
      })
    }
  }
})

describe('the helper refuses without redirecting', () => {
  it('returns null rather than calling redirect', () => {
    /*
     * ⚠️ A REDIRECT WOULD FIX THE LEAK AND LOSE THE MESSAGE. The layouts tell a
     * customer whether their PLAN or their ROLE is the problem; bouncing them to
     * /dashboard collapses both into silence and turns a billing question into a
     * support ticket.
     */
    const context = readFileSync(join(ROOT, 'lib/workspaces/context.ts'), 'utf8')
    const start = context.indexOf('export async function workspaceContextIfPermitted')
    expect(start, 'workspaceContextIfPermitted is gone').toBeGreaterThan(-1)

    const body = context.slice(start, context.indexOf('\n}', start))
    expect(body.includes('redirect(')).toBe(false)
    expect(body.includes('return decision.allowed ? ctx : null')).toBe(true)
  })
})
