import 'server-only'

import { createHash, randomBytes } from 'node:crypto'

import { decryptIntegrationSecret, encryptIntegrationSecret } from '@/lib/integrations/crypto'
import { GoogleOAuthError, refreshGoogleToken, type GoogleTokenSet } from '@/lib/integrations/google'
import type { IntegrationConnectionMetadata, IntegrationCredentialEnvelope } from '@/lib/integrations/types'
import { createAdminClient } from '@/lib/supabase/admin'
import type { IntegrationConnectionRow, IntegrationOAuthTransactionRow } from '@/types/database'

const OAUTH_TTL_MS = 10 * 60 * 1000
const REFRESH_SKEW_MS = 60 * 1000
const refreshes = new Map<string, Promise<string>>()

type BrowserBinding = { userId: string; state: string; returnOrigin: string }
type StoredConnection = {
  connectionId: string
  encryptedPayload: string
  tokenExpiresAt: string | null
  scopes: string[]
  credentials: IntegrationCredentialEnvelope
}

function toMetadata(row: IntegrationConnectionRow): IntegrationConnectionMetadata {
  return {
    id: row.id,
    provider: 'google',
    status: row.status,
    externalAccountName: row.external_account_name,
    externalAccountEmail: row.external_account_email,
    scopes: row.scopes,
    connectedAt: row.connected_at,
    lastUsedAt: row.last_used_at,
    lastTestedAt: row.last_tested_at,
    lastError: row.last_error,
  }
}

const hashState = (state: string) => createHash('sha256').update(state).digest('hex')

export function createGoogleOAuthBrowserBinding(binding: BrowserBinding): string {
  return encryptIntegrationSecret(binding)
}

export function readGoogleOAuthBrowserBinding(value: string | undefined): BrowserBinding | null {
  if (!value) return null
  try {
    const binding = decryptIntegrationSecret<BrowserBinding>(value)
    return binding?.userId && binding?.state && binding?.returnOrigin ? binding : null
  } catch {
    return null
  }
}

export async function createGoogleOAuthTransaction(userId: string, redirectUri: string): Promise<string> {
  const admin = createAdminClient()
  const state = randomBytes(32).toString('base64url')
  const now = new Date()
  await admin.from('integration_oauth_transactions').delete().eq('provider', 'google').lt('expires_at', now.toISOString())
  const { error } = await admin.from('integration_oauth_transactions').insert({
    user_id: userId,
    provider: 'google',
    state_hash: hashState(state),
    redirect_uri: redirectUri,
    return_to: '/dashboard/settings#integrations',
    expires_at: new Date(now.getTime() + OAUTH_TTL_MS).toISOString(),
  })
  if (error) throw new Error('Google OAuth state could not be saved.')
  return state
}

export async function consumeGoogleOAuthTransaction(userId: string, state: string): Promise<IntegrationOAuthTransactionRow | null> {
  const { data, error } = await createAdminClient()
    .from('integration_oauth_transactions')
    .delete()
    .eq('user_id', userId)
    .eq('provider', 'google')
    .eq('state_hash', hashState(state))
    .gt('expires_at', new Date().toISOString())
    .select('*')
    .maybeSingle()
  return error ? null : data as IntegrationOAuthTransactionRow | null
}

export async function getGoogleConnectionMetadata(userId: string): Promise<IntegrationConnectionMetadata | null> {
  const { data, error } = await createAdminClient().from('integration_connections').select('*').eq('user_id', userId).eq('provider', 'google').maybeSingle()
  return error || !data ? null : toMetadata(data as IntegrationConnectionRow)
}

async function getStored(userId: string, requireConnected = true): Promise<StoredConnection | null> {
  const admin = createAdminClient()
  const { data: connection } = await admin.from('integration_connections').select('id,secret_reference,status,token_expires_at,scopes').eq('user_id', userId).eq('provider', 'google').maybeSingle()
  if (!connection || (requireConnected && connection.status !== 'connected')) return null
  const { data: secret } = await admin.from('integration_secrets').select('encrypted_payload').eq('connection_id', connection.id).eq('id', connection.secret_reference).maybeSingle()
  if (!secret) return null
  try {
    return {
      connectionId: connection.id,
      encryptedPayload: secret.encrypted_payload,
      tokenExpiresAt: connection.token_expires_at,
      scopes: connection.scopes ?? [],
      credentials: decryptIntegrationSecret<IntegrationCredentialEnvelope>(secret.encrypted_payload),
    }
  } catch {
    return null
  }
}

