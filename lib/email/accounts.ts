import 'server-only'

/**
 * Sending-account storage — M5 Phase 11.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE SECRET NEVER ENTERS THE ACCOUNT TYPE.                                ║
 * ║                                                                           ║
 * ║  `EmailAccount` has no field that could hold a credential, so no reader,  ║
 * ║  logger or serializer can leak one by accident. Credentials are fetched   ║
 * ║  by exactly one function — `readAccountSecret` — which is called only by  ║
 * ║  a provider adapter on the send path. That is M5 acceptance criterion 1   ║
 * ║  held in TypeScript as well as in Postgres.                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ THE SERVICE ROLE BYPASSES RLS, so every query here scopes by
 * `workspace_id` in code (CLAUDE.md). The policy on the table is the second
 * layer, not the only one.
 */
import { decryptIntegrationSecret, encryptIntegrationSecret } from '@/lib/integrations/crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  capabilitiesFor,
  type EmailAccountConfiguration,
  type EmailCapabilities,
  type EmailProviderId,
} from '@/lib/email/capabilities'

export type EmailAccountScope = 'personal' | 'workspace'

export type EmailAccountStatus =
  | 'not_configured'
  | 'authentication_required'
  | 'ramping'
  | 'ready'
  | 'warning'
  | 'throttled'
  | 'paused'
  | 'disconnected'
  | 'error'

/**
 * An account as the app sees it.
 *
 * ⚠️ NO CREDENTIAL FIELD EXISTS HERE, AND NONE MAY BE ADDED. `secretReference`
 * is a pointer, not a secret — it is useless without service-role access to
 * `email_account_secrets`.
 */
export type EmailAccount = {
  id: string
  workspaceId: string
  provider: EmailProviderId
  scope: EmailAccountScope
  ownerUserId: string
  displayName: string
  fromEmail: string
  fromName: string | null
  replyToEmail: string | null
  fromDomain: string
  status: EmailAccountStatus
  configuration: EmailAccountConfiguration
  dailySendLimit: number | null
  hourlySendLimit: number | null
  minDelaySeconds: number
  timezone: string
  sendWindowStart: string
  sendWindowEnd: string
  sendDays: number[]
  healthScore: number | null
  healthCheckedAt: string | null
  // Gradual volume increase (Phase 13). The honest alternative to a warmup
  // network: start low, climb slowly, watch real bounce and complaint rates.
  rampEnabled: boolean
  rampStartedOn: string | null
  rampInitialDaily: number
  rampDailyIncrement: number
  rampTargetDaily: number
  lastSyncAt: string | null
  lastSendAt: string | null
  lastError: string | null
  connectedAt: string | null
  secretReference: string
  capabilities: EmailCapabilities
}

/**
 * ⚠️ ONE LITERAL STRING, NEVER CONCATENATED. supabase-js parses the select list
 * at the TYPE level; building it from variables degrades every column to
 * `GenericStringError` and the whole row becomes untyped. Learned the hard way
 * earlier in this build.
 *
 * `encrypted_payload` is absent because it lives in another table entirely —
 * there is no join here that could pull it in.
 */
const ACCOUNT_COLUMNS =
  'id, workspace_id, provider, scope, owner_user_id, display_name, from_email, from_name, reply_to_email, from_domain, status, configuration, daily_send_limit, hourly_send_limit, min_delay_seconds, timezone, send_window_start, send_window_end, send_days, health_score, health_checked_at, last_sync_at, last_send_at, last_error, connected_at, secret_reference, ramp_enabled, ramp_started_on, ramp_initial_daily, ramp_daily_increment, ramp_target_daily'

type AccountRow = {
  id: string
  workspace_id: string
  provider: EmailProviderId
  scope: EmailAccountScope
  owner_user_id: string
  display_name: string
  from_email: string
  from_name: string | null
  reply_to_email: string | null
  from_domain: string
  status: EmailAccountStatus
  configuration: EmailAccountConfiguration | null
  daily_send_limit: number | null
  hourly_send_limit: number | null
  min_delay_seconds: number
  timezone: string
  send_window_start: string
  send_window_end: string
  send_days: number[] | null
  health_score: number | null
  health_checked_at: string | null
  ramp_enabled: boolean
  ramp_started_on: string | null
  ramp_initial_daily: number
  ramp_daily_increment: number
  ramp_target_daily: number
  last_sync_at: string | null
  last_send_at: string | null
  last_error: string | null
  connected_at: string | null
  secret_reference: string
}

