import type { Metadata } from 'next'

import { SenderSettings, type SenderView } from '@/components/linkedin/SenderSettings'
import { SettingsShell } from '@/components/settings/SettingsShell'
import { STAGES } from '@/lib/linkedin/budget'
import { listWorkspaceSenders, senderBudget } from '@/lib/linkedin/senders'
import { createAdminClient } from '@/lib/supabase/admin'
import { workspaceContextIfPermitted } from '@/lib/workspaces/context'

export const metadata: Metadata = {
  title: 'LinkedIn accounts | Outlio',
  robots: { index: false, follow: false },
}

/**
 * The LinkedIn sender settings.
 *
 * ⚠️ THE BUDGET IS READ PER SENDER, PER KIND, AND THAT IS TWO QUERIES EACH.
 * Bounded by how many accounts a workspace may link — which the plan caps at
 * the seat count — so it is small by construction rather than by hope. If that
 * cap is ever raised into the hundreds this becomes a single grouped query
 * instead.
 */
export default async function LinkedInSettingsPage() {
  const ctx = await workspaceContextIfPermitted('crm.contact.view')
  // The layout renders the reason; this only stops the page computing.
  if (!ctx) return null

  const enabled = ctx.modules.has('linkedin')
  const senders = await listWorkspaceSenders(ctx.workspace.id)

  /*
   * ⚠️ `owner_user_id` IS READ HERE AND NEVER SENT TO THE CLIENT. The card
   * needs to know whether the viewer may attest to this account, which is a
   * boolean — shipping the id would put a user identifier in an RSC payload to
   * answer a yes/no question.
   */
  const { data: owners } = senders.length
    ? await createAdminClient()
        .from('linkedin_senders')
        .select('id, owner_user_id, last_owner_review_at')
        .in('id', senders.map((s) => s.senderId))
    : { data: [] }

  const meta = new Map(
    (owners ?? []).map((o) => [o.id, { mine: o.owner_user_id === ctx.userId, reviewedAt: o.last_owner_review_at }]),
  )

  const views: SenderView[] = await Promise.all(
    senders.map(async (s) => {
      const stageCaps = STAGES[Math.min(Math.max(s.stage, 0), STAGES.length - 1)]!

      /*
       * Three kinds, because those are the three a manual sequence spends.
       * InMail is deliberately absent: it is bounded by recorded credits as
       * well as by the ladder, and showing a ladder figure alone would overstate
       * what is actually available.
       */
      const [invitation, dm, review] = await Promise.all([
        senderBudget(s.senderId, 'invitation', {
          stage: s.stage,
          externalReservePerDay: 0,
          customerDailyCap: null,
        }),
        senderBudget(s.senderId, 'direct_message', {
          stage: s.stage,
          externalReservePerDay: 0,
          customerDailyCap: null,
        }),
        senderBudget(s.senderId, 'profile_review', {
          stage: s.stage,
          externalReservePerDay: 0,
          customerDailyCap: null,
        }),
      ])

      return {
        senderId: s.senderId,
        displayLabel: s.displayLabel,
        status: s.status,
        stage: s.stage,
        isMine: meta.get(s.senderId)?.mine ?? false,
        lastOwnerReviewAt: meta.get(s.senderId)?.reviewedAt ?? null,
        budgets: [
          { label: 'Invitations', remaining: invitation.remaining, cap: stageCaps.invitation.perDay, limitedBy: invitation.limitedBy },
          { label: 'Messages', remaining: dm.remaining, cap: stageCaps.direct_message.perDay, limitedBy: dm.limitedBy },
          { label: 'Profile views', remaining: review.remaining, cap: stageCaps.profile_review.perDay, limitedBy: review.limitedBy },
        ],
      }
    }),
  )

  return (
    <SettingsShell
      title="LinkedIn accounts"
      description="Outlio prepares the work. You perform every action in LinkedIn yourself."
    >
      <SenderSettings senders={views} enabled={enabled} />
    </SettingsShell>
  )
}
