/**
 * A layout is not an authorization boundary.
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
 * ║  ⚠️ THE CODEBASE ALREADY KNEW THIS, IN A DIFFERENT FILE.                   ║
 * ║  `app/admin/layout.tsx` says it outright — "A layout is not an            ║
 * ║  authorization boundary … Server Actions do not pass through layouts at   ║
 * ║  all" — and every admin page calls `requireAdmin()` for that reason.      ║
 * ║  Meanwhile all three module layouts were written as exactly the boundary  ║
 * ║  that file warns against, each calling itself THE ACCESS BOUNDARY. The    ║
 * ║  knowledge existed; it just was not where it was needed.                  ║
 * ║                                                                           ║
 * ║  ⚠️ THE FIX IS NOT A REDIRECT. The layout distinguishes "not in your plan" ║
 * ║  from "not your role", and support needs those to stay different. Pages    ║
 * ║  call `workspaceContextIfPermitted` and return null; the layout keeps      ║
 * ║  saying why. A redirect would fix the leak and throw the message away.    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const APP = join(ROOT, 'app')

/**
 * ⚠️ PLAIN RECURSION, NOT A GLOB. The route group directory is literally named
 * `(product)`, and every glob library reads those parentheses as a pattern
 * group — the first version of this file matched nothing and reported all
 * twenty pages compliant.
 */
function filesNamed(dir: string, name: string): string[] {
  const out: string[] = []
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === name) out.push(full)
    }
  }
  walk(dir)
  return out
}

type Surface = { dir: string; layout: string; permission: string }

/**
 * Layouts that refuse by RENDERING SOMETHING ELSE rather than redirecting.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ DISCOVERED, NOT LISTED. An earlier version of this guard hardcoded     ║
 * ║  crm / email / flows — which is the failure mode it exists to prevent.    ║
 * ║  A fourth module surface added next quarter would inherit the bug and     ║
 * ║  this file would stay green, because the bug is in the SHAPE of a layout  ║
 * ║  and not in any particular directory name.                                ║
 * ║                                                                           ║
 * ║  A layout that calls `redirect()` is fine and is skipped: the response    ║
 * ║  becomes a redirect, so no page payload is ever sent.                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
function guardingLayouts(): Surface[] {
  const surfaces: Surface[] = []

  for (const layout of filesNamed(APP, 'layout.tsx')) {
    const source = readFileSync(layout, 'utf8')

    const permission = source.match(/decidePermission\([\s\S]{0,120}?'([a-z]+\.[a-z.]+)'/)?.[1]
    if (!permission) continue

    // Refuses by redirecting → the page's output never reaches the client.
    if (/\bredirect\(/.test(source)) continue

    surfaces.push({ dir: layout.replace(/\/layout\.tsx$/, ''), layout, permission })
  }

  return surfaces
}

function pagesUnder(dir: string): string[] {
  return filesNamed(dir, 'page.tsx').map((p) => relative(ROOT, p))
}

describe('the scanner itself', () => {
  it('finds the layouts that gate by rendering', () => {
    /*
     * Without this, a refactor that renames `decidePermission` empties the list
     * and every assertion below passes against nothing — the exact vacuity this
     * project has been bitten by before.
     */
    const surfaces = guardingLayouts()
    expect(surfaces.length, 'no gating layouts found — has decidePermission been renamed?')
      .toBeGreaterThanOrEqual(3)

    const names = surfaces.map((s) => relative(ROOT, s.layout))
    expect(names).toContain('app/(product)/crm/layout.tsx')
    expect(names).toContain('app/(product)/email/layout.tsx')
    expect(names).toContain('app/(product)/flows/layout.tsx')
  })

  it('skips a layout that refuses by redirecting', () => {
    // `app/admin/layout.tsx` guards with `requireAdmin()`, which redirects — and
    // it is not in the list, which is the point.
    const names = guardingLayouts().map((s) => relative(ROOT, s.layout))
    expect(names).not.toContain('app/admin/layout.tsx')
  })

  it('finds pages beneath each gating layout', () => {
    for (const surface of guardingLayouts()) {
      expect(pagesUnder(surface.dir).length, `no pages under ${surface.dir}`).toBeGreaterThan(0)
    }
  })
})

describe('every page under a rendering-gate layout guards itself', () => {
  for (const surface of guardingLayouts()) {
    for (const rel of pagesUnder(surface.dir)) {
      const source = readFileSync(join(ROOT, rel), 'utf8')

      // A page that never resolves a workspace has nothing to leak.
      if (!/await\s+(requireWorkspace|workspaceContextIfPermitted|getWorkspaceContext)\b/.test(source)) {
        continue
      }

      it(`${rel} calls workspaceContextIfPermitted('${surface.permission}')`, () => {
        expect(
          source.includes(`workspaceContextIfPermitted('${surface.permission}')`),
          `${rel} relies on ${relative(ROOT, surface.layout)} to refuse unauthorised ` +
            `callers. That layout hides the output; it does NOT stop this page ` +
            `querying and serialising its result into the RSC payload, where View ` +
            `Source reads it.`,
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
