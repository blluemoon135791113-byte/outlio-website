/**
 * The home dashboard is filtered on the server, not in the layout — Phase 22.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  §8.1, verbatim: "the home surface must be server-side filtered — hiding a ║
 * ║  card is not access control, and a layout is not a boundary".             ║
 * ║                                                                           ║
 * ║  ⚠️ THE DIFFERENCE IS INVISIBLE ON SCREEN AND OBVIOUS IN DEVTOOLS. A page  ║
 * ║  that fetches the team's pipeline and then declines to render it has still ║
 * ║  serialised those figures into the RSC payload, where anybody can read     ║
 * ║  them. Both versions look identical to the person the gate is for.        ║
 * ║                                                                           ║
 * ║  So the assertions below are about the CALL SITE, not the markup.         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { can, type WorkspaceRole } from '@/lib/workspaces/permissions'

const ROOT = join(__dirname, '..', '..')

const strip = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')

const PAGE_RAW = readFileSync(join(ROOT, 'app/(product)/dashboard/page.tsx'), 'utf8')
/*
 * ⚠️ COMMENTS STRIPPED. This page explains its own gating at length — the block
 * above `canSeeTeam` names `report.team.view`, "server-side filtered" and the
 * RSC payload. Matching raw text would find the PROSE and report a gate that no
 * statement performs.
 */
const PAGE = strip(PAGE_RAW)
const TEAM_ROW = strip(readFileSync(join(ROOT, 'components/product/TeamRow.tsx'), 'utf8'))

describe('the scanner sees what it polices', () => {
  it('reads the page and finds its data fetches', () => {
    expect(PAGE).toContain('getOverviewPerformance')
    expect(PAGE).toContain('getPipelineTotals')
    expect(PAGE).toContain('countOverdueTasks')
  })

  it('strips comments rather than matching the page’s own explanation', () => {
    expect(PAGE_RAW, 'the gating rationale was deleted').toContain('not a boundary')
    expect(strip('/* report.team.view */\nconst x = 1'), 'stripper is inert').not.toContain(
      'report.team.view',
    )
  })
})

