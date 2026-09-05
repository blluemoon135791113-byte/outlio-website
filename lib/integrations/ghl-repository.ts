import 'server-only'

import { decryptIntegrationSecret, encryptIntegrationSecret } from '@/lib/integrations/crypto'
import type { GhlCredentials } from '@/lib/integrations/ghl'
import type { IntegrationConnectionMetadata, IntegrationCredentialEnvelope } from '@/lib/integrations/types'
import { createAdminClient } from '@/lib/supabase/admin'
import type { IntegrationConnectionRow } from '@/types/database'

function toMetadata(row: IntegrationConnectionRow): IntegrationConnectionMetadata {
  return {
    id: row.id,
    provider: 'ghl',
    status: row.status,
    externalAccountName: row.external_account_name,
    externalAccountEmail: null,
    scopes: row.scopes,
    connectedAt: row.connected_at,
    lastUsedAt: row.last_used_at,
    lastTestedAt: row.last_tested_at,
    lastError: row.last_error,
  }
}

export async function getGhlConnectionMetadata(userId: string): Promise<IntegrationConnectionMetadata | null> {
  const { data, error } = await createAdminClient().from('integration_connections').select('*').eq('user_id', userId).eq('provider', 'ghl').maybeSingle()
  return error || !data ? null : toMetadata(data as IntegrationConnectionRow)
}

export async function saveGhlConnection(userId: string, credentials: GhlCredentials, accountName: string | null): Promise<string> {
  const encryptedPayload = encryptIntegrationSecret({
    ghlPrivateIntegrationToken: credentials.token,
    ghlLocationId: credentials.locationId,
  } satisfies IntegrationCredentialEnvelope)
  const admin = createAdminClient()
  const { data: connection, error } = await admin.from('integration_connections').upsert({
    user_id: userId,
    provider: 'ghl',
    status: 'connected',
    external_account_id: credentials.locationId,
    external_account_name: accountName ?? `HighLevel location ${credentials.locationId}`,
    scopes: ['contacts.write', 'contacts.readonly', 'locations.readonly'],
    connected_at: new Date().toISOString(),
    last_tested_at: new Date().toISOString(),
    last_error: null,
  }, { onConflict: 'user_id,provider' }).select('id,secret_reference').single()
  if (error || !connection) throw new Error('HighLevel connection could not be saved.')
  const { error: secretError } = await admin.from('integration_secrets').upsert({
    id: connection.secret_reference,
    connection_id: connection.id,
    encrypted_payload: encryptedPayload,
  }, { onConflict: 'connection_id' })
  if (secretError) throw new Error('HighLevel connection could not be saved.')
  return connection.id
}

export async function getGhlCredentials(userId: string): Promise<{ connectionId: string; credentials: GhlCredentials } | null> {
  const admin = createAdminClient()
  const { data: connection } = await admin.from('integration_connections').select('id,secret_reference,status').eq('user_id', userId).eq('provider', 'ghl').maybeSingle()
  if (!connection || connection.status !== 'connected') return null
  const { data: secret } = await admin.from('integration_secrets').select('encrypted_payload').eq('id', connection.secret_reference).eq('connection_id', connection.id).maybeSingle()
  if (!secret) return null
  try {
    const payload = decryptIntegrationSecret<IntegrationCredentialEnvelope>(secret.encrypted_payload)
    if (!payload.ghlPrivateIntegrationToken || !payload.ghlLocationId) return null
    return { connectionId: connection.id, credentials: { token: payload.ghlPrivateIntegrationToken, locationId: payload.ghlLocationId } }
  } catch {
    return null
  }
}

export async function updateGhlConnectionTest(userId: string, result: { ok: boolean; reconnectRequired?: boolean; message?: string }): Promise<void> {
  await createAdminClient().from('integration_connections').update({
    status: result.ok ? 'connected' : result.reconnectRequired ? 'reconnect_required' : 'error',
    last_tested_at: new Date().toISOString(),
    last_error: result.ok ? null : result.message ?? 'HighLevel connection failed.',
  }).eq('user_id', userId).eq('provider', 'ghl')
}

export async function markGhlConnectionUsed(userId: string): Promise<void> {
  await createAdminClient().from('integration_connections').update({ last_used_at: new Date().toISOString(), last_error: null }).eq('user_id', userId).eq('provider', 'ghl')
}

export async function disconnectGhlConnection(userId: string): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc('disconnect_integration', { p_user_id: userId, p_provider: 'ghl' })
  if (error) throw new Error('HighLevel connection could not be disconnected.')
  return data === true
}
