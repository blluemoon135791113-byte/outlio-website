import { randomUUID } from 'node:crypto'
import type { Metadata } from 'next'
import Link from 'next/link'

import { ExtensionCard } from '@/components/extension/ExtensionCard'
import { FirstRun } from '@/components/onboarding/FirstRun'
import { LiveCapture } from '@/components/extension/LiveCapture'
import { CreditsSummary } from '@/components/product/CreditsSummary'
import { HeadlineRow, RangePicker } from '@/components/product/HeadlineRow'
import { PerformanceRow } from '@/components/product/PerformanceRow'
import { TeamRow } from '@/components/product/TeamRow'
import { LocalTime } from '@/components/ui/LocalTime'
import { ReferralCard } from '@/components/product/ReferralCard'
import { requireAccess } from '@/lib/auth/access'
import { getHeadlineKpis, getOverviewPerformance, hasRealActivity } from '@/lib/crm/overview'
import { getActiveSession } from '@/lib/extension/capture'
import { countDevices } from '@/lib/extension/devices'
import { appOrigin } from '@/lib/auth/redirects'
import { loadFirstRun, shouldShowFirstRun } from '@/lib/onboarding/steps'
import { referralLink } from '@/lib/referrals/constants'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveUploadLimits } from '@/lib/upload/limits'
import { getWorkspaceContext } from '@/lib/workspaces/context'
import { countOverdueTasks, getPipelineTotals, resolveRange } from '@/lib/crm/reports'
import { can } from '@/lib/workspaces/permissions'
import { AnalyticsValidationPanel } from '@/components/product/AnalyticsValidationPanel'

