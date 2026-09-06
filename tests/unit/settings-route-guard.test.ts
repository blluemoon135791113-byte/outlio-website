/**
 * A settings page that knows a permission must also ENFORCE it.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE BUG THIS EXISTS FOR SHIPPED, AND IT LOOKED LIKE CAREFUL CODE.     ║
 * ║                                                                           ║
 * ║  `/dashboard/settings/developers` called `requireWorkspace()` and then     ║
 * ║  computed `canManage` — which read exactly the right permission, and used ║
 * ║  it only to decide which BUTTONS rendered. Measured on staging: a         ║
 * ║  `setter` loaded the page and received the API key names, the key          ║
 * ║  prefixes, and the full webhook URLs.                                     ║
 * ║                                                                           ║
 * ║  ⚠️ A WEBHOOK URL IS A CREDENTIAL — Slack, Teams and Zapier put a bearer   ║
 * ║  token in the PATH. The notifications page one directory over already      ║
 * ║  knew that and passes only `hostOf(url)`. Same repo, same risk, opposite  ║
 * ║  handling, and nothing compared them.                                     ║
 * ║                                                                           ║
 * ║  ⚠️ `requireWorkspacePermission` EXISTED THE WHOLE TIME. It is named in    ║
 * ║  `context.ts`'s own header as the thing pages call, it is in              ║
 * ║  `action-authorization.test.ts`'s allowlist — and it had ZERO CALLERS.    ║
 * ║  The same defect class this project keeps finding: correct, tested code   ║
 * ║  that nothing invokes.                                                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const SETTINGS = join(__dirname, '..', '..', 'app/(product)/dashboard/settings')

/**
 * Permissions whose whole subject IS the page. A page about managing settings
 * has nothing left to show once the reader may not manage them — unlike, say,
 * `crm.contact.delete`, where a read-only list is a legitimate view.
 */
const PAGE_IS_THE_PERMISSION = ['workspace.settings.manage']

function settingsPages(): { name: string; source: string }[] {
  return readdirSync(SETTINGS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, path: join(SETTINGS, e.name, 'page.tsx') }))
    .flatMap(({ name, path }) => {
      try {
        return [{ name, source: readFileSync(path, 'utf8') }]
      } catch {
        return []
      }
    })
}

describe('the scanner itself', () => {
  it('finds the settings pages', () => {
    // Without this, a moved directory empties the list and every assertion
    // below passes against nothing.
    const pages = settingsPages()
    expect(pages.length).toBeGreaterThanOrEqual(6)
    expect(pages.map((p) => p.name)).toContain('developers')
  })

  it('finds at least one page that references a page-defining permission', () => {
    const guarded = settingsPages().filter((p) =>
      PAGE_IS_THE_PERMISSION.some((perm) => p.source.includes(perm)),
    )
    expect(
      guarded.length,
      'no settings page mentions workspace.settings.manage — has it been renamed?',
    ).toBeGreaterThan(0)
  })
})

describe('a page that names a page-defining permission enforces it at the route', () => {
  for (const page of settingsPages()) {
    const permission = PAGE_IS_THE_PERMISSION.find((p) => page.source.includes(p))
    if (!permission) continue

    it(`${page.name} calls requireWorkspacePermission`, () => {
      expect(
        page.source.includes('requireWorkspacePermission'),
        `app/(product)/dashboard/settings/${page.name}/page.tsx reads "${permission}" ` +
          `but never gates the ROUTE on it. If it only decides which controls ` +
          `render, every member can load the page and receive its data in the RSC ` +
          `payload — which is how a setter came to hold this workspace's webhook URLs.`,
      ).toBe(true)
    })

    it(`${page.name} does not fall back to the ungated requireWorkspace`, () => {
      /*
       * ⚠️ THE PARTIAL REVERT THIS CATCHES. `requireWorkspacePermission` calls
       * `requireWorkspace` internally, so a page importing BOTH and using the
       * weaker one still satisfies the check above by substring alone.
       */
      const usesBare = /\bawait requireWorkspace\(\)/.test(page.source)
      expect(
        usesBare,
        `${page.name} still calls requireWorkspace() directly — the route guard ` +
          `is present in the file but not on the path that renders.`,
      ).toBe(false)
    })
  }
})
