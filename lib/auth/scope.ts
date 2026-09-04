import 'server-only'

/**
 * The tenant scope, and the only safe way to open a service-role query.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  `createAdminClient()` BYPASSES ROW LEVEL SECURITY ENTIRELY.             ║
 * ║                                                                           ║
 * ║  It is used in 135 files. CLAUDE.md requires every one of those queries   ║
 * ║  to scope by tenant IN CODE, and until Phase 1 that requirement was       ║
 * ║  enforced by review alone — which is to say, by whether somebody          ║
 * ║  remembered.                                                              ║
 * ║                                                                           ║
 * ║  ⚠️ FORGETTING IS NOT A BUG HERE, IT IS A CROSS-TENANT BREACH, and it      ║
 * ║  looks exactly like working code: the query returns rows, the page        ║
 * ║  renders, the tests pass. Nothing fails until it is somebody else's data. ║
 * ║                                                                           ║
 * ║  So this module does not ask callers to remember. `scopedFrom` applies    ║
 * ║  the filter itself and REFUSES A TABLE IT DOES NOT KNOW, which turns a    ║
 * ║  silent leak into a loud startup-time error.                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import type { WorkspaceContext } from '@/lib/workspaces/context'

/**
 * ⚠️ THIS CODEBASE HAS TWO TENANCY MODELS AND BOTH ARE LIVE.
 *
 * The original product scoped everything to `user_id` — extraction, uploads,
 * research, billing. The CRM era introduced `workspace_id`. Neither replaced the
 * other, so 64 tables carry `workspace_id`, 42 carry only `user_id`, and 18
 * carry neither because they are genuinely global.
 *
 * That split is invisible at a call site and is the single easiest way to write
 * a query that looks scoped and is not: `.eq('workspace_id', …)` against a
 * user-scoped table matches nothing and reads as a working empty state.
 */
export type Tenancy = 'workspace' | 'user' | 'global'

export type TenantScope = {
  workspaceId: string
  userId: string
}

/** The scope a request may act within. Nothing else may construct one. */
export function scopeFor(ctx: WorkspaceContext): TenantScope {
  return { workspaceId: ctx.workspace.id, userId: ctx.userId }
}

/**
 * Every table, and how it is tenanted.
 *
 * ⚠️ A TABLE MISSING FROM THIS MAP IS A HARD ERROR, NOT A DEFAULT.
 *
 * Defaulting to `'global'` would silently un-scope every new table; defaulting
 * to `'workspace'` would silently break every user-scoped one. Both defaults
 * fail quietly, which is the failure mode this whole module exists to remove.
 * `tests/unit/tenant-scope.test.ts` asserts the map covers every table in the
 * migrations, so adding a table without classifying it fails the suite.
 */
export const TABLE_TENANCY: Record<string, Tenancy> = {
  // ---- global: no tenant column, and that is correct -----------------------
  // Worker queues sweep every tenant by design; reference and platform tables
  // belong to nobody.
  admin_audit_logs: 'global',
  email_account_secrets: 'global',
  fastspring_webhook_events: 'global',
  integration_secrets: 'global',
  invitation_codes: 'global',
  job_queue: 'global',
  paddle_webhook_events: 'global',
  plans: 'global',
  profiles: 'global',
  provider_cache: 'global',
  provider_request_schedules: 'global',
  rate_limits: 'global',
  referrals: 'global',
  research_job_queue: 'global',
  web_research_cache: 'global',
  web_research_jobs: 'global',
  web_research_lead_results: 'global',
  // `workspaces` is keyed by `id`, not `workspace_id`, so it cannot use the
  // generic filter. Callers scope it explicitly by id or owner_user_id.
  workspaces: 'global',

  // ---- user-scoped: the original product ----------------------------------
  access_requests: 'user',
  account_list_entries: 'user',
  capture_pages: 'user',
  capture_sessions: 'user',
  companies: 'user',
  company_links: 'user',
  company_signals: 'user',
  credit_grants: 'user',
  export_destinations: 'user',
  export_job_errors: 'user',
  export_jobs: 'user',
  extension_devices: 'user',
  extension_pairings: 'user',
  extracted_leads: 'user',
  extraction_jobs: 'user',
  fastspring_accounts: 'user',
  fastspring_charges: 'user',
  fastspring_orders: 'user',
  fastspring_subscriptions: 'user',
  hubble_answers: 'user',
  hubble_chunks: 'user',
  hubble_pages: 'user',
  integration_connections: 'user',
  integration_oauth_transactions: 'user',
  integration_record_links: 'user',
  lead_keys: 'user',
  paddle_customers: 'user',
  paddle_subscriptions: 'user',
  paddle_transactions: 'user',
  qualification_profiles: 'user',
  qualification_results: 'user',
  qualification_rules: 'user',
  research_evidence: 'user',
  research_runs: 'user',
  research_tool_calls: 'user',
  signup_device_claims: 'user',
  signup_identity_claims: 'user',
  signup_ip_claims: 'user',
  subscriptions: 'user',
  system_events: 'user',
  uploaded_files: 'user',
  usage_counters: 'user',
}

/** The column that carries the tenant, or null when there is none. */
export function tenantColumn(table: string): 'workspace_id' | 'user_id' | null {
  const tenancy = TABLE_TENANCY[table] ?? 'workspace'
  if (tenancy === 'workspace') return 'workspace_id'
  if (tenancy === 'user') return 'user_id'
  return null
}

export class UnscopedTableError extends Error {}

/**
 * Assert that a table is one this module knows how to scope.
 *
 * ⚠️ `TABLE_TENANCY` OMITS THE WORKSPACE-SCOPED TABLES ON PURPOSE — there are
 * 64 of them and listing every one would rot. `workspace` is the implicit
 * default, and the test file is what makes that safe: it reads the migrations
 * and fails if a table's real columns disagree with what this map implies. So
 * the default is checked, not assumed.
 */
export function assertKnownTable(table: string, declaredColumns: string[]): void {
  const expected = tenantColumn(table)
  if (expected === null) return
  if (!declaredColumns.includes(expected)) {
    throw new UnscopedTableError(
      `${table} is treated as ${TABLE_TENANCY[table] ?? 'workspace'}-scoped, which means ` +
        `filtering on ${expected}, but the table has no such column. A filter on a ` +
        `column that does not exist matches nothing and reads as a working empty ` +
        `state. Classify it in TABLE_TENANCY.`,
    )
  }
}

/**
 * Open a service-role query with the tenant filter already applied.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE POINT IS THAT THE CALLER CANNOT FORGET, NOT THAT THEY SHOULD     ║
 * ║  REMEMBER.                                                               ║
 * ║                                                                           ║
 * ║  `apiRoute` (lib/api/handler.ts) already proves the pattern works: its    ║
 * ║  handlers have no way to read a workspace id from the request, which is   ║
 * ║  what makes a cross-tenant read IMPOSSIBLE there rather than merely       ║
 * ║  forbidden. This brings the same property to server actions and pages.    ║
 * ║                                                                           ║
 * ║  It also picks the RIGHT column. Two tenancy models are live here, and    ║
 * ║  `.eq('workspace_id', …)` against a user-scoped table matches nothing and ║
 * ║  renders as an empty state — a bug nobody reports because it looks like   ║
 * ║  having no data.                                                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export function scopedFrom<Client extends { from: (table: never) => unknown }>(
  db: Client,
  scope: TenantScope,
  table: string,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = (db.from as any)(table)
  const column = tenantColumn(table)
  if (column === null) return query
  return query.eq(column, column === 'workspace_id' ? scope.workspaceId : scope.userId)
}
