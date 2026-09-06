import 'server-only'

/**
 * Campaigns a flow step can point at.
 *
 * ⚠️ EVERY CAMPAIGN, NOT ONLY THE LIVE ONES. A flow is usually built BEFORE
 * the campaign it enrols into is launched — filtering to `active` would hide
 * the draft the author is about to point at and make the picker look broken.
 * The status travels with the name instead, so the choice is informed rather
 * than restricted.
 *
 * ⚠️ SERVER-ONLY, AND SCOPED BY WORKSPACE IN THE QUERY. The service role
 * bypasses RLS, so this function is the boundary — a campaign list is a map of
 * a customer's outbound programme.
 */
import { createAdminClient } from '@/lib/supabase/admin'

export type SelectableCampaign = {
  id: string
  name: string
  status: string
  type: string
}

export async function listSelectableCampaigns(
  workspaceId: string,
): Promise<SelectableCampaign[]> {
  const { data, error } = await createAdminClient()
    .from('email_campaigns')
    .select('id, name, status, type')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) throw new Error(`listSelectableCampaigns failed: ${error.message}`)

  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    type: c.type,
  }))
}