export const metadata: Metadata = {
  title: 'Dashboard | Outlio',
  robots: { index: false, follow: false },
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>
}) {
  const ctx = await requireAccess()
  const admin = createAdminClient()

  /*
   * ⚠️ VALIDATED, NOT PASSED THROUGH. `resolveRange` checks the value against
   * its own allowlist and falls back to 30 days, so a hand-edited URL degrades
   * to the ordinary view rather than to an error page — the same rule the
   * contacts list applies to `sort`.
   */
  const range = resolveRange((await searchParams).range).key

  // Rendered server-side so the widget is correct on first paint; Realtime
  // takes over from there.
  const [
    activeCapture,
    connectedDevices,
    { data: balanceRows },
    { data: referralRows },
    { data: subscription },
    firstExtraction,
  ] = await Promise.all([
    getActiveSession(ctx.userId!),
    countDevices(ctx.userId!),
    admin.rpc('credit_balance', { p_user_id: ctx.userId! }),
    admin.rpc('referral_summary', { p_user_id: ctx.userId! }),
    admin
      .from('subscriptions')
      .select('status, provider')
      .eq('user_id', ctx.userId!)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  HAS THIS PERSON EVER RUN AN EXTRACTION?                              ║
     * ║                                                                       ║
     * ║  ⚠️ EVER, NOT THIS MONTH. `ctx.usage` already carries                 ║
     * ║  `extractionsToday` and `extractionsThisMonth`, and either would have ║
     * ║  been free — and both are period counters, so a customer of two years ║
     * ║  who happened not to extract in January would be shown "Build your    ║
     * ║  first lead list" again. The question the panel asks is about their   ║
     * ║  whole history with the product.                                      ║
     * ║                                                                       ║
     * ║  ⚠️ `head: true` WITH `limit(1)` — EXISTENCE, NOT A COUNT. Nothing    ║
     * ║  renders the number, and a workspace with thousands of jobs should    ║
     * ║  not pay for counting them to answer "is it more than zero".          ║
     * ║                                                                       ║
     * ║  ⚠️ ANY STATUS. A failed or cancelled extraction still means this     ║
     * ║  person has found the feature and used it; re-teaching them is        ║
     * ║  exactly the noise this condition is meant to remove.                 ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    admin
      .from('extraction_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', ctx.userId!)
      .limit(1),
  ])
  /*
   * ⚠️ THE CHECKLIST IS LOADED SEPARATELY AND FAILS SOFT. A workspace context
   * that cannot be resolved -- a Lead Engine account with no workspace yet --
   * must not take the whole dashboard down with it. No workspace simply means
   * no checklist.
   */
  const workspace = await getWorkspaceContext()
  const policy = workspace ? { role: workspace.role, modules: workspace.modules } : null

  /*
   * ⚠️ THE PERFORMANCE ROW IS GATED AND FAILS SOFT, for the two separate
   * reasons above it. Gated because these are CRM figures and a member without
   * `crm.contact.view` has no business reading them; soft because a Lead Engine
   * account has no workspace at all, and neither that nor a reporting outage
   * may take the upload path down with it.
   */
  /*
   * ╔═══════════════════════════════════════════════════════════════════════════╗
   * ║  ⚠️ THE TEAM ROW IS GATED ON THE FETCH, NOT ON THE RENDER.               ║
   * ║                                                                           ║
   * ║  §8.1: "the home surface must be server-side filtered — hiding a card is  ║
   * ║  not access control, and a layout is not a boundary". So a viewer without ║
   * ║  `report.team.view` does not merely fail to see these figures; they are   ║
   * ║  never read, and never reach the RSC payload where a devtools panel would ║
   * ║  show them.                                                              ║
   * ║                                                                           ║
   * ║  Same shape `/crm/reports` already uses for its leaderboard, deliberately ║
   * ║  — two surfaces answering one question ("may this person see the team's   ║
   * ║  numbers") must not answer it two different ways.                        ║
   * ╚═══════════════════════════════════════════════════════════════════════════╝
   *
   * ⚠️ `minRole: 'manager'`, so an owner, admin and manager see it and a setter
   * or viewer does not. A setter's own figures are already beside this in "Your
   * activity", which is the panel that answers their question.
   */
  const canSeeTeam = Boolean(workspace && policy && can(policy, 'report.team.view'))

  const [firstRun, performance, headline, teamPipeline, teamOverdue] = await Promise.all([
    workspace && policy ? loadFirstRun(workspace.workspace.id, policy) : null,
    workspace && policy && can(policy, 'crm.contact.view')
      ? getOverviewPerformance(workspace.workspace.id, ctx.userId!, range)
      : null,
    /*
     * ⚠️ THE SAME PERMISSION AS THE ROW BELOW, NOT `report.team.view`. This row
     * is workspace TOTALS — how many leads, how many deals, how much revenue —
     * and carries nothing about an individual colleague. `report.team.view`
     * governs per-person disclosure, which is the team panel further down.
     */
    workspace && policy && can(policy, 'crm.contact.view')
      ? getHeadlineKpis(workspace.workspace.id, range)
      : null,
    /*
     * `null` as the owner means "the whole workspace" in both of these — the
     * same argument `/crm/reports` passes for its team panels. Passing
     * `ctx.userId` here would silently render one person's pipeline under a
     * heading that says "Team activity".
     */
    canSeeTeam && workspace ? getPipelineTotals(workspace.workspace.id, null) : null,
    canSeeTeam && workspace ? countOverdueTasks(workspace.workspace.id, null) : null,
  ])

  const checklist =
    firstRun && shouldShowFirstRun(firstRun) && workspace && policy ? (
      <FirstRun data={firstRun} canDismiss={can(policy, 'workspace.settings.manage')} />
    ) : null
  // A first day has nothing to read; a working week does.
  const checklistFirst = !performance || !hasRealActivity(performance)

  /*
   * ╔═══════════════════════════════════════════════════════════════════════════╗
   * ║  THE "Build your next lead list" PANEL IS NOW FIRST-RUN ONLY.            ║
   * ║                                                                           ║
   * ║  It was unconditional: a large panel teaching a feature, permanently, on  ║
   * ║  a screen people open every day — and BOTH its actions already exist on   ║
   * ║  the same screen. "Find your first leads" is the header's primary button, ║
   * ║  and "Open workspace" is the sidebar's Lead sources. For anybody past     ║
   * ║  their first extraction it was a third copy of two links.                 ║
   * ║                                                                           ║
   * ║  ⚠️ AND THE FAILURE DIRECTION IS CHOSEN, NOT DEFAULTED. A count that      ║
   * ║  could not be read arrives as `null`, which is NOT zero — the distinction ║
   * ║  this file already insists on for the credit balance. Unknown SHOWS the   ║
   * ║  panel: a redundant CTA in front of a veteran is a smaller failure than   ║
   * ║  hiding the only guidance a brand-new customer has. So the test is        ║
   * ║  "known to have extracted", never "not known to have".                    ║
   * ╚═══════════════════════════════════════════════════════════════════════════╝
   */
  const hasExtracted = (firstExtraction.count ?? 0) > 0

  const referral = Array.isArray(referralRows) ? referralRows[0] : null
  const balance = Array.isArray(balanceRows) ? balanceRows[0] : null
  const limits = ctx.plan?.limits
  const uploadLimits = resolveUploadLimits(limits ?? null)
  const usage = ctx.usage
  const upgradeTarget = nextPlan(ctx.plan?.key)

  const metrics = [
    {
      label: 'Credits remaining',
      /*
       * ⚠️ null MEANS "WE DO NOT KNOW", AND 0 MEANS "NONE LEFT".
       *
       * This was `balance?.remaining ?? 0`, so a missing balance row rendered
       * as a hard zero — indistinguishable from an exhausted account. A user
       * who reads 0 concludes they cannot work and stops. Same failure shape
       * as the empty lead list documented in HubbleConsole.
       */
      value: balance?.remaining ?? null,
      limit: balance?.allowance ?? null,
      featured: true,
    },
    {
      label: 'Lead searches today',
      value: usage?.extractionsToday ?? 0,
      limit: limits?.extractions_per_day ?? null,
    },
    {
      label: 'Lead searches this month',
      value: usage?.extractionsThisMonth ?? 0,
      limit: limits?.extractions_per_month ?? null,
    },
    {
      label: 'Records this month',
      value: usage?.recordsThisMonth ?? 0,
      limit: limits?.records_per_month ?? null,
    },
    {
      label: 'Exports this month',
      value: usage?.exportsThisMonth ?? 0,
      limit: limits?.exports_per_month ?? null,
    },
  ]

  return (
    <div className="space-y-6">
      {process.env.NODE_ENV !== 'production' &&
      process.env.NEXT_PUBLIC_POSTHOG_SYNTHETIC === 'true' &&
      workspace ? (
        <AnalyticsValidationPanel
          workspaceId={workspace.workspace.id}
          validationRunId={randomUUID()}
        />
      ) : null}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.035em] text-ink sm:text-[30px]">
            Overview
          </h1>
          <p className="mt-1 text-sm text-muted">
            What your outreach did, and what it used.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/*
            ⚠️ AT PAGE LEVEL, BECAUSE IT GOVERNS BOTH FIGURE ROWS. It sat
            inside the workspace row, where it looked like that row's own
            control while silently re-scoping "Your activity" underneath it —
            a control whose effect reaches outside the box it is drawn in.
          */}
          {headline ? <RangePicker current={range} /> : null}
          <Link
            href="/dashboard/intelligence"
            className="inline-flex h-10 items-center justify-center rounded-[var(--radius-md)] border border-border-strong bg-panel px-4 text-sm font-semibold text-ink transition-[border-color,background-color,transform] duration-150 ease-out hover:border-accent/35 hover:bg-accent-soft/40 active:scale-[0.97]"
          >
            Research with Hubble
          </Link>
          <Link
            href="/dashboard/extract/new"
            className="product-gradient inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] px-4 text-sm font-semibold text-white transition-[filter,transform] duration-150 ease-out hover:brightness-95 active:scale-[0.97]"
          >
            <span aria-hidden className="text-base leading-none">+</span>
            Find leads
          </Link>
        </div>
      </header>

      {/*
        ⚠️ OUTCOMES ABOVE CONSUMPTION, which is the whole point of the change.
        Every number on this screen used to be about what the customer had
        spent — credits, searches, exports — and none about whether any of it
        worked. A setter opens the product to find out whether anyone replied.

        ⚠️ AND THE CHECKLIST'S OWN REASON DECIDES WHICH OF THE TWO LEADS. It
        was placed above the numbers because a first-day row of zeroes is a
        worse first screen than a list of what to do next — so it keeps that
        place until there are real figures, and yields it once there are.
        Seven items fill the entire first viewport; whichever is up there is
        the only thing most people will see. It still disappears entirely once
        every step is done — see `shouldShowFirstRun`.
      */}
      {checklistFirst ? checklist : null}
      {/*
        ⚠️ THE WORKSPACE ABOVE THE INDIVIDUAL. Both rows are figures about
        outreach and they look alike on purpose; what separates them is scope,
        and scope is what each heading states. See `HeadlineRow`.
      */}
      {headline ? <HeadlineRow data={headline} range={range} /> : null}
      {performance ? <PerformanceRow data={performance} /> : null}

      {/*
        Below "Your activity", never instead of it: a manager still has their
        own work and still wants to see it. The two answer different questions.
      */}
      {canSeeTeam ? (
        <TeamRow
          openValue={teamPipeline?.openValue ?? null}
          openCount={teamPipeline?.openDeals ?? null}
          unconvertible={teamPipeline?.unconvertible ?? null}
          overdueTasks={teamOverdue}
        />
      ) : null}
      {checklistFirst ? null : checklist}

      <section aria-label="Usage this period" className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          Usage this period
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {metrics.map((metric) => (
            <UsageCard key={metric.label} {...metric} />
          ))}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
        <div className="space-y-4">
        {/*
          ⚠️ FIRST RUN ONLY — see `hasExtracted`. This panel teaches the
          product's central feature, which is worth a lot of space exactly once
          and nothing at all afterwards.
        */}
        {!hasExtracted ? (
        <section className="relative overflow-hidden rounded-[var(--radius-clay)] bg-charcoal p-6 shadow-[var(--neo-shadow)] sm:p-7">
          <div className="relative z-10 max-w-xl">
            {/* Ivory on charcoal: the logo's own pairing, ~13:1. */}
            <h2 className="text-xl font-semibold tracking-[-0.025em] text-ivory">
              Build your first lead list
            </h2>
            <p className="mt-2 max-w-lg text-sm leading-6 text-ivory/75">
              Upload the lead-search pages you already saved. Outlio parses them on
              our servers, removes duplicates, and prepares a clean CSV.
            </p>
            {/*
              ⚠️ ONE ACTION NOW. "Open workspace" pointed at `/dashboard/jobs`,
              which lists past extractions — a link to the history of a thing
              this person has never done, on the one panel that only renders
              when they have never done it. It said nothing and led nowhere
              useful.
            */}
            <div className="mt-6">
              <Link
                href="/dashboard/extract/new"
                className="product-gradient inline-flex h-10 items-center justify-center rounded-[var(--radius-md)] px-4 text-sm font-semibold text-white transition-[filter,transform] duration-150 ease-out hover:brightness-95 active:scale-[0.97]"
              >
                Find your first leads
              </Link>
            </div>
          </div>
          <div
            aria-hidden
            className="absolute -bottom-24 -right-20 h-72 w-72 rounded-full border-[42px] border-ivory/[0.06]"
          />
          <div
            aria-hidden
            className="absolute -bottom-10 right-16 h-32 w-32 rounded-full border border-ivory/15"
          />
        </section>
        ) : null}
        <ExtensionCard connectedDevices={connectedDevices} />
        {/*
          ⚠️ MOVED OUT OF THE RIGHT RAIL, FOR TWO REASONS.

          Structurally: once the panel above became first-run only, this column
          held ONE card beside a four-card rail — a tall stack of account
          furniture next to an empty half-screen at `xl`. Hiding a block is not
          finished until the layout it left behind still balances.

          Semantically: a live capture session is the extension DOING something,
          and `ExtensionCard` directly above is where the extension is set up.
          They were two halves of one subject filed in opposite columns, while
          the rail is plan, credits and referral — account furniture, which this
          is not.
        */}
        <LiveCapture userId={ctx.userId!} initialSession={activeCapture} />
        </div>

        <div className="space-y-4">
        {/*
          ╔═══════════════════════════════════════════════════════════════════╗
          ║  ONE CARD. THIS WAS TWO, AND THEY DISAGREED ABOUT NOTHING.        ║
          ║                                                                   ║
          ║  "Account / Current access" and "Subscription" sat stacked in     ║
          ║  this rail, and between them printed the plan name TWICE and the  ║
          ║  word "Active" TWICE — in two different badge styles, one         ║
          ║  `bg-accent-soft` and one `bg-white/75`. A reader comparing them  ║
          ║  looks for the difference, and there is none to find.             ║
          ║                                                                   ║
          ║  ⚠️ AND BOTH OPENED WITH AN EYEBROW — a micro-label above a       ║
          ║  larger heading. The heading carries its own weight; the eyebrow  ║
          ║  is a second, quieter title saying the same thing.                ║
          ║                                                                   ║
          ║  ⚠️ THE "Active" BADGE IS GONE RATHER THAN DEDUPLICATED. It was   ║
          ║  a literal string on both cards — it said "Active" for a lapsed   ║
          ║  account, a cancelled subscription and a trial alike, because     ║
          ║  nothing computed it. `subscription.status` is the real field and ║
          ║  is now shown as itself.                                          ║
          ╚═══════════════════════════════════════════════════════════════════╝
        */}
        <section className="clay p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">
              {ctx.plan?.name ?? 'Current access'}
            </h2>
            <span className="shrink-0 rounded-full bg-surface-muted px-2.5 py-1 text-[11px] font-semibold capitalize text-muted">
              {/*
                The stored status, verbatim. "Manual access" is the honest
                label for a workspace with no subscription row — several of
                which exist in production.
              */}
              {subscription?.status ?? 'Manual access'}
            </span>
          </div>

          <dl className="mt-4 divide-y divide-border">
            <AccountRow label="Account" value={ctx.email ?? ''} />
            <AccountRow label="Billing" value={subscription?.provider ?? 'Not connected'} />
            {/*
              ⚠️ THE ONE ROW HERE WHERE A DAY MATTERS. This formatted in the
              server's timezone — UTC on Vercel — so an expiry stored at
              midnight UTC rendered a day EARLY for every reader west of it.
              Telling somebody their access ends on the 11th when it ends on
              the 12th is the kind of wrong that generates a support ticket.
            */}
            <AccountRow label="Access until">
              {ctx.accessExpiresAt ? (
                <LocalTime iso={ctx.accessExpiresAt} dateOnly />
              ) : (
                'No expiry'
              )}
            </AccountRow>
          </dl>

          <p className="mt-4 text-sm leading-6 text-muted">
            {upgradeTarget
              ? `Move to ${upgradeTarget} when you need more credits, files, and exports.`
              : 'Talk to us for a custom plan built around your workflow.'}
          </p>

          {/*
            ⚠️ ONE PRIMARY ACTION, NOT TWO COMPETING ONES. The upgrade was a
            gradient button and "Billing details" a second filled button beside
            it, so a card in a sidebar carried two things asking to be pressed.
            Operate mode: the accent belongs to the primary action only.
          */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              href="/dashboard/access?intent=upgrade"
              className="inline-flex h-9 items-center rounded-[var(--radius-md)] bg-accent px-3.5 text-xs font-semibold text-cream transition-colors duration-150 hover:bg-accent-deep"
            >
              {upgradeTarget ? `Upgrade to ${upgradeTarget}` : 'Request a custom plan'}
            </Link>
            <Link
              href="/dashboard/settings/billing"
              className="text-xs font-medium text-muted underline underline-offset-2 transition-colors duration-150 hover:text-ink"
            >
              Billing details
            </Link>
          </div>
        </section>

        <CreditsSummary
          leadsPerCredit={uploadLimits.leadsPerCredit}
          maxFiles={uploadLimits.maxFiles}
        />

        {referral?.code ? (
          <ReferralCard
            link={referralLink(appOrigin(), referral.code)}
            rewarded={referral.rewarded}
            creditsEarned={referral.credits_earned}
          />
        ) : null}
        </div>
      </div>
    </div>
  )
}

