import 'server-only'

/**
 * Service-role access to the workspace tables.
 *
 * ⚠️ TEMPORARY, AND DELIBERATELY SO.
 *
 * `types/database.ts` is generated from the LIVE Supabase project by
 * `npm run db:types`, so the tables added in migration 0070 are absent from
 * `Database` until that migration is applied and the types are regenerated.
 * Rather than sprinkle `as any` across the workspace modules — which would
 * survive the regeneration and quietly rot — the shape is declared once, here.
 *
 * ONCE 0070 IS APPLIED:
 *   1. `npm run db:types`
 *   2. delete `PlatformDatabase` below and have `platformDb()` return
 *      `createAdminClient()` unchanged
 *   3. `npm run typecheck` will point at anything that drifted
 *
 * The service role bypasses RLS. Every query made through this client must
 * scope by `workspace_id` (and, for member reads, `user_id`) in application
 * code — see the banner in `lib/supabase/admin.ts`.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { createAdminClient } from '@/lib/supabase/admin'
import type { WorkspaceRole } from '@/lib/workspaces/permissions'

export type WorkspaceRow = {
  id: string
  owner_user_id: string
  name: string
  member_limit_override: number | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export type WorkspaceMembershipRow = {
  id: string
  workspace_id: string
  user_id: string
  role: WorkspaceRole
  invited_by: string | null
  created_at: string
  updated_at: string
}

export type WorkspaceInvitationRow = {
  id: string
  workspace_id: string
  email: string
  role: WorkspaceRole
  /** SHA-256 of the raw token. The raw token is never stored. */
  token_hash: string
  invited_by: string | null
  expires_at: string
  accepted_at: string | null
  accepted_by: string | null
  revoked_at: string | null
  created_at: string
}

export type WorkspaceFeatureFlagRow = {
  workspace_id: string
  flag: string
  enabled: boolean
  updated_at: string
}

/** Status strings returned by `redeem_workspace_invitation` (migration 0070). */
export type RedeemInvitationStatus =
  | 'ok'
  | 'invalid'
  | 'unavailable'
  | 'wrong_email'
  | 'already_member'
  | 'seat_limit'

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

export type PlatformDatabase = {
  public: {
    Tables: {
      workspaces: Table<
        WorkspaceRow,
        { owner_user_id: string; name: string; member_limit_override?: number | null }
      >
      workspace_memberships: Table<
        WorkspaceMembershipRow,
        {
          workspace_id: string
          user_id: string
          role?: WorkspaceRole
          invited_by?: string | null
        }
      >
      workspace_invitations: Table<
        WorkspaceInvitationRow,
        {
          workspace_id: string
          email: string
          role: WorkspaceRole
          token_hash: string
          invited_by?: string | null
          expires_at: string
        }
      >
      workspace_feature_flags: Table<
        WorkspaceFeatureFlagRow,
        { workspace_id: string; flag: string; enabled: boolean }
      >
    }
    Views: Record<never, never>
    Functions: {
      redeem_workspace_invitation: {
        Args: {
          p_token_hash: string
          p_user_id: string
          p_member_limit?: number | null
        }
        Returns: RedeemInvitationStatus
      }
    }
    Enums: { workspace_role: WorkspaceRole }
    CompositeTypes: Record<never, never>
  }
}

export type PlatformClient = SupabaseClient<PlatformDatabase>

export function platformDb(): PlatformClient {
  return createAdminClient() as unknown as PlatformClient
}
