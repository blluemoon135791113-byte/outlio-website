import 'server-only'

/**
 * The facts a branch can read — M7 Phase 10.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THREE KINDS OF MISSING, AND CONFUSING THEM IS THE ONLY WAY TO GET THIS  ║
 * ║  WRONG.                                                                 ║
 * ║                                                                         ║
 * ║  1. OBSERVED ZERO.  The query succeeded and found no rows. count is the ║
 * ║     number 0, a real fact: we looked, and there are none.               ║
 * ║     greater_than 0 reads false; is_empty reads false too, because 0 is  ║
 * ║     a value, not an absence.                                            ║
 * ║                                                                         ║
 * ║  2. OBSERVED ABSENT.  company: null — the contact genuinely has no     ║
 * ║     company, because primary_company_id is null. The company keys are  ║
 * ║     all present with null values, so is_empty reads TRUE. Never 0,     ║
 * ║     never silently omitted.                                            ║
 * ║                                                                         ║
 * ║  3. COULD-NOT-OBSERVE.  A query ERRORED. Fabricating a zero count from  ║
 * ║     a failed query would tell every branch a confident lie — a contact ║
 * ║     could be routed as having no deals because a database hiccuped.    ║
 * ║     The whole domain is OMITTED, its keys absent, so is_empty reads    ║
 * ║     true and greater_than 0 reads false — conservative, never a lie.   ║
 * ║                                                                         ║
 * ║  ALL SEVEN QUERIES RUN AS THE SERVICE ROLE, which bypasses RLS. Every   ║
 * ║  single one scopes by workspace in code — with the admin client there  ║
 * ║  is no row-level safety net, only that WHERE clause. A missing scope   ║
 * ║  is a cross-tenant read, not a slow query.                            ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 */

import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'

// ---------------------------------------------------------------------------
// Row shapes — picked from the generated types, never re-declared by hand.
// ---------------------------------------------------------------------------

type ContactFactRow = Pick<
  Database['public']['Tables']['crm_contacts']['Row'],
  | 'full_name'
  | 'first_name'
  | 'last_name'
  | 'job_title'
  | 'headline'
  | 'location'
  | 'owner_user_id'
  | 'primary_company_id'
>

type CompanyFactRow = Pick<
  Database['public']['Tables']['crm_companies']['Row'],
  'name' | 'domain' | 'industry' | 'headquarters' | 'employee_count' | 'owner_user_id'
>

type OpportunityFactRow = Pick<
  Database['public']['Tables']['crm_opportunities']['Row'],
  'status' | 'title' | 'value_amount' | 'updated_at'
>

type ActivityFactRow = Pick<
  Database['public']['Tables']['crm_activities']['Row'],
  'activity_type' | 'occurred_at'
>

type TaskFactRow = Pick<Database['public']['Tables']['crm_tasks']['Row'], 'status'>

type MessageFactRow = Pick<
  Database['public']['Tables']['email_messages']['Row'],
  'status' | 'updated_at'
>

type ThreadFactRow = Pick<
  Database['public']['Tables']['email_threads']['Row'],
  'status' | 'last_direction' | 'last_message_at'
>

// ---------------------------------------------------------------------------
// The builder — pure, so the null story is testable without a database.
// ---------------------------------------------------------------------------

/**
 * Turns one run's observed rows into the flat fact set a branch reads.
 *
 * `gatherFacts` handles the three-way contract upstream of this: a query
 * error becomes `undefined` for that domain, a successful query becomes its
 * rows (possibly none). This builder maps each shape onto exactly the keys
 * below.
 *
 * ⚠️ THE KEY LIST IS NOT GUESSED. `facts[condition.field]` is a plain
 * lookup, so a field the fact set does not contain reads as `undefined` and
 * most operators go false — every contact takes the same path while the
 * branch looks configured. A key here that FlowBuilder does not offer is
 * dead weight; a key FlowBuilder offers that this does not produce is the
 * silent no-branch bug, in production.
 */
