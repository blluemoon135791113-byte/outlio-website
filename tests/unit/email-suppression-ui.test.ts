/**
 * Phase 8 — the suppression list's read path.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  EVERY WRITE PATH EXISTED AND NO SCREEN COULD READ THEM.                 ║
 * ║                                                                           ║
 * ║  `suppressEmail` is called on unsubscribe and hard bounce, and            ║
 * ║  `enqueueEmail` refuses a suppressed address — that guard is proven by    ║
 * ║  mutation (removing it fails 5 integration tests). What the product could ║
 * ║  not do was SHOW the list, so a customer asking "did you remove me?" got  ║
 * ║  no answer and a wrong entry could not be undone without SQL.            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { REASON_COPY, type SuppressionReason } from '@/lib/email/suppression-copy'

const ROOT = join(__dirname, '..', '..')
const code = (p: string) =>
  readFileSync(join(ROOT, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')

const ALL_REASONS: SuppressionReason[] = [
  'unsubscribed',
  'hard_bounce',
  'complaint',
  'manual',
  'invalid_address',
]

describe('removal copy explains what is being overridden', () => {
  it('covers every reason the database can store', () => {
    /*
     * The enum lives in the migration; a reason with no copy renders `undefined`
     * in a confirmation dialog about consent.
     */
    for (const reason of ALL_REASONS) {
      expect(REASON_COPY[reason], `no copy for ${reason}`).toBeDefined()
      expect(REASON_COPY[reason].label.length).toBeGreaterThan(2)
      expect(REASON_COPY[reason].removal.length).toBeGreaterThan(20)
    }
  })

  it('says something DIFFERENT for a bounce than for an unsubscribe', () => {
    /*
     * ⚠️ THE WHOLE POINT OF PER-REASON COPY. Un-suppressing a hard bounce is a
     * delivery decision that will simply recur; un-suppressing an unsubscribe
     * overrides a person's stated wish. One generic "are you sure?" flattens
     * the two at the moment the difference matters most.
     */
    expect(REASON_COPY.hard_bounce.removal).not.toBe(REASON_COPY.unsubscribed.removal)
    expect(REASON_COPY.unsubscribed.removal).toMatch(/asked/i)
    expect(REASON_COPY.hard_bounce.removal).toMatch(/bounce|reject/i)
  })

  it('warns about reputation where the reason is a reputation event', () => {
    for (const reason of ['hard_bounce', 'complaint'] as const) {
      expect(
        /reputation|spam|bounce again/i.test(REASON_COPY[reason].removal),
        `${reason} removal copy does not mention the consequence`,
      ).toBe(true)
    }
  })
})

describe('the suppression actions are gated correctly', () => {
  const actions = code('app/(product)/email/actions.ts')

  it('both assert email.account.manage, not a weaker permission', () => {
    /*
     * ⚠️ `manage`, NOT `connect`. Connecting a mailbox is setter-level;
     * deciding who the workspace may never contact again is not. Asserting the
     * weaker one would let a setter re-add someone who opted out.
     */
    for (const fn of ['addSuppressionAction', 'removeSuppressionAction']) {
      const start = actions.indexOf(`export async function ${fn}`)
      expect(start, `${fn} not found`).toBeGreaterThan(-1)
      const body = actions.slice(start, start + 700)
      expect(
        body.includes("assertWorkspacePermission('email.account.manage')"),
        `${fn} does not assert email.account.manage`,
      ).toBe(true)
    }
  })

  it('email.account.manage really is stricter than email.account.connect', () => {
    /*
     * Guards the assumption above rather than trusting it: if the matrix ever
     * levels the two, the gate stops meaning what this test says it means.
     *
     * ⚠️ READ FROM SOURCE, NOT IMPORTED. `PERMISSIONS` is deliberately not
     * exported — `can()` is the public surface — and widening a module's API
     * so a test can peek inside it is a worse trade than reading the file.
     */
    const matrix = readFileSync(join(ROOT, 'lib/workspaces/permissions.ts'), 'utf8')
    expect(matrix).toMatch(/'email\.account\.manage':\s*\{\s*minRole:\s*'admin'/)
    expect(matrix).toMatch(/'email\.account\.connect':\s*\{\s*minRole:\s*'setter'/)
  })

  it('reports a delete that matched nothing as an error', () => {
    /*
     * A delete scoped to the wrong workspace matches zero rows and succeeds.
     * Reporting that as "Removed." is the silent-wrong-tenant bug wearing a
     * confirmation message.
     */
    const lib = code('lib/email/suppressions.ts')
    expect(lib).toContain('return (data ?? []).length > 0')

    const start = actions.indexOf('export async function removeSuppressionAction')
    const body = actions.slice(start, start + 900)
    expect(body).toMatch(/if \(!removed\) return \{ ok: false/)
  })

  it('scopes both reads and deletes by workspace in code', () => {
    // The service role bypasses RLS; this filter is the only tenant boundary.
    const lib = code('lib/email/suppressions.ts')
    const list = lib.slice(lib.indexOf('listSuppressions'))
    expect(list).toContain(".eq('workspace_id', workspaceId)")
    const remove = lib.slice(lib.indexOf('removeSuppression('))
    expect(remove).toContain(".eq('workspace_id', workspaceId)")
  })
})

describe('the list is reachable', () => {
  it('is rendered by the email page behind the manage permission', () => {
    const page = code('app/(product)/email/page.tsx')
    expect(page).toContain('<SuppressionList')
    expect(page).toContain('listSuppressions(ctx.workspace.id)')
    // Hidden for a setter — presentation, on top of the server-side gate above.
    expect(page).toMatch(/canManage \? \(/)
  })
})
