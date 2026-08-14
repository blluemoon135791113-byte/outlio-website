import 'server-only'

import { createHash, randomBytes } from 'node:crypto'

import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from '@/lib/integrations/crypto'
import {
  HubSpotOAuthError,
  refreshHubSpotToken,
  type HubSpotTokenSet,
} from '@/lib/integrations/hubspot'
import type {
  IntegrationConnectionMetadata,
  IntegrationCredentialEnvelope,
} from '@/lib/integrations/types'
import { createAdminClient } from '@/lib/supabase/admin'
import type {
  IntegrationConnectionRow,
  IntegrationOAuthTransactionRow,
} from '@/types/database'

const OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1000
const TOKEN_REFRESH_SKEW_MS = 60 * 1000
const refreshes = new Map<string, Promise<string>>()

type StoredHubSpotConnection = {
  connectionId: string
  encryptedPayload: string
  tokenExpiresAt: string | null
  scopes: string[]
  credentials: IntegrationCredentialEnvelope
}

type HubSpotOAuthBrowserBinding = {
  userId: string
  state: string
  returnOrigin: string
}

function toMetadata(row: IntegrationConnectionRow): IntegrationConnectionMetadata {
  return {
    id: row.id,
    provider: 'hubspot',
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

export function hashHubSpotOAuthState(state: string): string {
  return createHash('sha256').update(state).digest('hex')
}

export function createHubSpotOAuthBrowserBinding(
  binding: HubSpotOAuthBrowserBinding,
): string {
  return encryptIntegrationSecret(binding)
}

export function readHubSpotOAuthBrowserBinding(
  value: string | undefined,
): HubSpotOAuthBrowserBinding | null {
  if (!value) return null
  try {
    const binding = decryptIntegrationSecret<HubSpotOAuthBrowserBinding>(value)
    if (
      !binding ||
      typeof binding.userId !== 'string' ||
      typeof binding.state !== 'string' ||
      typeof binding.returnOrigin !== 'string'
    ) return null
    return binding
  } catch {
    return null
  }
}

export async function createHubSpotOAuthTransaction(
  userId: string,
  redirectUri: string,
): Promise<string> {
  const admin = createAdminClient()
  const state = randomBytes(32).toString('base64url')
  const now = new Date()

  await admin
    .from('integration_oauth_transactions')
    .delete()
    .eq('provider', 'hubspot')
    .lt('expires_at', now.toISOString())

  const { error } = await admin.from('integration_oauth_transactions').insert({
    user_id: userId,
    provider: 'hubspot',
    state_hash: hashHubSpotOAuthState(state),
    encrypted_code_verifier: null,
    redirect_uri: redirectUri,
    return_to: '/dashboard/settings#integrations',
    expires_at: new Date(now.getTime() + OAUTH_TRANSACTION_TTL_MS).toISOString(),
  })

  if (error) throw new Error('HubSpot OAuth state could not be saved.')
  return state
}

/** Atomically consumes a one-time state and binds it to the active Supabase user. */
export async function consumeHubSpotOAuthTransaction(
  userId: string,
  state: string,
): Promise<IntegrationOAuthTransactionRow | null> {
  const { data, error } = await createAdminClient()
    .from('integration_oauth_transactions')
    .delete()
    .eq('user_id', userId)
    .eq('provider', 'hubspot')
    .eq('state_hash', hashHubSpotOAuthState(state))
    .gt('expires_at', new Date().toISOString())
    .select('*')
    .maybeSingle()

  if (error) return null
  return (data as IntegrationOAuthTransactionRow | null) ?? null
}

export async function getHubSpotConnectionMetadata(
  userId: string,
): Promise<IntegrationConnectionMetadata | null> {
  const { data, error } = await createAdminClient()
    .from('integration_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'hubspot')
    .maybeSingle()

  if (error) return null
  return data ? toMetadata(data as IntegrationConnectionRow) : null
}

async function getStoredHubSpotConnection(
  userId: string,
  requireConnected = true,
): Promise<StoredHubSpotConnection | null> {
  const admin = createAdminClient()
  const { data: connection, error: connectionError } = await admin
    .from('integration_connections')
    .select('id, secret_reference, status, token_expires_at, scopes')
    .eq('user_id', userId)
    .eq('provider', 'hubspot')
    .maybeSingle()

  if (
    connectionError ||
    !connection ||
    (requireConnected && connection.status !== 'connected')
  ) return null

  const { data: secret, error: secretError } = await admin
    .from('integration_secrets')
    .select('encrypted_payload')
    .eq('connection_id', connection.id)
    .eq('id', connection.secret_reference)
    .maybeSingle()

  if (secretError || !secret) return null
  return {
    connectionId: connection.id,
    encryptedPayload: secret.encrypted_payload,
    tokenExpiresAt: connection.token_expires_at,
    scopes: connection.scopes,
    credentials: decryptIntegrationSecret<IntegrationCredentialEnvelope>(secret.encrypted_payload),
  }
}

export async function saveHubSpotConnection(
  userId: string,
  tokens: HubSpotTokenSet,
): Promise<string> {
  const encryptedPayload = encryptIntegrationSecret({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenType: tokens.tokenType,
  } satisfies IntegrationCredentialEnvelope)
  const accountName = `HubSpot account ${tokens.accountId}`
  const { data, error } = await createAdminClient().rpc('save_hubspot_connection', {
    p_user_id: userId,
    p_encrypted_payload: encryptedPayload,
    p_external_account_id: tokens.accountId!,
    p_external_account_name: accountName,
    p_scopes: tokens.scopes,
    p_token_expires_at: tokens.expiresAt,
  })

  if (error || typeof data !== 'string') {
    throw new Error('HubSpot connection could not be saved.')
  }
  return data
}

async function refreshAccessToken(userId: string): Promise<string> {
  const stored = await getStoredHubSpotConnection(userId)
  if (!stored?.credentials.refreshToken) {
    throw new HubSpotOAuthError('Reconnect HubSpot to continue.', true)
  }

  const refreshed = await refreshHubSpotToken(stored.credentials.refreshToken)
  const scopes = refreshed.scopes.length > 0 ? refreshed.scopes : stored.scopes
  const encryptedPayload = encryptIntegrationSecret({
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    tokenType: refreshed.tokenType,
  } satisfies IntegrationCredentialEnvelope)
  const { data: updated, error } = await createAdminClient().rpc('update_hubspot_tokens', {
    p_user_id: userId,
    p_connection_id: stored.connectionId,
    p_expected_encrypted_payload: stored.encryptedPayload,
    p_encrypted_payload: encryptedPayload,
    p_scopes: scopes,
    p_token_expires_at: refreshed.expiresAt,
  })

  if (error) throw new Error('The refreshed HubSpot token could not be saved.')
  if (updated === true) return refreshed.accessToken

  // Another request refreshed this tenant's connection first. Use its result.
  const latest = await getStoredHubSpotConnection(userId)
  if (latest?.credentials.accessToken) return latest.credentials.accessToken
  throw new Error('HubSpot token refresh conflicted. Please try again.')
}

/** Returns only the current tenant's token and refreshes it before expiry. */
export async function getHubSpotAccessToken(userId: string): Promise<string> {
  const stored = await getStoredHubSpotConnection(userId)
  if (!stored?.credentials.accessToken) {
    throw new HubSpotOAuthError('Connect HubSpot before exporting leads.', true)
  }

  const expiresAt = stored.tokenExpiresAt ? Date.parse(stored.tokenExpiresAt) : 0
  if (expiresAt > Date.now() + TOKEN_REFRESH_SKEW_MS) {
    return stored.credentials.accessToken
  }

  const existing = refreshes.get(userId)
  if (existing) return existing

  const pending = refreshAccessToken(userId).catch(async (error: unknown) => {
    if (error instanceof HubSpotOAuthError && error.reconnectRequired) {
      await markHubSpotReconnectRequired(userId)
    }
    throw error
  }).finally(() => {
    refreshes.delete(userId)
  })
  refreshes.set(userId, pending)
  return pending
}

export async function getHubSpotRefreshToken(userId: string): Promise<string | null> {
  const stored = await getStoredHubSpotConnection(userId, false)
  return stored?.credentials.refreshToken ?? null
}

export async function markHubSpotReconnectRequired(userId: string): Promise<void> {
  await createAdminClient()
    .from('integration_connections')
    .update({
      status: 'reconnect_required',
      last_error: 'HubSpot authorization expired. Reconnect HubSpot.',
    })
    .eq('user_id', userId)
    .eq('provider', 'hubspot')
}

export async function markHubSpotConnectionUsed(userId: string): Promise<void> {
  await createAdminClient()
    .from('integration_connections')
    .update({ last_used_at: new Date().toISOString(), last_error: null })
    .eq('user_id', userId)
    .eq('provider', 'hubspot')
}

export async function disconnectHubSpotConnection(userId: string): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc('disconnect_integration', {
    p_user_id: userId,
    p_provider: 'hubspot',
  })
  if (error) throw new Error('HubSpot connection could not be disconnected.')
  return data === true
}