function toAccount(row: AccountRow): EmailAccount {
  const configuration = row.configuration ?? {}
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    scope: row.scope,
    ownerUserId: row.owner_user_id,
    displayName: row.display_name,
    fromEmail: row.from_email,
    fromName: row.from_name,
    replyToEmail: row.reply_to_email,
    fromDomain: row.from_domain,
    status: row.status,
    configuration,
    dailySendLimit: row.daily_send_limit,
    hourlySendLimit: row.hourly_send_limit,
    minDelaySeconds: row.min_delay_seconds,
    timezone: row.timezone,
    sendWindowStart: row.send_window_start,
    sendWindowEnd: row.send_window_end,
    sendDays: row.send_days ?? [],
    healthScore: row.health_score,
    healthCheckedAt: row.health_checked_at,
    rampEnabled: row.ramp_enabled,
    rampStartedOn: row.ramp_started_on,
    rampInitialDaily: row.ramp_initial_daily,
    rampDailyIncrement: row.ramp_daily_increment,
    rampTargetDaily: row.ramp_target_daily,
    lastSyncAt: row.last_sync_at,
    lastSendAt: row.last_send_at,
    lastError: row.last_error,
    connectedAt: row.connected_at,
    secretReference: row.secret_reference,
    // Derived, never stored — a stored capability set goes stale the moment
    // someone adds IMAP settings.
    capabilities: capabilitiesFor(row.provider, configuration),
  }
}

/**
 * The address, lowercased, and its domain.
 *
 * ⚠️ SPLITS ON THE LAST `@`, not the first. Quoted local parts may legally
 * contain one — `"a@b"@example.com` is a valid address — and splitting on the
 * first would file that mailbox under the domain `b"@example.com`, quietly
 * corrupting the per-domain health rollup.
 */
export function normalizeSendingAddress(input: string): { email: string; domain: string } | null {
  const email = input.trim().toLowerCase()
  const at = email.lastIndexOf('@')
  if (at <= 0 || at === email.length - 1) return null

  const domain = email.slice(at + 1)
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return null

  return { email, domain }
}