describe('team figures are never fetched without the permission', () => {
  it('gates the pipeline read on report.team.view', () => {
    /*
     * ⚠️ ANCHORED ON THE TERNARY, NOT ON THE TWO NAMES APPEARING NEARBY.
     * `canSeeTeam` and `getPipelineTotals` both being present would be
     * satisfied by a page that fetches unconditionally and hides the card.
     */
    expect(PAGE).toMatch(/canSeeTeam && workspace \? getPipelineTotals\(/)
    expect(PAGE).toMatch(/canSeeTeam && workspace \? countOverdueTasks\(/)
  })

  it('derives the gate from the permission catalogue, not from a role list', () => {
    expect(PAGE).toMatch(/can\(policy, 'report\.team\.view'\)/)
    /*
     * A hand-written role check would drift from `PERMISSIONS` the first time
     * the minimum role moved. `lib/auth/decide.ts` is the single decision point
     * and `can()` is how a surface asks it.
     */
    expect(PAGE, 'the gate hardcodes roles instead of asking can()').not.toMatch(
      /role === 'owner'|role === 'manager'|\['owner', 'admin'/,
    )
  })

  it('asks for the whole workspace, not the current user', () => {
    /*
     * ⚠️ THE QUIET FAILURE. `getPipelineTotals(id, ctx.userId)` compiles, runs,
     * and renders one person's pipeline under a heading that says "Team
     * activity" — a manager reads their own deals as the company's and nothing
     * on screen contradicts them.
     */
    const teamFetch = PAGE.slice(PAGE.indexOf('canSeeTeam && workspace ? getPipelineTotals('))
    const call = teamFetch.slice(0, teamFetch.indexOf(')') + 1)
    expect(call).toMatch(/, null\)/)
    expect(call, 'the team pipeline is scoped to one user').not.toMatch(/ctx\.userId/)
  })
})

describe('the permission itself still means what the gate assumes', () => {
  it('report.team.view starts at manager', () => {
    /*
     * The gate is only as good as the entry behind it. If this dropped to
     * `setter`, every assertion above would still pass while a setter read the
     * workspace's numbers.
     */
    /*
     * ⚠️ READ FROM SOURCE, BECAUSE `PERMISSIONS` IS MODULE-PRIVATE AND SHOULD
     * STAY THAT WAY. Exporting a table so a test can read it is how an API
     * grows shapes nobody wanted; the behavioural check below is the real
     * guard, and this pins the specific number it depends on.
     */
    const permissions = readFileSync(
      join(ROOT, 'lib/workspaces/permissions.ts'),
      'utf8',
    )
    expect(permissions).toMatch(
      /'report\.team\.view': \{ minRole: 'manager', module: 'reports' \}/,
    )
  })

  it('owner, admin and manager have it; setter and viewer do not', () => {
    const modules = new Set(['reports'] as const)
    const holds = (role: WorkspaceRole) =>
      can({ role, modules: modules as never }, 'report.team.view')

    for (const role of ['owner', 'admin', 'manager'] as const) {
      expect(holds(role), `${role} should see team figures`).toBe(true)
    }
    for (const role of ['setter', 'viewer'] as const) {
      expect(holds(role), `${role} must not see team figures`).toBe(false)
    }
  })
})

describe('the two panels cannot be confused for each other', () => {
  it('“Your activity” and “Team activity” stay distinct', () => {
    /*
     * ⚠️ TWO PANELS OF SIMILAR FIGURES IS THE WHOLE RISK. `PerformanceRow` says
     * "Your activity" in its heading, its aria-label and its empty state. If the
     * team panel adopted the same words, a manager would read their own pipeline
     * as the company's — the same confusion `TestFlow` guards against with "Run
     * now".
     */
    const performance = strip(
      readFileSync(join(ROOT, 'components/product/PerformanceRow.tsx'), 'utf8'),
    )
    expect(performance).toContain('Your activity')
    expect(TEAM_ROW).toContain('Team activity')
    expect(TEAM_ROW, 'the team panel calls itself "Your activity"').not.toContain('Your activity')
  })

  it('the team panel replaces nothing', () => {
    // Rendered in addition to `PerformanceRow`, never instead of it: a manager
    // still has their own work and still wants to see it.
    expect(PAGE).toContain('<PerformanceRow')
    expect(PAGE).toContain('<TeamRow')
  })
})

describe('the money warning is shared, not copied', () => {
  it('the team panel carries the unconvertible-deals warning', () => {
    /*
     * ⚠️ WITHOUT IT THE TWO FIGURES LIE TOGETHER. 0124 sums
     * `value_amount_base`, NULL without a rate, and `sum()` skips NULLs — so an
     * unconvertible deal is counted in "Open deals" and absent from "Open
     * pipeline", and dividing one by the other gives an average deal size that
     * is wrong.
     */
    /*
     * ⚠️ ANCHORED ON THE JSX, NOT THE NAME. `toContain('ExcludedDeals')`
     * matched the IMPORT line and passed with the component removed from the
     * markup entirely — proven by mutation. An import that renders nothing is
     * exactly the shape of this bug.
     */
    expect(TEAM_ROW).toMatch(/<ExcludedDeals count=\{unconvertible\}/)
    expect(PAGE).toMatch(/unconvertible=\{teamPipeline\?\.unconvertible/)
  })

  it('one implementation of the sentence, used by both surfaces', () => {
    // It was a local function inside the reports page. A second copy for the
    // home would drift, invisibly, because both would still render something
    // plausible.
    const shared = readFileSync(join(ROOT, 'components/product/ExcludedDeals.tsx'), 'utf8')
    expect(shared).toContain('export function ExcludedDeals')
    const reports = strip(
      readFileSync(join(ROOT, 'app/(product)/crm/reports/page.tsx'), 'utf8'),
    )
    expect(reports).toContain("from '@/components/product/ExcludedDeals'")
    expect(reports, 'the reports page defines its own copy again').not.toMatch(
      /function ExcludedDeals\(/,
    )
  })
})