function UsageCard({
  label,
  value,
  limit,
  featured = false,
}: {
  label: string
  /** `null` is "unknown", which is not the same fact as `0`. */
  value: number | null
  limit: number | null
  featured?: boolean
}) {
  const unknown = value === null
  const percent =
    !unknown && limit && limit > 0 ? Math.min((value / limit) * 100, 100) : null

  return (
    <article
      className={
        featured
          ? 'product-gradient min-h-36 rounded-[var(--radius-clay)] p-4 text-white shadow-[var(--neo-shadow)]'
          : 'clay min-h-36 p-4'
      }
    >
      <div className="flex items-start justify-between gap-2">
        <p className={featured ? 'text-xs font-medium text-white/84' : 'text-xs font-medium text-muted'}>
          {label}
        </p>
        {/*
          ⚠️ REMOVED, NOT RE-STYLED. This was a decorative ↗ in a 24px circle;
          swapping the glyph for the word "Open" overflowed the circle and,
          worse, labelled a control that never existed — the badge is
          `aria-hidden` and the card is not a link. A card that looks clickable
          and is not is a worse defect than a symbol nobody decodes.
        */}
      </div>
      <p className="mt-4 font-heading text-[30px] font-semibold leading-none tracking-[-0.045em] tabular-nums">
        {unknown ? '—' : value.toLocaleString()}
      </p>
      <div className="mt-4">
        {/*
          ╔═══════════════════════════════════════════════════════════════════╗
          ║  ⚠️ THE BAR IS DRAWN ONLY WHEN THERE IS A PROPORTION TO DRAW.     ║
          ║                                                                   ║
          ║  It used to render `28%` whenever `limit` was null — an UNLIMITED ║
          ║  allowance, where there is no proportion at all. A hardcoded      ║
          ║  fraction of a bar is a picture of a number nobody computed, and  ║
          ║  it sat directly under the words "Unlimited allowance" telling    ║
          ║  the reader they were roughly a quarter of the way through it.    ║
          ║                                                                   ║
          ║  Same class as a sparkline drawn through no data (see             ║
          ║  `Sparkline`): CLAUDE.md rule 4 governs a drawn shape exactly as  ║
          ║  it governs a stored field. Unknown and unlimited now render no   ║
          ║  track, and the sentence below carries the fact on its own.       ║
          ╚═══════════════════════════════════════════════════════════════════╝
        */}
        {percent !== null ? (
          <div className={featured ? 'h-1 overflow-hidden rounded-full bg-white/20' : 'h-1 overflow-hidden rounded-full bg-surface-muted'}>
            <div
              className={featured ? 'h-full rounded-full bg-white' : 'h-full rounded-full bg-accent'}
              /*
               * A 3% floor so a non-zero-but-tiny usage is still visible as a
               * mark rather than rounding away to an empty track — which would
               * read as "none used".
               */
              style={{ width: `${Math.max(percent, 3)}%` }}
            />
          </div>
        ) : null}
        <p className={`text-[11px] ${percent !== null ? 'mt-2' : ''} ${featured ? 'text-white/80' : 'text-muted'}`}>
          {unknown
            ? 'Balance unavailable — refresh to retry'
            : limit === null
              ? 'Unlimited allowance'
              : `${limit.toLocaleString()} included`}
        </p>
      </div>
    </article>
  )
}

/**
 * `value` for plain text, `children` for anything that has to render itself —
 * a date needs the reader's timezone, and only a Client Component knows it.
 * `title` is set only in the string case, because a full-text tooltip for a
 * truncated value is the one thing children cannot provide.
 */
function AccountRow({
  label,
  value,
  children,
}: {
  label: string
  value?: string
  children?: React.ReactNode
}) {
  return (
    <div className="grid gap-1 py-3 first:pt-0 last:pb-0">
      <dt className="text-[11px] font-medium text-muted">{label}</dt>
      <dd className="truncate text-sm font-semibold text-ink" title={value}>
        {children ?? value}
      </dd>
    </div>
  )
}

function nextPlan(key: string | undefined): string | null {
  if (!key || key === 'trial') return 'Lead Engine'
  if (key === 'starter') return 'Professional'
  if (key === 'professional') return 'Agency'
  return null
}