export async function saveGoogleConnection(userId: string, tokens: GoogleTokenSet): Promise<string> {
  const encryptedPayload = encryptIntegrationSecret({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenType: tokens.tokenType,
  } satisfies IntegrationCredentialEnvelope)
  const admin = createAdminClient()
  const { data: connection, error } = await admin.from('integration_connections').upsert({
    user_id: userId,
    provider: 'google',
    status: 'connected',
    external_account_id: tokens.accountId,
    external_account_name: tokens.accountEmail,
    external_account_email: tokens.accountEmail,
    scopes: tokens.scopes,
    token_expires_at: tokens.expiresAt,
    connected_at: new Date().toISOString(),
    last_tested_at: new Date().toISOString(),
    last_error: null,
  }, { onConflict: 'user_id,provider' }).select('id,secret_reference').single()
  if (error || !connection) throw new Error('Google connection could not be saved.')
  const { error: secretError } = await admin.from('integration_secrets').upsert({
    id: connection.secret_reference,
    connection_id: connection.id,
    encrypted_payload: encryptedPayload,
  }, { onConflict: 'connection_id' })
  if (secretError) throw new Error('Google connection could not be saved.')
  return connection.id
}

async function refreshAccessToken(userId: string): Promise<string> {
  const stored = await getStored(userId)
  if (!stored?.credentials.refreshToken) throw new GoogleOAuthError('Reconnect Google to continue.', true)
  const refreshed = await refreshGoogleToken(stored.credentials.refreshToken)
  const encryptedPayload = encryptIntegrationSecret({
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    tokenType: refreshed.tokenType,
  } satisfies IntegrationCredentialEnvelope)
  const admin = createAdminClient()
  const { data, error } = await admin.from('integration_secrets')
    .update({ encrypted_payload: encryptedPayload })
    .eq('connection_id', stored.connectionId)
    .eq('encrypted_payload', stored.encryptedPayload)
    .select('connection_id')
    .maybeSingle()
  if (error) throw new Error('The refreshed Google token could not be saved.')
  if (data) {
    await admin.from('integration_connections').update({
      token_expires_at: refreshed.expiresAt,
      scopes: refreshed.scopes.length ? refreshed.scopes : stored.scopes,
      last_used_at: new Date().toISOString(),
      last_error: null,
    }).eq('id', stored.connectionId).eq('user_id', userId).eq('provider', 'google')
    return refreshed.accessToken
  }
  const latest = await getStored(userId)
  if (latest?.credentials.accessToken) return latest.credentials.accessToken
  throw new Error('Google token refresh conflicted. Please try again.')
}

export async function getGoogleAccessToken(userId: string): Promise<string> {
  const stored = await getStored(userId)
  if (!stored?.credentials.accessToken) throw new GoogleOAuthError('Connect Google before exporting leads.', true)
  if ((stored.tokenExpiresAt ? Date.parse(stored.tokenExpiresAt) : 0) > Date.now() + REFRESH_SKEW_MS) return stored.credentials.accessToken
  const existing = refreshes.get(userId)
  if (existing) return existing
  const pending = refreshAccessToken(userId).catch(async (error) => {
    if (error instanceof GoogleOAuthError && error.reconnectRequired) await markGoogleReconnectRequired(userId)
    throw error
  }).finally(() => refreshes.delete(userId))
  refreshes.set(userId, pending)
  return pending
}

export async function getGoogleRefreshToken(userId: string): Promise<string | null> {
  return (await getStored(userId, false))?.credentials.refreshToken ?? null
}

export async function markGoogleReconnectRequired(userId: string): Promise<void> {
  await createAdminClient().from('integration_connections').update({ status: 'reconnect_required', last_error: 'Google authorization expired. Reconnect Google.' }).eq('user_id', userId).eq('provider', 'google')
}

export async function markGoogleConnectionUsed(userId: string): Promise<void> {
  await createAdminClient().from('integration_connections').update({ last_used_at: new Date().toISOString(), last_error: null }).eq('user_id', userId).eq('provider', 'google')
}

export async function disconnectGoogleConnection(userId: string): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc('disconnect_integration', { p_user_id: userId, p_provider: 'google' })
  if (error) throw new Error('Google connection could not be disconnected.')
  return data === true
}
