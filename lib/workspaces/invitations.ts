import 'server-only'

/**
 * Reading an invitation for display, before anyone accepts it.
 *
 * Strictly READ-ONLY. Redemption is a Server Action
 * (`acceptInvitationAction`), never a page render — a link preview, a prefetch
 * or a corporate mail scanner would otherwise burn the invitation before the
 * invitee ever saw it.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import type { WorkspaceRole } from '@/lib/workspaces/permissions'
import { hashInvitationToken, isInvitationTokenShape } from '@/lib/workspaces/tokens'

export type InvitationPreview = {
  workspaceName: string
  role: WorkspaceRole
  /** Lowercased address the invitation was issued to. */
  email: string
  expiresAt: string
}

/**
 * `null` covers every failure — malformed, unknown, revoked, accepted and
 * expired alike. The join page shows one message for all of them, so
 * `/join/<guess>` cannot be used to learn which tokens were ever real.
 */
export async function describeInvitation(
  token: string,
): Promise<InvitationPreview | null> {
  if (!isInvitationTokenShape(token)) return null

  const { data, error } = await createAdminClient()
    .from('workspace_invitations')
    .select('email, role, expires_at, accepted_at, revoked_at, workspaces!inner(name)')
    .eq('token_hash', hashInvitationToken(token))
    .maybeSingle()

  if (error) throw new Error(`describeInvitation failed: ${error.message}`)
  if (!data) return null

  if (data.accepted_at || data.revoked_at) return null
  if (new Date(data.expires_at).getTime() <= Date.now()) return null
  if (!data.workspaces) return null

  return {
    workspaceName: data.workspaces.name,
    role: data.role,
    email: data.email,
    expiresAt: data.expires_at,
  }
}
