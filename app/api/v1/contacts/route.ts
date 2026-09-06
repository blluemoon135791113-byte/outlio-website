/**
 * `GET /api/v1/contacts` — M8 Phase 25.5.
 *
 * ⚠️ THE WORKSPACE COMES FROM `context`, WHICH CAME FROM THE KEY. This handler
 * has no way to read a workspace id from the request, which is what makes a
 * cross-tenant read impossible rather than merely forbidden (criterion 7).
 */
import { apiRoute, readPaging } from '@/lib/api/handler'
import { createAdminClient } from '@/lib/supabase/admin'

export const GET = apiRoute('contacts:read', async (request, context) => {
  const { limit, offset } = readPaging(request)
  const url = new URL(request.url)
  const search = url.searchParams.get('search')?.trim()

  let query = createAdminClient()
    .from('crm_contacts')
    /*
     * ⚠️ AN EXPLICIT COLUMN LIST, NEVER `*`. A public API that selects
     * everything leaks whatever column is added next — an internal score, a
     * moderation flag, a soft-delete reason — to every existing integration
     * without anyone deciding to publish it.
     */
    .select('id, full_name, first_name, last_name, job_title, headline, location, owner_user_id, created_at, updated_at', { count: 'exact' })
    .eq('workspace_id', context.workspaceId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (search) query = query.ilike('full_name', `%${search}%`)

  const { data, error, count } = await query
  if (error) throw new Error(`contacts query failed: ${error.message}`)

  return {
    status: 200,
    body: {
      data: data ?? [],
      // A caller cannot page sensibly without knowing the total.
      pagination: { limit, offset, total: count ?? 0, has_more: offset + limit < (count ?? 0) },
    },
  }
})
