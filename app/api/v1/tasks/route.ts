/** `GET /api/v1/tasks` — M8 Phase 25.5. */
import { apiRoute, readPaging } from '@/lib/api/handler'
import { createAdminClient } from '@/lib/supabase/admin'

export const GET = apiRoute('tasks:read', async (request, context) => {
  const { limit, offset } = readPaging(request)
  const status = new URL(request.url).searchParams.get('status')

  let query = createAdminClient()
    .from('crm_tasks')
    .select(
      'id, title, status, due_at, completed_at, contact_id, company_id, assigned_to_user_id, created_at',
      { count: 'exact' },
    )
    .eq('workspace_id', context.workspaceId)
    .is('deleted_at', null)
    .order('due_at', { ascending: true, nullsFirst: false })
    .range(offset, offset + limit - 1)

  // Validated against a known set; an arbitrary string would reach the query.
  if (status && ['open', 'completed', 'cancelled'].includes(status)) {
    query = query.eq('status', status as 'open' | 'completed' | 'cancelled')
  }

  const { data, error, count } = await query
  if (error) throw new Error(`tasks query failed: ${error.message}`)

  return {
    status: 200,
    body: {
      data: data ?? [],
      pagination: { limit, offset, total: count ?? 0, has_more: offset + limit < (count ?? 0) },
    },
  }
})
