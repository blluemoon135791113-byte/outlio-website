/** `GET /api/v1/lists` — M8 Phase 25.5. */
import { apiRoute, readPaging } from '@/lib/api/handler'
import { createAdminClient } from '@/lib/supabase/admin'

export const GET = apiRoute('lists:read', async (request, context) => {
  const { limit, offset } = readPaging(request)

  const { data, error, count } = await createAdminClient()
    .from('crm_lists')
    .select('id, name, description, created_at, updated_at', { count: 'exact' })
    .eq('workspace_id', context.workspaceId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) throw new Error(`lists query failed: ${error.message}`)

  return {
    status: 200,
    body: {
      data: data ?? [],
      pagination: { limit, offset, total: count ?? 0, has_more: offset + limit < (count ?? 0) },
    },
  }
})
