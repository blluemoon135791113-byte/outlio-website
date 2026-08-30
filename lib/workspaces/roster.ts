import 'server-only'

/**
 * Reads for the team screen.
 *
 * Separate from `context.ts` because these are LISTINGS, not decisions.
 * Nothing here decides access — the caller must already have passed
 * `workspace.member.view`.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { platformDb } from '@/lib/workspaces/db'
import type { WorkspaceRole } from '@/lib/workspaces/permissions'

export type TeamMember = {
  membershipId: string
  userId: string
  role: WorkspaceRole
  email: string | null
  fullName: string | null
  joinedAt: string
}

export type PendingInvitation = {
  id: string
  email: string
  role: WorkspaceRole
  expiresAt: string
  createdAt: string
}

/**
 * Members of one workspace, owners first.
 *
 * Two queries rather than a join: `profiles` and `workspace_memberships` are
 * reached through differently-typed clients until 0070 lands in the generated
 * types (see `lib/workspaces/db.ts`). Both are scoped in code — the service
 * role bypasses RLS.
 */
export async function listMembers(workspaceId: string): Promise<TeamMember[]> {
  const { data: memberships, error } = await platformDb()
    .from('workspace_memberships')
    .select('id, user_id, role, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`listMembers failed: ${error.message}`)
  if (!memberships?.length) return []

  const userIds = memberships.map((m) => m.user_id)
  const { data: profiles, error: profileError } = await createAdminClient()
    .from('profiles')
    .select('id, email, full_name')
    .in('id', userIds)

  if (profileError) throw new Error(`listMembers failed: ${profileError.message}`)

  const byId = new Map((profiles ?? []).map((p) => [p.id, p]))

  return memberships.map((m) => ({
    membershipId: m.id,
    userId: m.user_id,
    role: m.role,
    email: byId.get(m.user_id)?.email ?? null,
    fullName: byId.get(m.user_id)?.full_name ?? null,
    joinedAt: m.created_at,
  }))
}

/**
 * Invitations that can still be accepted.
 *
 * Expired rows are filtered here rather than deleted, so an admin can see that
 * an invitation lapsed instead of wondering whether it was ever sent.
 */
export async function listPendingInvitations(
  workspaceId: string,
): Promise<PendingInvitation[]> {
  const { data, error } = await platformDb()
    .from('workspace_invitations')
    .select('id, email, role, expires_at, created_at')
    .eq('workspace_id', workspaceId)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })

  if (error) throw new Error(`listPendingInvitations failed: ${error.message}`)

  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }))
}
