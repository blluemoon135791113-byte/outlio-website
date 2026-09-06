/**
 * `GET /api/v1/activities` — M8 Phase 25.5.
 *
 * ⚠️ `metadata` IS NOT EXPOSED. Activity metadata carries message subjects,
 * note fragments and classifier reasoning — things a customer's own staff can
 * see in the UI, but which an integration key should not stream out wholesale.
 * The shape of an activity is published; its contents are not.
 */
import { apiRoute, readPaging } from '@/lib/api/handler'
import { createAdminClient } from '@/lib/supabase/admin'

export const GET = apiRoute('activities:read', async (request, context) => {
  const { limit, offset } = readPaging(request)
  const url = new URL(request.url)
  const contactId = url.searchParams.get('contact_id')

  let query = createAdminClient()
    .from('crm_activities')
    .select(
      'id, activity_type, channel, contact_id, company_id, actor_user_id, owner_user_id_at_event, occurred_at, created_at',
      { count: 'exact' },
    )
    .eq('workspace_id', context.workspaceId)
    .order('occurred_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (contactId) query = query.eq('contact_id', contactId)

  const { data, error, count } = await query
  if (error) throw new Error(`activities query failed: ${error.message}`)

  return {
    status: 200,
    body: {
      data: data ?? [],
      pagination: { limit, offset, total: count ?? 0, has_more: offset + limit < (count ?? 0) },
    },
  }
})
