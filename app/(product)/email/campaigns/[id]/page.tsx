import type { Metadata } from 'next'

import { SequenceBuilder } from '@/components/email/SequenceBuilder'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { CampaignControls } from '@/components/email/CampaignControls'
import { policyFor, type CampaignType } from '@/lib/email/campaign-policy'
import { createAdminClient } from '@/lib/supabase/admin'
import { workspaceContextIfPermitted } from '@/lib/workspaces/context'
import { can } from '@/lib/workspaces/permissions'

export const metadata: Metadata = {
  title: 'Campaign | Outlio',
  robots: { index: false, follow: false },
}

/**
 * One campaign.
 *
 * ⚠️ EVERY FIGURE HERE COMES FROM `email_campaign_report`, which counts the
 * append-only event stream. There are no counter columns, so what this page
 * shows and what the raw events say cannot drift (M6 criterion 5).
 */
export default async function CampaignPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await workspaceContextIfPermitted('email.campaign.view')
  // The layout renders the reason; this only stops the page computing and
  // serialising its result into the RSC payload.
  if (!ctx) return null
  const db = createAdminClient()

  const { data: campaign } = await db
    .from('email_campaigns')
    .select('id, name, type, status, account_id, started_at')
    .eq('workspace_id', ctx.workspace.id)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!campaign) notFound()

  const [{ data: steps }, { data: report }, { data: account }] = await Promise.all([
    db.from('email_sequence_steps')
      .select('id, step_index, wait_hours, subject, body_text')
      .eq('campaign_id', id).order('step_index'),
    db.rpc('email_campaign_report', { p_campaign_id: id }),
    db.from('email_accounts').select('display_name, from_email').eq('id', campaign.account_id ?? '').maybeSingle(),
  ])

  const r = report?.[0]
  const policy = policyFor(campaign.type as CampaignType)
  const canLaunch = can({ role: ctx.role, modules: ctx.modules }, 'email.campaign.launch')
  // Authoring a sequence is a template job, not a launching one — a manager can
  // write the emails without being the person allowed to send them.
  const canManage = can({ role: ctx.role, modules: ctx.modules }, 'email.template.manage')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/email/campaigns" className="text-xs text-muted hover:text-ink">
            ← Campaigns
          </Link>
          <h2 className="mt-1 text-base font-semibold tracking-[-0.02em] text-ink">
            {campaign.name}
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            {policy.stopsOnReply ? 'Stops when someone replies' : 'Keeps sending after a reply'}
            {account ? ` · from ${account.from_email}` : ' · no mailbox'}
          </p>
        </div>
        {canLaunch ? (
          <CampaignControls campaignId={id} status={campaign.status} />
        ) : null}
      </div>

      {/*
        ⚠️ THE LAUNCH BLOCKERS ARE SHOWN BEFORE LAUNCH, not as an error after
        pressing the button. `assertLaunchable` still refuses server-side —
        this is the courtesy, not the control.
      */}
      {campaign.status === 'draft' ? (
        <ul className="clay space-y-1.5 p-4 text-sm">
          <Requirement met={(steps ?? []).length > 0}>
            At least one step written
          </Requirement>
          <Requirement met={Boolean(campaign.account_id)}>A mailbox to send from</Requirement>
          <Requirement met={(r?.recipients ?? 0) > 0}>Contacts enrolled</Requirement>
          {!policy.allowsMultipleSteps && (steps ?? []).length > 1 ? (
            <Requirement met={false}>
              A broadcast sends one message — remove the extra steps, or use a sales sequence
            </Requirement>
          ) : null}
        </ul>
      ) : null}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-ink">Results</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Recipients" value={Number(r?.recipients ?? 0)} />
          <Stat
            label="Eligible"
            value={Number(r?.eligible ?? 0)}
            note="Excludes suppressed and bounced"
          />
          <Stat label="Sent" value={Number(r?.sent ?? 0)} />
          <Stat label="Delivered" value={Number(r?.delivered ?? 0)} />
          <Stat label="Replies" value={Number(r?.replied ?? 0)} />
          <Stat
            label="Reply rate"
            // NULL, not 0%: a campaign that has not sent has no rate.
            value={r?.reply_rate === null || r?.reply_rate === undefined
              ? '—'
              : `${Math.round(Number(r.reply_rate) * 100)}%`}
            note="Auto-replies excluded"
          />
          <Stat label="Auto-replies" value={Number(r?.auto_replied ?? 0)} note="Never counted as replies" />
          <Stat label="Bounced" value={Number(r?.bounced ?? 0)} />
          <Stat label="Unsubscribed" value={Number(r?.unsubscribed ?? 0)} />
          <Stat label="Stopped — replied" value={Number(r?.stopped_replied ?? 0)} />
          <Stat label="Stopped — unsubscribed" value={Number(r?.stopped_unsub ?? 0)} />
          <Stat label="Still active" value={Number(r?.still_active ?? 0)} />
        </div>
        <p className="text-xs text-muted">
          Counted from the raw event stream, so these figures cannot drift from what actually
          happened.
        </p>
      </section>

      {/*
        ⚠️ THE READ-ONLY STEP LIST IS REPLACED BY AN EDITOR. It used to render
        the steps and offer no way to author one — `email_sequence_steps` has
        existed since M6 and nothing in the product could write to it, so every
        campaign was empty and `assertLaunchable` refused it.
      */}
      {canManage ? (
        <SequenceBuilder
          campaignId={campaign.id}
          status={campaign.status}
          steps={(steps ?? []).map((step) => ({
            id: step.id,
            stepIndex: step.step_index,
            waitHours: step.wait_hours,
            subject: step.subject,
            bodyText: step.body_text,
          }))}
        />
      ) : (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-ink">Steps</h3>
          {(steps ?? []).length === 0 ? (
            <div className="clay p-6 text-center">
              <p className="text-sm text-muted">No steps yet.</p>
            </div>
          ) : (
            <ol className="space-y-2">
              {(steps ?? []).map((step) => (
                <li key={step.id} className="clay p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                      Step {step.step_index + 1}
                    </span>
                    <span className="text-xs text-muted">
                      {step.wait_hours === 0
                        ? 'Sends immediately'
                        : `Waits ${formatWait(step.wait_hours)} first`}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm font-semibold text-ink">{step.subject}</p>
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-muted">
                    {step.body_text}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  )
}

function formatWait(hours: number): string {
  if (hours % 24 === 0) {
    const days = hours / 24
    return `${days} day${days === 1 ? '' : 's'}`
  }
  return `${hours} hour${hours === 1 ? '' : 's'}`
}

function Requirement({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span
        className={
          met
            ? 'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-success'
            : 'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning'
        }
      />
      <span className={met ? 'text-muted' : 'text-ink'}>{children}</span>
    </li>
  )
}

function Stat({
  label,
  value,
  note,
}: {
  label: string
  value: number | string
  note?: string
}) {
  return (
    <div className="clay p-4">
      <p className="text-xs uppercase tracking-[0.08em] text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-[-0.02em] text-ink">{value}</p>
      {note ? <p className="mt-1 text-[11px] leading-snug text-muted">{note}</p> : null}
    </div>
  )
}