export function buildDomainFacts(input: {
  contact: ContactFactRow | null
  company?: CompanyFactRow | null
  opportunities?: OpportunityFactRow[]
  activities?: ActivityFactRow[]
  tasks?: TaskFactRow[]
  messages?: MessageFactRow[]
  threads?: ThreadFactRow[]
}): Record<string, unknown> {
  // `contact: null` means "no contact on this run" — the historical
  // behaviour returns no facts at all, and that is preserved.
  if (input.contact === null) return {}
  const contact = input.contact

  /*
   * Per-domain fact sets, built as literals and spread into the single
   * return below. A domain that could not be observed (the key is
   * `undefined` on the input) contributes NOTHING — its keys stay absent,
   * per the three-way contract at the top of this file. The `?? null` on the
   * company row is the observed-absent story: a contact with no company
   * gets null keys, not zeroes, not omissions.
   */
  const companyFacts: Record<string, unknown> =
    input.company === undefined
      ? {}
      : {
          'company.name': input.company?.name ?? null,
          'company.domain': input.company?.domain ?? null,
          'company.industry': input.company?.industry ?? null,
          'company.headquarters': input.company?.headquarters ?? null,
          'company.employee_count': input.company?.employee_count ?? null,
          'company.owner_user_id': input.company?.owner_user_id ?? null,
        }

  const rows = input.opportunities ?? []
  const latestOpportunity = newestBy(rows, (r) => r.updated_at)
  const opportunityFacts: Record<string, unknown> =
    input.opportunities === undefined
      ? {}
      : {
          'opportunity.count': rows.length,
          'opportunity.open_count': rows.filter((o) => o.status === 'open').length,
          'opportunity.latest_status': latestOpportunity?.status ?? null,
          'opportunity.latest_title': latestOpportunity?.title ?? null,
          'opportunity.latest_value': latestOpportunity?.value_amount ?? null,
          'opportunity.total_value': rows.reduce((sum, o) => sum + (o.value_amount ?? 0), 0),
        }

  const activityRows = input.activities ?? []
  const latestActivity = newestBy(activityRows, (r) => r.occurred_at)
  const activityFacts: Record<string, unknown> =
    input.activities === undefined
      ? {}
      : {
          'activity.count': activityRows.length,
          'activity.latest_type': latestActivity?.activity_type ?? null,
          'activity.latest_at': latestActivity?.occurred_at ?? null,
        }

  const taskRows = input.tasks ?? []
  const taskFacts: Record<string, unknown> =
    input.tasks === undefined
      ? {}
      : {
          'task.count': taskRows.length,
          'task.open_count': taskRows.filter((t) => t.status === 'open').length,
        }

  const messageRows = input.messages ?? []
  const latestMessage = newestBy(messageRows, (r) => r.updated_at)
  const emailFacts: Record<string, unknown> =
    input.messages === undefined
      ? {}
      : {
          'email.count': messageRows.length,
          'email.sent_count': messageRows.filter((m) => m.status === 'sent').length,
          'email.failed_count': messageRows.filter((m) => m.status === 'failed').length,
          'email.latest_status': latestMessage?.status ?? null,
        }

  const threadRows = input.threads ?? []
  const latestThread = newestBy(threadRows, (r) => r.last_message_at)
  const conversationFacts: Record<string, unknown> =
    input.threads === undefined
      ? {}
      : {
          'conversation.count': threadRows.length,
          'conversation.open_count': threadRows.filter((t) => t.status === 'open').length,
          'conversation.latest_direction': latestThread?.last_direction ?? null,
          'conversation.latest_message_at': latestThread?.last_message_at ?? null,
        }

  return {
    'contact.full_name': contact.full_name,
    'contact.first_name': contact.first_name,
    'contact.last_name': contact.last_name,
    'contact.job_title': contact.job_title,
    'contact.headline': contact.headline,
    'contact.location': contact.location,
    'contact.owner_user_id': contact.owner_user_id,
    'contact.company_id': contact.primary_company_id,
    ...companyFacts,
    ...opportunityFacts,
    ...activityFacts,
    ...taskFacts,
    ...emailFacts,
    ...conversationFacts,
  }
}

