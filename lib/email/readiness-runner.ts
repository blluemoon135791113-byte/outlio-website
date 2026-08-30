import 'server-only'

/**
 * Running a readiness assessment — M5 Phase 13.
 *
 * The scoring itself is pure and lives in `readiness.ts`. This file gathers
 * the inputs — DNS, connection test, real send volume — and records the
 * result.
 */
import { getEmailAccount, type EmailAccount } from '@/lib/email/accounts'
import { checkDomainAuth, isAligned, type DomainAuthResult } from '@/lib/email/dns'
import { providerFor } from '@/lib/email/providers/registry'
import { capabilitiesFor } from '@/lib/email/capabilities'
import { dailyAllowance, isRamping, type RampSettings } from '@/lib/email/ramp'
import {
  assessReadiness,
  canSendFrom,
  type ReadinessResult,
} from '@/lib/email/readiness'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * ⚠️ DNS RESULTS ARE CACHED PER DOMAIN, NOT PER MAILBOX. SPF, DKIM and DMARC
 * are domain properties — twenty mailboxes on one domain share one answer, and
 * re-resolving per mailbox would be twenty times the lookups for identical
 * results.
 *
 * Six hours is short enough that a customer who has just fixed their SPF sees
 * it within a working morning, and long enough that a routine assessment sweep
 * is not a DNS flood.
 */
const DOMAIN_CACHE_HOURS = 6

export function rampSettingsOf(account: {
  rampEnabled: boolean
  rampStartedOn: string | null
  rampInitialDaily: number
  rampDailyIncrement: number
  rampTargetDaily: number
  dailySendLimit: number | null
}): RampSettings {
  return {
    enabled: account.rampEnabled,
    startedOn: account.rampStartedOn,
    initialDaily: account.rampInitialDaily,
    dailyIncrement: account.rampDailyIncrement,
    targetDaily: account.rampTargetDaily,
    configuredDailyLimit: account.dailySendLimit,
  }
}

