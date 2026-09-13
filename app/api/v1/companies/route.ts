/** `GET /api/v1/companies` — M8 Phase 25.5. */
import { apiRoute, readPaging } from '@/lib/api/handler'
import { createAdminClient } from '@/lib/supabase/admin'

export const GET = apiRoute('companies:read', async (request, context) => {
  const { limit, offset } = readPaging(request)
  const search = new URL(request.url).searchParams.get('search')?.trim()

  let query = createAdminClient()
    .from('crm_companies')
    // Explicit columns, never `*`: a public API that selects everything
    // publishes whatever column is added next.
    .select('id, name, domain, industry, employee_count, linkedin_url, created_at, updated_at', {
      count: 'exact',
    })
    .eq('workspace_id', context.workspaceId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    /*
     * ⚠️ A STABLE TIEBREAKER, AND IT IS NOT THEORETICAL HERE. Batch ingestion
     * inserts many contacts in one transaction, so `now()` — and therefore
     * `created_at` — is IDENTICAL across the batch. Production currently holds
     * 51 contacts across 9 distinct timestamps, with 25 rows sharing one.
     *
     * Inside a tie group Postgres has no defined order, so `?offset=10` can
     * return rows already sent on page 1 while others are never returned at
     * all. An integration syncing this endpoint silently misses records and
     * has no way to notice. `lib/crm/contacts-list.ts` has always done this;
     * the public API did not.
     */
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1)

  if (search) query = query.ilike('name', `%${search}%`)

  const { data, error, count } = await query
  if (error) throw new Error(`companies query failed: ${error.message}`)

  return {
    status: 200,
    body: {
      data: data ?? [],
      pagination: { limit, offset, total: count ?? 0, has_more: offset + limit < (count ?? 0) },
    },
  }
})
