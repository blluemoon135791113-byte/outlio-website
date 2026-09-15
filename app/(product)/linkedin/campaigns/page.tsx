import type { Metadata } from 'next'

import { CampaignList, type CampaignCard } from '@/components/linkedin/CampaignList'
import { unconfirmedNote } from '@/lib/linkedin/campaign-progress'
import { getCampaign, listCampaigns } from '@/lib/linkedin/campaigns'
import { workspaceContextIfPermitted } from '@/lib/workspaces/context'

export const metadata: Metadata = {
  title: 'LinkedIn campaigns | Outlio',
  robots: { index: false, follow: false },
}

/**
 * LinkedIn campaigns — Phase 18.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ A CAMPAIGN HERE IS A GROUPING, NOT AN AUTOMATION.                     ║
 * ║                                                                           ║
 * ║  CLAUDE.md rule 1 is unchanged: Outlio never opens linkedin.com. Every    ║
 * ║  action is performed by a person in LinkedIn's own interface, and this    ║
 * ║  screen only says who a push is aimed at and what is known about it.      ║
 * ║                                                                           ║
 * ║  ⚠️ EVERY NUMBER ON IT IS DERIVED ON READ. 0128 stores no counters —      ║
 * ║  a cached total can disagree with the rows an operator actually changed.  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export default async function LinkedInCampaignsPage() {
  const ctx = await workspaceContextIfPermitted('crm.contact.view')
  // `linkedin/layout.tsx` renders the reason; this only stops the page computing.
  if (!ctx) return null

  if (!ctx.modules.has('linkedin')) {
    return (
      <div className="clay p-6">
        <h2 className="text-sm font-semibold text-ink">LinkedIn is not included in your plan</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Once it is enabled, the campaigns you are running appear here.
        </p>
      </div>
    )
  }

  const summaries = await listCampaigns(ctx.workspace.id)

  /*
   * ⚠️ PROGRESS IS FETCHED PER CAMPAIGN, AND THAT IS A COST WORTH NAMING.
   * `listCampaigns` deliberately returns no progress, because deriving it is
   * two queries each. Here that is 2N round trips for N campaigns — acceptable
   * while a workspace has a handful, and the first thing to fix if this page
   * ever feels slow. The alternative — a stored counter — is the thing 0128
   * refuses, because a number that disagrees with its rows is worse than a
   * page that takes a moment.
   */
  const campaigns: CampaignCard[] = []
  for (const summary of summaries) {
    const full = await getCampaign(ctx.workspace.id, summary.id)
    if (!full) continue
    campaigns.push({
      id: full.id,
      name: full.name,
      state: full.state,
      progress: full.progress,
      unconfirmedNote: unconfirmedNote(full.progress),
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">Campaigns</h2>
        <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-muted">
          A campaign groups the people one outreach push is aimed at. Outlio prepares the
          work; you perform every action in LinkedIn yourself.
        </p>
      </div>

      <CampaignList campaigns={campaigns} />
    </div>
  )
}
