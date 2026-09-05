import 'server-only'

import type { ClayCredentials } from '@/lib/integrations/clay'
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from '@/lib/integrations/crypto'
import type {
  IntegrationConnectionMetadata,
  IntegrationCredentialEnvelope,
} from '@/lib/integrations/types'
import { createAdminClient } from '@/lib/supabase/admin'
import type { IntegrationConnectionRow } from '@/types/database'

function toMetadata(row: IntegrationConnectionRow): IntegrationConnectionMetadata {
  return {
    id: row.id,
    provider: 'clay',
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

/** Returns safe metadata only and never reads the credential table. */
export async function getClayConnectionMetadata(
  userId: string,
): Promise<IntegrationConnectionMetadata | null> {
  const { data, error } = await createAdminClient()
    .from('integration_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'clay')
    .maybeSingle()

  if (error) return null
  return data ? toMetadata(data as IntegrationConnectionRow) : null
}

export async function saveClayConnection(
  userId: string,
  credentials: ClayCredentials,
  accountLabel: string,
): Promise<string> {
  const encryptedPayload = encryptIntegrationSecret(credentials)
  const { data, error } = await createAdminClient().rpc('save_clay_connection', {
    p_user_id: userId,
    p_encrypted_payload: encryptedPayload,
    p_account_label: accountLabel,
  })

  if (error || typeof data !== 'string') {
    throw new Error('Clay connection could not be saved.')
  }
  return data
}

export async function getClayCredentials(
  userId: string,
): Promise<{ connectionId: string; credentials: ClayCredentials } | null> {
  const admin = createAdminClient()
  const { data: connection, error: connectionError } = await admin
    .from('integration_connections')
    .select('id, secret_reference, status')
    .eq('user_id', userId)
    .eq('provider', 'clay')
    .maybeSingle()

  if (connectionError || !connection || connection.status !== 'connected') return null

  const { data: secret, error: secretError } = await admin
    .from('integration_secrets')
    .select('encrypted_payload')
    .eq('connection_id', connection.id)
    .eq('id', connection.secret_reference)
    .maybeSingle()

  if (secretError || !secret) return null

  const payload = decryptIntegrationSecret<IntegrationCredentialEnvelope>(
    secret.encrypted_payload,
  )
  if (!payload.clayWebhookUrl) return null

  return {
    connectionId: connection.id,
    credentials: {
      clayWebhookUrl: payload.clayWebhookUrl,
      clayAuthenticationToken: payload.clayAuthenticationToken,
    },
  }
}

export async function updateClayConnectionTest(
  userId: string,
  result: { ok: boolean; reconnectRequired?: boolean; message?: string },
): Promise<void> {
  const status = result.ok
    ? 'connected'
    : result.reconnectRequired
      ? 'reconnect_required'
      : 'error'

  await createAdminClient()
    .from('integration_connections')
    .update({
      status,
      last_tested_at: new Date().toISOString(),
      last_error: result.ok ? null : result.message ?? 'Clay connection test failed.',
    })
    .eq('user_id', userId)
    .eq('provider', 'clay')
}

export async function markClayConnectionUsed(userId: string): Promise<void> {
  await createAdminClient()
    .from('integration_connections')
    .update({ last_used_at: new Date().toISOString(), last_error: null })
    .eq('user_id', userId)
    .eq('provider', 'clay')
}

export async function disconnectClayConnection(userId: string): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc('disconnect_integration', {
    p_user_id: userId,
    p_provider: 'clay',
  })
  if (error) throw new Error('Clay connection could not be disconnected.')
  return data === true
}