/**
 * Newest row by an ISO timestamp, or null when there are none. Sorting in
 * JS, not the query, keeps the pure builder independent of PostgREST
 * ordering — and the latest row of an empty array is null, not undefined.
 */
function newestBy<T>(rows: T[], at: (row: T) => string): T | null {
  if (rows.length === 0) return null
  return [...rows].sort((a, b) => (at(a) < at(b) ? 1 : -1))[0] ?? null
}

// ---------------------------------------------------------------------------
// The gather — reads the real rows once per run.
// ---------------------------------------------------------------------------

/**
 * The facts a branch can read.
 *
 * ⚠️ READ ONCE PER RUN, not per condition. A branch evaluating against a
 * contact that changed mid-run would take inconsistent paths on adjacent
 * conditions, which is impossible to reason about after the fact.
 */
export async function gatherFacts(
  workspaceId: string,
  contactId: string | null,
): Promise<Record<string, unknown>> {
  if (!contactId) return {}

  const { data, error } = await createAdminClient()
    .from('crm_contacts')
    .select('id, full_name, first_name, last_name, job_title, headline, location, owner_user_id, primary_company_id')
    .eq('workspace_id', workspaceId)
    .eq('id', contactId)
    .maybeSingle()

  /*
   * A failed contact query is NOT "no contact" — returning {} here would
   * make every is_empty condition on the run read TRUE, and a cold sequence
   * could enroll a contact and send outbound email because the database
   * hiccuped. The caller decides what a failed gather means; it never gets
   * facts it cannot trust.
   */
  if (error) throw new Error(`gatherFacts failed: ${error.message}`)
  if (!data) return {}

  const db = createAdminClient()

  /*
   * Up to six queries, one per domain. They are independent, so they run in
   * parallel; the company query runs only when there is a company to read, a
   * null `primary_company_id` is already the observed-absent answer. Errors
   * are per-domain: a failed query turns into `undefined`, which the builder
   * reads as could-not-observe and omits the whole domain — never a
   * fabricated zero. `data ?? []` turns a successful empty page into the
   * observed-empty shape the builder counts from.
   */
  const [company, opportunities, activities, tasks, messages, threads] = await Promise.all([
    data.primary_company_id
      ? db
          .from('crm_companies')
          .select('name, domain, industry, headquarters, employee_count, owner_user_id')
          .eq('workspace_id', workspaceId)
          .eq('id', data.primary_company_id)
          .is('deleted_at', null)
          .maybeSingle()
          .then((r) => (r.error ? undefined : (r.data ?? null)))
      : Promise.resolve(null),
    db
      .from('crm_opportunities')
      .select('status, title, value_amount, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('contact_id', contactId)
      .is('deleted_at', null)
      .then((r) => (r.error ? undefined : (r.data ?? []))),
    db
      .from('crm_activities')
      .select('activity_type, occurred_at')
      .eq('workspace_id', workspaceId)
      .eq('contact_id', contactId)
      .then((r) => (r.error ? undefined : (r.data ?? []))),
    db
      .from('crm_tasks')
      .select('status')
      .eq('workspace_id', workspaceId)
      .eq('contact_id', contactId)
      .is('deleted_at', null)
      .then((r) => (r.error ? undefined : (r.data ?? []))),
    db
      .from('email_messages')
      .select('status, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('contact_id', contactId)
      .then((r) => (r.error ? undefined : (r.data ?? []))),
    db
      .from('email_threads')
      .select('status, last_direction, last_message_at')
      .eq('workspace_id', workspaceId)
      .eq('contact_id', contactId)
      .then((r) => (r.error ? undefined : (r.data ?? []))),
  ])

  return buildDomainFacts({
    contact: data,
    company,
    opportunities,
    activities,
    tasks,
    messages,
    threads,
  })
}
