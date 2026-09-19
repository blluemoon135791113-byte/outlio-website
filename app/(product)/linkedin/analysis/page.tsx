import type { Metadata } from 'next'

import { StrategyAnalysis } from '@/components/linkedin/StrategyAnalysis'
import { listAssignableMembers } from '@/lib/crm/contacts-list'
import { analysisEntitled } from '@/lib/linkedin/analysis'
import { workspaceContextIfPermitted } from '@/lib/workspaces/context'
import { can } from '@/lib/workspaces/permissions'

export const metadata: Metadata = {
  title: 'Strategy analysis | Outlio',
  robots: { index: false, follow: false },
}

/**
 * The strategy analysis — Phase 20, premium and manager-only.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ TWO SEPARATE GATES, AND NEITHER IMPLIES THE OTHER.                    ║
 * ║                                                                           ║
 * ║  `report.team.view` is a ROLE question — may this person see a colleague's ║
 * ║  numbers and a summary of their messages. `analysisEntitled` is a PLAN     ║
 * ║  question — did this workspace pay for the feature. An owner on a starter  ║
 * ║  plan holds every role permission there is and must still be refused.     ║
 * ║                                                                           ║
 * ║  ⚠️ AND BOTH ARE RE-ASKED IN THE ACTION. Hiding this page is not access   ║
 * ║  control (rule 8): `analyseAction` gates on the permission and            ║
 * ║  `analyseStrategy` re-checks the plan before it reads a row.              ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export default async function StrategyAnalysisPage() {
  /*
   * ╔═══════════════════════════════════════════════════════════════════════════╗
   * ║  ⚠️ THE LAYOUT'S PERMISSION FIRST, THEN THE STRICTER ONE. GATING ONLY ON  ║
   * ║  `report.team.view` HERE WAS A REAL PAYLOAD LEAK.                        ║
   * ║                                                                           ║
   * ║  `linkedin/layout.tsx` refuses by RENDERING a reason rather than          ║
   * ║  redirecting, so a page under it that computes anyway puts its output in  ║
   * ║  the RSC payload regardless of what the layout drew. The two permissions  ║
   * ║  do not nest: a manager on a plan with reports but without CRM holds      ║
   * ║  `report.team.view` and not `crm.contact.view`, so the layout would       ║
   * ║  refuse while this page happily rendered a colleague's numbers.          ║
   * ║                                                                           ║
   * ║  Caught by `module-page-guard.test.ts`, which asserts every page under a  ║
   * ║  rendering gate asks for that gate's own permission.                     ║
   * ╚═══════════════════════════════════════════════════════════════════════════╝
   */
  const ctx = await workspaceContextIfPermitted('crm.contact.view')
  // `linkedin/layout.tsx` renders the reason; this only stops the page computing.
  if (!ctx) return null

  /*
   * ⚠️ AND THIS IS THE DISCLOSURE GATE. The report shows one rep's numbers and a
   * summary of their messages to somebody else — the same thing
   * `report.team.view` governs on the reports page. `analyseAction` re-asks it,
   * because hiding a page is not access control (rule 8).
   */
  if (!can({ role: ctx.role, modules: ctx.modules }, 'report.team.view')) {
    return (
      <div className="clay p-6">
        <h2 className="text-sm font-semibold text-ink">This is a manager view</h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
          Strategy analysis compares what each person on the team wrote and what came back, so
          it is available to managers and owners.
        </p>
      </div>
    )
  }

  if (!ctx.modules.has('linkedin')) {
    return (
      <div className="clay p-6">
        <h2 className="text-sm font-semibold text-ink">LinkedIn is not included in your plan</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Once it is enabled, your team&apos;s messaging analysis appears here.
        </p>
      </div>
    )
  }

  if (!(await analysisEntitled(ctx.workspace.id))) {
    /*
      ⚠️ A DESIGNED REFUSAL THAT NAMES WHAT IT WOULD DO. "Not included in your
      plan" alone tells somebody they cannot have a thing without telling them
      what the thing is, which is the least useful moment to be vague.
    */
    return (
      <div className="clay p-6">
        <h2 className="text-sm font-semibold text-ink">Strategy analysis is a premium feature</h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
          It reads the openers and pitches your team wrote, alongside what was actually recorded
          as sent and replied, and reports what is working — overall and per person. It is not
          included on your current plan.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">
          Strategy analysis
        </h2>
        <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-muted">
          What your team is saying, and what came back.
        </p>
      </div>

      {/*
        ⚠️ WORKSPACE MEMBERS, WHICH IS THE SAME LIST THE CONTACTS SCREEN
        ASSIGNS FROM. The analysis attributes work to whoever COMPLETED a task
        or AUTHORED a message, and both are members — so this is the superset,
        and offering a name with no recorded work simply produces a report
        saying so, which is a truthful answer to a reasonable question.
      */}
      <StrategyAnalysis people={await listAssignableMembers(ctx.workspace.id)} />
    </div>
  )
}