/** Every live account in a workspace. RLS narrows this further for the caller. */
export async function listEmailAccounts(workspaceId: string): Promise<EmailAccount[]> {
  const { data, error } = await createAdminClient()
    .from('email_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`listEmailAccounts failed: ${error.message}`)
  return (data as AccountRow[]).map(toAccount)
}

export async function getEmailAccount(
  workspaceId: string,
  accountId: string,
): Promise<EmailAccount | null> {
  const { data, error } = await createAdminClient()
    .from('email_accounts')
    .select(ACCOUNT_COLUMNS)
    // ⚠️ Scoped by workspace as well as id: the service role would otherwise
    // happily return another tenant's mailbox for a guessed uuid.
    .eq('workspace_id', workspaceId)
    .eq('id', accountId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw new Error(`getEmailAccount failed: ${error.message}`)
  return data ? toAccount(data as AccountRow) : null
}

export type CreateEmailAccountInput = {
  workspaceId: string
  provider: EmailProviderId
  scope: EmailAccountScope
  ownerUserId: string
  displayName: string
  fromEmail: string
  fromName?: string | null
  replyToEmail?: string | null
  configuration?: EmailAccountConfiguration
  /** Encrypted before it touches the database. Never logged. */
  secret: unknown
}

export class InvalidSendingAddressError extends Error {}

/**
 * Creates an account and stores its credentials.
 *
 * ⚠️ A NEW MAILBOX IS `ramping`, NEVER `ready`. `ready` is a claim that
 * readiness checks passed, and in Phase 11 none have run. More importantly a
 * brand-new mailbox that starts sending at full volume is precisely how a
 * domain gets burned — so the conservative state is also the correct one.
 * Phase 13 promotes it.
 */
export async function createEmailAccount(input: CreateEmailAccountInput): Promise<EmailAccount> {
  const address = normalizeSendingAddress(input.fromEmail)
  if (!address) {
    throw new InvalidSendingAddressError(
      `"${input.fromEmail}" is not an email address Outlio can send from.`,
    )
  }

  const replyTo = input.replyToEmail ? normalizeSendingAddress(input.replyToEmail) : null
  if (input.replyToEmail && !replyTo) {
    throw new InvalidSendingAddressError(
      `"${input.replyToEmail}" is not a valid reply-to address.`,
    )
  }

  const db = createAdminClient()

  const { data, error } = await db
    .from('email_accounts')
    .insert({
      workspace_id: input.workspaceId,
      provider: input.provider,
      scope: input.scope,
      owner_user_id: input.ownerUserId,
      display_name: input.displayName.trim(),
      from_email: address.email,
      from_name: input.fromName?.trim() || null,
      reply_to_email: replyTo?.email ?? null,
      from_domain: address.domain,
      status: 'ramping',
      configuration: input.configuration ?? {},
      connected_at: new Date().toISOString(),
      // ⚠️ The ramp starts the day the mailbox connects. Leaving it null would
      // pin the account to its opening allowance forever, since day zero would
      // never arrive.
      ramp_started_on: new Date().toISOString().slice(0, 10),
    })
    .select(ACCOUNT_COLUMNS)
    .single()

  if (error) throw new Error(`createEmailAccount failed: ${error.message}`)
  const row = data as AccountRow

  const { error: secretError } = await db.from('email_account_secrets').insert({
    id: row.secret_reference,
    account_id: row.id,
    encrypted_payload: encryptIntegrationSecret(input.secret),
  })

  if (secretError) {
    /*
     * ⚠️ AN ACCOUNT WITHOUT CREDENTIALS IS WORSE THAN NO ACCOUNT — it appears
     * in the mailbox list and fails on first send. Postgres has no transaction
     * across two PostgREST calls, so the account is removed explicitly.
     */
    await db.from('email_accounts').delete().eq('id', row.id)
    throw new Error(`createEmailAccount failed to store credentials: ${secretError.message}`)
  }

  return toAccount(row)
}

/**
 * Reads and decrypts an account's credentials.
 *
 * ⚠️ THE ONLY FUNCTION THAT RETURNS A CREDENTIAL. Call it from a provider
 * adapter on the send or sync path and nowhere else. Never log the result,
 * never put it in an error message, never return it from a route handler.
 */
export async function readAccountSecret<T>(accountId: string, secretReference: string): Promise<T> {
  const { data, error } = await createAdminClient()
    .from('email_account_secrets')
    .select('encrypted_payload')
    .eq('account_id', accountId)
    .eq('id', secretReference)
    .maybeSingle()

  // The message deliberately names neither the account nor the reference.
  if (error) throw new Error('Could not read the credentials for this sending account.')
  if (!data) throw new Error('This sending account has no stored credentials.')

  return decryptIntegrationSecret<T>(data.encrypted_payload)
}

/** Replaces stored credentials, as a token refresh or a password change does. */
export async function writeAccountSecret(
  accountId: string,
  secretReference: string,
  secret: unknown,
): Promise<void> {
  const { error } = await createAdminClient()
    .from('email_account_secrets')
    .update({ encrypted_payload: encryptIntegrationSecret(secret) })
    .eq('account_id', accountId)
    .eq('id', secretReference)

  if (error) throw new Error('Could not update the credentials for this sending account.')
}

/**
 * Disconnects an account.
 *
 * ⚠️ SOFT DELETE ON THE ACCOUNT, HARD DELETE ON THE SECRET. Sent mail must
 * keep pointing at the mailbox that sent it, so the row survives — but there
 * is no reason on earth to keep a credential for a mailbox nobody is using.
 */
export async function disconnectEmailAccount(
  workspaceId: string,
  accountId: string,
): Promise<void> {
  const db = createAdminClient()

  const { data, error } = await db
    .from('email_accounts')
    .update({ status: 'disconnected', deleted_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('id', accountId)
    .is('deleted_at', null)
    .select('id, secret_reference')
    .maybeSingle()

  if (error) throw new Error(`disconnectEmailAccount failed: ${error.message}`)
  if (!data) return

  await db.from('email_account_secrets').delete().eq('account_id', data.id)
}