/** Today's date in the mailbox's own zone, as YYYY-MM-DD. */
export function todayIn(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

/** Cached domain authentication, refreshed when stale. */
export async function getDomainAuth(
  workspaceId: string,
  domain: string,
  force = false,
): Promise<DomainAuthResult> {
  const db = createAdminClient()

  const { data: cached } = await db
    .from('email_domain_checks')
    .select(
      'domain, spf_status, spf_record, spf_detail, dkim_status, dkim_selector, dkim_detail, dmarc_status, dmarc_policy, dmarc_record, dmarc_detail, checked_at',
    )
    .eq('workspace_id', workspaceId)
    .eq('domain', domain)
    .maybeSingle()

  const fresh =
    cached &&
    Date.now() - new Date(cached.checked_at).getTime() < DOMAIN_CACHE_HOURS * 3_600_000

  if (cached && fresh && !force) {
    return {
      domain: cached.domain,
      spf: {
        status: cached.spf_status,
        detail: cached.spf_detail ?? '',
        record: cached.spf_record ?? undefined,
      },
      dkim: {
        status: cached.dkim_status,
        detail: cached.dkim_detail ?? '',
        selector: cached.dkim_selector ?? undefined,
      },
      dmarc: {
        status: cached.dmarc_status,
        detail: cached.dmarc_detail ?? '',
        policy: cached.dmarc_policy ?? undefined,
        record: cached.dmarc_record ?? undefined,
      },
    }
  }

  const result = await checkDomainAuth(domain)

  await db.from('email_domain_checks').upsert(
    {
      workspace_id: workspaceId,
      domain: result.domain,
      spf_status: result.spf.status,
      spf_record: result.spf.record ?? null,
      spf_detail: result.spf.detail,
      dkim_status: result.dkim.status,
      dkim_selector: result.dkim.selector ?? null,
      dkim_detail: result.dkim.detail,
      dmarc_status: result.dmarc.status,
      dmarc_policy: result.dmarc.policy ?? null,
      dmarc_record: result.dmarc.record ?? null,
      dmarc_detail: result.dmarc.detail,
      checked_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id,domain' },
  )

  return result
}

/**
 * Assesses one mailbox and records the result.
 *
 * ⚠️ THE ASSESSMENT IS RECORDED EVEN WHEN IT IS BAD — especially then. A
 * health system that only writes rows when things look fine cannot answer
 * "when did this start?", which is the first question anyone asks.
 */
export async function assessAccount(
  workspaceId: string,
  accountId: string,
  options: { forceDns?: boolean } = {},
): Promise<(ReadinessResult & { accountId: string; dailyLimit: number }) | null> {
  const db = createAdminClient()
  const account = await getEmailAccount(workspaceId, accountId)
  if (!account) return null

  const domain = await getDomainAuth(workspaceId, account.fromDomain, options.forceDns)

  // Connection: only meaningful for a provider we can actually drive.
  const provider = providerFor(account.provider)
  let connectionOk = false
  let connectionDetail: string | undefined
  let authenticationFailed = false

  if (provider) {
    const test = await provider.testConnection({
      id: account.id,
      workspaceId: account.workspaceId,
      provider: account.provider,
      fromEmail: account.fromEmail,
      fromName: account.fromName,
      configuration: account.configuration,
      secretReference: account.secretReference,
    })
    connectionOk = test.ok
    if (!test.ok) {
      connectionDetail = test.message
      authenticationFailed = test.reconnectRequired
    }
  } else {
    connectionDetail = `Outlio cannot connect ${account.provider} mailboxes yet.`
  }

  const { data: volume } = await db.rpc('email_account_volume', {
    p_account_id: accountId,
    p_since: new Date(Date.now() - 7 * 86_400_000).toISOString(),
  })
  const v = volume?.[0]

  const { data: sent24hRows } = await db.rpc('email_account_volume', {
    p_account_id: accountId,
    p_since: new Date(Date.now() - 86_400_000).toISOString(),
  })

  const ramp = rampSettingsOf(account)
  const today = todayIn(account.timezone)

  const result = assessReadiness({
    accountStatus:
      account.status === 'disconnected'
        ? 'disconnected'
        : account.status === 'paused'
          ? 'paused'
          : account.status === 'not_configured'
            ? 'not_configured'
            : 'connected',
    connectionOk,
    connectionDetail,
    authenticationFailed,
    domain,
    fromDomainAligned: isAligned(account.fromDomain, domain.domain),
    listUnsubscribeCapable:
      capabilitiesFor(account.provider, account.configuration).listUnsubscribe === 'supported',
    sent24h: Number(sent24hRows?.[0]?.sent ?? 0),
    sent7d: Number(v?.sent ?? 0),
    bounced: Number(v?.bounced ?? 0),
    complained: Number(v?.complained ?? 0),
    rampInProgress: isRamping(ramp, today),
  })

  const limit = dailyAllowance(ramp, today)

  await db.from('email_readiness_checks').insert({
    workspace_id: workspaceId,
    account_id: accountId,
    state: result.state,
    score: result.score,
    checks: result.checks,
    sent_24h: Number(sent24hRows?.[0]?.sent ?? 0),
    sent_7d: Number(v?.sent ?? 0),
    bounce_rate: result.bounceRate,
    complaint_rate: result.complaintRate,
    daily_limit: limit,
  })

  /*
   * ⚠️ THE ACCOUNT'S OWN STATUS FOLLOWS THE ASSESSMENT, except for states the
   * assessment does not own. `disconnected` and `paused` are decisions a
   * PERSON made; overwriting them with a computed state would silently
   * un-pause a mailbox someone deliberately stopped.
   */
  if (account.status !== 'disconnected' && account.status !== 'paused') {
    await db
      .from('email_accounts')
      .update({
        status: result.state,
        health_score: result.score,
        health_checked_at: new Date().toISOString(),
      })
      .eq('id', accountId)
  }

  return { ...result, accountId, dailyLimit: limit }
}

/** Assesses every live mailbox in a workspace. */
export async function assessWorkspace(workspaceId: string): Promise<number> {
  const { data } = await createAdminClient()
    .from('email_accounts')
    .select('id')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)

  let assessed = 0
  for (const row of data ?? []) {
    // Sequential on purpose: a parallel sweep would open every mailbox's SMTP
    // connection at once, which looks like exactly the abuse we are avoiding.
    await assessAccount(workspaceId, row.id)
    assessed += 1
  }
  return assessed
}

export type DomainHealthRow = {
  domain: string
  mailboxes: number
  ready: number
  blocked: number
  worstScore: number
  averageScore: number
  worstState: string
}

/** Per-domain rollup, worst domain first. */
export async function getDomainHealth(workspaceId: string): Promise<DomainHealthRow[]> {
  const { data, error } = await createAdminClient().rpc('email_domain_health', {
    p_workspace_id: workspaceId,
  })

  if (error) throw new Error(`getDomainHealth failed: ${error.message}`)

  return (data ?? []).map((r) => ({
    domain: r.domain,
    mailboxes: Number(r.mailboxes),
    ready: Number(r.ready),
    blocked: Number(r.blocked),
    worstScore: Number(r.worst_score),
    averageScore: Number(r.average_score),
    worstState: r.worst_state,
  }))
}

/**
 * The campaign safety gate.
 *
 * ⚠️ READS THE LATEST RECORDED ASSESSMENT RATHER THAN RE-RUNNING ONE. A gate
 * that performs DNS lookups and an SMTP handshake per recipient would make a
 * thousand-contact campaign unusable, and would hammer the provider with
 * connection attempts that look like abuse.
 */
export async function isAccountSendable(
  workspaceId: string,
  accountId: string,
): Promise<{ sendable: boolean; reason: string | null }> {
  const db = createAdminClient()

  const { data } = await db
    .from('email_readiness_checks')
    .select('state, checks')
    .eq('workspace_id', workspaceId)
    .eq('account_id', accountId)
    .order('checked_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  /*
   * ⚠️ NEVER ASSESSED IS NOT A BLOCK. Refusing to send from a mailbox that has
   * simply not been swept yet would make the first campaign after connecting
   * an account fail for a reason the customer cannot act on. The account's own
   * status still gates it, and the sweep will catch up.
   */
  if (!data) return { sendable: true, reason: null }

  const blocking: Record<string, string> = {
    disconnected: 'This mailbox is disconnected.',
    not_configured: 'This mailbox is not set up yet.',
    paused: 'Sending from this mailbox is paused.',
    authentication_required: 'Outlio can no longer sign in to this mailbox. Reconnect it.',
    error: 'Outlio cannot reach this mailbox.',
    throttled: 'The provider is rate-limiting this mailbox.',
  }

  if (blocking[data.state]) return { sendable: false, reason: blocking[data.state]! }

  /*
   * `warning` is ambiguous by design: it covers both "above the warning line"
   * (keep sending) and "past the complaint gate" (stop). The recorded checks
   * say which, so the gate re-derives it rather than storing a second flag
   * that could drift out of step with the state.
   */
  if (data.state === 'warning') {
    const checks = (data.checks ?? []) as { id: string; status: string }[]
    const failed = checks.find(
      (c) => (c.id === 'complaint_rate' || c.id === 'bounce_rate') && c.status === 'fail',
    )
    if (failed) {
      return {
        sendable: false,
        reason:
          failed.id === 'complaint_rate'
            ? 'Too many recipients marked this mailbox’s mail as spam. Sending is stopped to protect the domain.'
            : 'Too many addresses from this mailbox bounced. Clean the list before sending more.',
      }
    }
  }

  return { sendable: true, reason: null }
}

export { canSendFrom }
export type { EmailAccount }
