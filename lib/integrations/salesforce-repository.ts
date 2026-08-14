import 'server-only'

import { createHash, randomBytes } from 'node:crypto'

import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from '@/lib/integrations/crypto'
import {
  refreshSalesforceToken,
  SalesforceOAuthError,
  type SalesforceTokenSet,
} from '@/lib/integrations/salesforce'
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
const refreshes = new Map<string, Promise<SalesforceAccessContext>>()

type SalesforceOAuthBrowserBinding = {
  userId: string
  state: string
  returnOrigin: string
}

type StoredSalesforceConnection = {
  connectionId: string
  encryptedPayload: string
  tokenExpiresAt: string | null
  scopes: string[]
  credentials: IntegrationCredentialEnvelope
}

export type SalesforceAccessContext = {
  accessToken: string
  instanceUrl: string
}

function toMetadata(row: IntegrationConnectionRow): IntegrationConnectionMetadata {
  return {
    id: row.id,
    provider: 'salesforce',
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

export function hashSalesforceOAuthState(state: string): string {
  return createHash('sha256').update(state).digest('hex')
}

export function createSalesforceOAuthBrowserBinding(
  binding: SalesforceOAuthBrowserBinding,
): string {
  return encryptIntegrationSecret(binding)
}

export function readSalesforceOAuthBrowserBinding(
  value: string | undefined,
): SalesforceOAuthBrowserBinding | null {
  if (!value) return null
  try {
    const binding = decryptIntegrationSecret<SalesforceOAuthBrowserBinding>(value)
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

export async function createSalesforceOAuthTransaction(
  userId: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<string> {
  const admin = createAdminClient()
  const state = randomBytes(32).toString('base64url')
  const now = new Date()

  await admin
    .from('integration_oauth_transactions')
    .delete()
    .eq('provider', 'salesforce')
    .lt('expires_at', now.toISOString())

  const { error } = await admin.from('integration_oauth_transactions').insert({
    user_id: userId,
    provider: 'salesforce',
    state_hash: hashSalesforceOAuthState(state),
    encrypted_code_verifier: encryptIntegrationSecret({ codeVerifier }),
    redirect_uri: redirectUri,
    return_to: '/dashboard/settings#integrations',
    expires_at: new Date(now.getTime() + OAUTH_TRANSACTION_TTL_MS).toISOString(),
  })
  if (error) throw new Error('Salesforce OAuth state could not be saved.')
  return state
}

export async function consumeSalesforceOAuthTransaction(
  userId: string,
  state: string,
): Promise<(IntegrationOAuthTransactionRow & { codeVerifier: string }) | null> {
  const { data, error } = await createAdminClient()
    .from('integration_oauth_transactions')
    .delete()
    .eq('user_id', userId)
    .eq('provider', 'salesforce')
    .eq('state_hash', hashSalesforceOAuthState(state))
    .gt('expires_at', new Date().toISOString())
    .select('*')
    .maybeSingle()
  if (error || !data?.encrypted_code_verifier) return null

  try {
    const decrypted = decryptIntegrationSecret<{ codeVerifier: string }>(
      data.encrypted_code_verifier,
    )
    if (!decrypted.codeVerifier) return null
    return { ...(data as IntegrationOAuthTransactionRow), codeVerifier: decrypted.codeVerifier }
  } catch {
    return null
  }
}

export async function getSalesforceConnectionMetadata(
  userId: string,
): Promise<IntegrationConnectionMetadata | null> {
  const { data, error } = await createAdminClient()
    .from('integration_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'salesforce')
    .maybeSingle()
  if (error) return null
  return data ? toMetadata(data as IntegrationConnectionRow) : null
}

async function getStoredSalesforceConnection(
  userId: string,
  requireConnected = true,
): Promise<StoredSalesforceConnection | null> {
  const admin = createAdminClient()
  const { data: connection, error: connectionError } = await admin
    .from('integration_connections')
    .select('id, secret_reference, status, token_expires_at, scopes')
    .eq('user_id', userId)
    .eq('provider', 'salesforce')
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

export async function saveSalesforceConnection(
  userId: string,
  tokens: SalesforceTokenSet,
): Promise<string> {
  const encryptedPayload = encryptIntegrationSecret({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenType: tokens.tokenType,
    instanceUrl: tokens.instanceUrl,
  } satisfies IntegrationCredentialEnvelope)
  const { data, error } = await createAdminClient().rpc('save_salesforce_connection', {
    p_user_id: userId,
    p_encrypted_payload: encryptedPayload,
    p_external_account_id: tokens.accountId,
    p_external_account_name: `Salesforce org ${tokens.accountId}`,
    p_scopes: tokens.scopes,
    p_token_expires_at: tokens.expiresAt,
  })
  if (error || typeof data !== 'string') {
    throw new Error('Salesforce connection could not be saved.')
  }
  return data
}

async function refreshAccessToken(userId: string): Promise<SalesforceAccessContext> {
  const stored = await getStoredSalesforceConnection(userId)
  if (!stored?.credentials.refreshToken || !stored.credentials.instanceUrl) {
    throw new SalesforceOAuthError('Reconnect Salesforce to continue.', true)
  }

  const refreshClaim = randomBytes(24).toString('base64url')
  const admin = createAdminClient()
  const { data: claimed, error: claimError } = await admin.rpc(
    'claim_salesforce_token_refresh',
    {
      p_user_id: userId,
      p_connection_id: stored.connectionId,
      p_expected_encrypted_payload: stored.encryptedPayload,
      p_refresh_claim: refreshClaim,
      p_claim_expires_at: new Date(Date.now() + 30_000).toISOString(),
    },
  )
  if (claimError) throw new Error('Salesforce token refresh could not be started.')
  if (claimed !== true) {
    // Another serverless request owns the single-use token. Wait for its
    // atomic ciphertext swap instead of risking a second redemption.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      const latest = await getStoredSalesforceConnection(userId)
      if (
        latest &&
        latest.encryptedPayload !== stored.encryptedPayload &&
        latest.credentials.accessToken &&
        latest.credentials.instanceUrl
      ) {
        return {
          accessToken: latest.credentials.accessToken,
          instanceUrl: latest.credentials.instanceUrl,
        }
      }
    }
    throw new Error('Salesforce authorization is being refreshed. Please try again.')
  }

  try {
    const refreshed = await refreshSalesforceToken(
      stored.credentials.refreshToken,
      stored.credentials.instanceUrl,
    )
    const encryptedPayload = encryptIntegrationSecret({
      accessToken: refreshed.accessToken,
      // Rotation-aware: a returned replacement overwrites the single-use token.
      refreshToken: refreshed.refreshToken,
      tokenType: refreshed.tokenType,
      instanceUrl: refreshed.instanceUrl,
    } satisfies IntegrationCredentialEnvelope)
    const { data: updated, error } = await admin.rpc('update_salesforce_tokens', {
      p_user_id: userId,
      p_connection_id: stored.connectionId,
      p_expected_encrypted_payload: stored.encryptedPayload,
      p_encrypted_payload: encryptedPayload,
      p_refresh_claim: refreshClaim,
      p_scopes: refreshed.scopes.length > 0 ? refreshed.scopes : stored.scopes,
      p_token_expires_at: refreshed.expiresAt,
    })
    if (error || updated !== true) {
      throw new Error('The refreshed Salesforce token could not be saved.')
    }
    return { accessToken: refreshed.accessToken, instanceUrl: refreshed.instanceUrl }
  } finally {
    await admin.rpc('release_salesforce_token_refresh', {
      p_user_id: userId,
      p_connection_id: stored.connectionId,
      p_refresh_claim: refreshClaim,
    })
  }
}

export async function getSalesforceAccessContext(
  userId: string,
): Promise<SalesforceAccessContext> {
  const stored = await getStoredSalesforceConnection(userId)
  if (!stored?.credentials.accessToken || !stored.credentials.instanceUrl) {
    throw new SalesforceOAuthError('Connect Salesforce before exporting leads.', true)
  }
  const expiresAt = stored.tokenExpiresAt ? Date.parse(stored.tokenExpiresAt) : 0
  if (expiresAt > Date.now() + TOKEN_REFRESH_SKEW_MS) {
    return {
      accessToken: stored.credentials.accessToken,
      instanceUrl: stored.credentials.instanceUrl,
    }
  }

  return refreshSalesforceAccessContext(userId)
}

/** Forces one race-safe refresh after Salesforce rejects an access token. */
export async function refreshSalesforceAccessContext(
  userId: string,
): Promise<SalesforceAccessContext> {
  const existing = refreshes.get(userId)
  if (existing) return existing
  const pending = refreshAccessToken(userId).catch(async (error: unknown) => {
    if (error instanceof SalesforceOAuthError && error.reconnectRequired) {
      await markSalesforceReconnectRequired(userId)
    }
    throw error
  }).finally(() => refreshes.delete(userId))
  refreshes.set(userId, pending)
  return pending
}

export async function getSalesforceRevocationCredentials(
  userId: string,
): Promise<{ refreshToken: string; instanceUrl: string } | null> {
  const stored = await getStoredSalesforceConnection(userId, false)
  if (!stored?.credentials.refreshToken || !stored.credentials.instanceUrl) return null
  return {
    refreshToken: stored.credentials.refreshToken,
    instanceUrl: stored.credentials.instanceUrl,
  }
}

export async function markSalesforceReconnectRequired(userId: string): Promise<void> {
  await createAdminClient()
    .from('integration_connections')
    .update({
      status: 'reconnect_required',
      last_error: 'Salesforce authorization expired. Reconnect Salesforce.',
    })
    .eq('user_id', userId)
    .eq('provider', 'salesforce')
}

export async function markSalesforceConnectionUsed(userId: string): Promise<void> {
  await createAdminClient()
    .from('integration_connections')
    .update({ last_used_at: new Date().toISOString(), last_error: null })
    .eq('user_id', userId)
    .eq('provider', 'salesforce')
}

export async function disconnectSalesforceConnection(userId: string): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc('disconnect_integration', {
    p_user_id: userId,
    p_provider: 'salesforce',
  })
  if (error) throw new Error('Salesforce connection could not be disconnected.')
  return data === true
}
