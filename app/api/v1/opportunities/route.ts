/**
 * `GET /api/v1/opportunities` — M8 Phase 25.5.
 *
 * ⚠️ MONEY IS RETURNED AS THE DATABASE STORES IT. `value_amount` is numeric in
 * Postgres and arrives as a JS number; it is passed straight through without
 * arithmetic, because summing money in JavaScript is how totals drift by
 * fractions of a penny (Ledger D25).
 */
import { apiRoute, readPaging } from '@/lib/api/handler'
import { createAdminClient } from '@/lib/supabase/admin'

export const GET = apiRoute('opportunities:read', async (request, context) => {
  const { limit, offset } = readPaging(request)
  const url = new URL(request.url)
  const status = url.searchParams.get('status')

  let query = createAdminClient()
    .from('crm_opportunities')
    .select(
      'id, title, status, value_amount, currency, probability, expected_close_date, closed_at, contact_id, company_id, owner_user_id, created_at',
      { count: 'exact' },
    )
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

  // Validated against a known set: an arbitrary string would reach the query.
  if (status && ['open', 'won', 'lost'].includes(status)) {
    query = query.eq('status', status as 'open' | 'won' | 'lost')
  }

  const { data, error, count } = await query
  if (error) throw new Error(`opportunities query failed: ${error.message}`)

  return {
    status: 200,
    body: {
      data: data ?? [],
      pagination: { limit, offset, total: count ?? 0, has_more: offset + limit < (count ?? 0) },
    },
  }
})
