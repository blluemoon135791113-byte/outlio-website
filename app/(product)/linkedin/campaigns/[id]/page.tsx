import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { WorkflowBuilder } from '@/components/linkedin/WorkflowBuilder'
import { unconfirmedNote } from '@/lib/linkedin/campaign-progress'
import { getCampaign } from '@/lib/linkedin/campaigns'
import { enrollmentsPerStep, getWorkflow } from '@/lib/linkedin/workflow-store'
import { workspaceContextIfPermitted } from '@/lib/workspaces/context'

export const metadata: Metadata = {
  title: 'Campaign workflow | Outlio',
  robots: { index: false, follow: false },
}

/**
 * One campaign, and the workflow its customer built — Phase 20.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE GATE IS SERVER-SIDE AND IT IS HERE, NOT IN THE COMPONENT.         ║
 * ║                                                                           ║
 * ║  `workspaceContextIfPermitted` returning null means this person may not    ║
 * ║  read this workspace's CRM, and `getCampaign` scopes by workspace so an    ║
 * ║  id guessed from another tenant returns nothing. Both matter: the first    ║
 * ║  stops the query, the second stops the answer.                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export default async function CampaignWorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const ctx = await workspaceContextIfPermitted('crm.contact.view')
  // `linkedin/layout.tsx` renders the reason; this only stops the page computing.
  if (!ctx) return null

  if (!ctx.modules.has('linkedin')) {
    return (
      <div className="clay p-6">
        <h2 className="text-sm font-semibold text-ink">LinkedIn is not included in your plan</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Once it is enabled, your campaigns and their workflows appear here.
        </p>
      </div>
    )
  }

  const campaign = await getCampaign(ctx.workspace.id, id)
  /*
   * ⚠️ `notFound()` RATHER THAN A "NO ACCESS" MESSAGE. `getCampaign` returns
   * null both for a campaign that does not exist and for one belonging to
   * another workspace. Distinguishing them in the response would confirm that
   * an id is real to somebody who cannot see it.
   */
  if (!campaign) notFound()

  const [steps, standingOn] = await Promise.all([
    getWorkflow(ctx.workspace.id, id),
    enrollmentsPerStep(ctx.workspace.id, id),
  ])

  const note = unconfirmedNote(campaign.progress)

  return (
    <div className="space-y-4">
      <Link
        href="/linkedin/campaigns"
        className="text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
      >
        ← All campaigns
      </Link>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">
            {campaign.name}
          </h2>
          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-muted">
            {campaign.state.toLowerCase()}
          </span>
        </div>
        {/*
          ⚠️ THE UNCONFIRMED SENTENCE TRAVELS WITH THE CAMPAIGN EVERYWHERE IT IS
          SHOWN. `CampaignList` refuses a progress bar because a single number
          has to decide whether an unconfirmed action happened; omitting the
          sentence here would quietly make that same decision by leaving it out.
        */}
        {note ? <p className="mt-1 text-xs leading-relaxed text-warning">{note}</p> : null}
      </div>

      <WorkflowBuilder
        campaignId={campaign.id}
        initial={steps.map((step) => ({
          id: step.id,
          action: step.action,
          body: step.body,
          waitDays: step.waitDays,
          config: step.config,
        }))}
        standingOn={Object.fromEntries(standingOn)}
        /*
         * ⚠️ `enrollments` IS EVERY ENROLMENT, LIVE OR ENDED — the same
         * denominator `campaignProgress` uses. The header card reads "N people"
         * and the honest N is how many are in the campaign, not how many are
         * currently mid-sequence, which would shrink as the work succeeded.
         */
        contactCount={campaign.progress.enrollments}
      />
    </div>
  )
}
