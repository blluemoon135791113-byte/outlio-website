import 'server-only'

/**
 * The metric catalogue — R7.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ A WIDGET NAMES A KEY IN HERE. IT NEVER CARRIES A QUERY.              ║
 * ║                                                                           ║
 * ║  The tempting design stores SQL on the widget, or a table plus a column   ║
 * ║  plus an aggregate. Both hand a customer a way to read tables the         ║
 * ║  permission layer never approved — "count rows in `email_account_secrets` ║
 * ║  grouped by workspace" is a perfectly well-formed request under that      ║
 * ║  design — and both break silently the day a column is renamed.            ║
 * ║                                                                           ║
 * ║  Every metric here states its own table, its own scoping, and its own     ║
 * ║  permission. A dashboard can only ever ask for something on this list.    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { createAdminClient } from '@/lib/supabase/admin'
import type { Permission } from '@/lib/workspaces/permissions'

export type MetricValue = {
  /** ⚠️ NULL means "not known", never zero. See the note on `compute`. */
  value: number | null
  /** What a bar or bullet fills against, when the metric has a natural total. */
  outOf?: number | null
  /** Rendered next to the number: '%', a currency code, or nothing. */
  unit?: string
}

export type MetricDefinition = {
  key: string
  label: string
  /** What it counts, in the words someone would use to ask for it. */
  description: string
  /** Grouped in the picker so a long list stays navigable. */
  source: 'Contacts' | 'Deals' | 'Tasks' | 'Email' | 'Activity'
  /** Nobody may add a widget they could not otherwise see the data for. */
  permission: Permission
  /** Visuals that suit this metric. The first is the default. */
  visuals: ('stat' | 'bar' | 'bullet' | 'list')[]
  compute: (input: {
    workspaceId: string
    /** Set when the viewer is scoped to their own records. */
    ownerUserId: string | null
    sinceDays: number
  }) => Promise<MetricValue>
}

const since = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

/** Counts rows, applying the owner filter when the viewer is scoped. */
async function countScoped(
  table: 'crm_contacts' | 'crm_opportunities',
  input: { workspaceId: string; ownerUserId: string | null; sinceDays?: number },
): Promise<number> {
  let query = createAdminClient()
    .from(table)
    .select('id', { count: 'exact', head: true })
    // Scoped by workspace in code — the service role bypasses RLS.
    .eq('workspace_id', input.workspaceId)
    .is('deleted_at', null)

  /*
   * ⚠️ THE SAME `dataScope` RULE AS EVERY OTHER SURFACE. A setter who adds a
   * "total contacts" widget must see THEIR total, not the company's — a
   * dashboard is not a way around the permission layer.
   */
  if (input.ownerUserId) query = query.eq('owner_user_id', input.ownerUserId)
  if (input.sinceDays) query = query.gte('created_at', since(input.sinceDays))

  const { count } = await query
  return count ?? 0
}

export const METRICS: MetricDefinition[] = [
  {
    key: 'contacts.total',
    label: 'Contacts',
    description: 'Everyone in the CRM right now.',
    source: 'Contacts',
    permission: 'crm.contact.view',
    visuals: ['stat'],
    compute: async (input) => ({ value: await countScoped('crm_contacts', input) }),
  },
  {
    key: 'contacts.added',
    label: 'Contacts added',
    description: 'New people in the CRM during the period.',
    source: 'Contacts',
    permission: 'crm.contact.view',
    visuals: ['stat'],
    compute: async (input) => ({
      value: await countScoped('crm_contacts', { ...input, sinceDays: input.sinceDays }),
    }),
  },
  {
    key: 'deals.open',
    label: 'Open deals',
    description: 'Deals still in play, in any pipeline.',
    source: 'Deals',
    permission: 'crm.opportunity.view',
    visuals: ['stat'],
    compute: async (input) => {
      let query = createAdminClient()
        .from('crm_opportunities')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', input.workspaceId)
        .eq('status', 'open')
      if (input.ownerUserId) query = query.eq('owner_user_id', input.ownerUserId)
      const { count } = await query
      return { value: count ?? 0 }
    },
  },
  {
    key: 'deals.pipeline_value',
    label: 'Pipeline value',
    description: 'Total value of open deals. Deals with no value are excluded.',
    source: 'Deals',
    permission: 'crm.opportunity.view',
    visuals: ['stat'],
    compute: async (input) => {
      let query = createAdminClient()
        .from('crm_opportunities')
        .select('value_amount, currency')
        .eq('workspace_id', input.workspaceId)
        .eq('status', 'open')
        .not('value_amount', 'is', null)
      if (input.ownerUserId) query = query.eq('owner_user_id', input.ownerUserId)

      const { data } = await query
      const rows = data ?? []

      /*
       * ⚠️ NO DEALS WITH A VALUE IS "NOT KNOWN", NOT ZERO. A pipeline showing
       * £0 reads as "we have nothing on"; the truth may be twelve deals nobody
       * has priced. Same rule the forecast follows.
       */
      if (rows.length === 0) return { value: null }

      return {
        value: rows.reduce((sum, r) => sum + Number(r.value_amount ?? 0), 0),
        unit: rows[0]?.currency ?? 'USD',
      }
    },
  },
  {
    key: 'deals.won',
    label: 'Deals won',
    description: 'Deals closed as won during the period.',
    source: 'Deals',
    permission: 'crm.opportunity.view',
    visuals: ['stat'],
    compute: async (input) => {
      let query = createAdminClient()
        .from('crm_opportunities')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', input.workspaceId)
        .eq('status', 'won')
        .gte('updated_at', since(input.sinceDays))
      if (input.ownerUserId) query = query.eq('owner_user_id', input.ownerUserId)
      const { count } = await query
      return { value: count ?? 0 }
    },
  },
  {
    key: 'deals.win_rate',
    label: 'Win rate',
    description: 'Won as a share of everything closed in the period.',
    source: 'Deals',
    permission: 'crm.opportunity.view',
    visuals: ['bullet', 'stat'],
    compute: async (input) => {
      const db = createAdminClient()
      const base = () => {
        let q = db
          .from('crm_opportunities')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', input.workspaceId)
          .gte('updated_at', since(input.sinceDays))
        if (input.ownerUserId) q = q.eq('owner_user_id', input.ownerUserId)
        return q
      }

      const [{ count: won }, { count: lost }] = await Promise.all([
        base().eq('status', 'won'),
        base().eq('status', 'lost'),
      ])

      const closed = (won ?? 0) + (lost ?? 0)
      /*
       * ⚠️ A RATE OVER NOTHING IS UNKNOWN. 0% would tell someone their team
       * loses everything, when in fact nothing has closed yet.
       */
      if (closed === 0) return { value: null, unit: '%' }

      return { value: Math.round(((won ?? 0) / closed) * 100), outOf: 100, unit: '%' }
    },
  },
  {
    key: 'tasks.open',
    label: 'Open tasks',
    description: 'Work still to be done.',
    source: 'Tasks',
    permission: 'crm.task.view',
    visuals: ['stat'],
    compute: async (input) => {
      let query = createAdminClient()
        .from('crm_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', input.workspaceId)
        .eq('status', 'open')
        .is('deleted_at', null)
      // Tasks are ASSIGNED, not owned — a different column, same rule.
      if (input.ownerUserId) query = query.eq('assigned_to_user_id', input.ownerUserId)
      const { count } = await query
      return { value: count ?? 0 }
    },
  },
  {
    key: 'tasks.overdue',
    label: 'Overdue tasks',
    description: 'Past their due date and still open. Undated tasks never count.',
    source: 'Tasks',
    permission: 'crm.task.view',
    visuals: ['stat'],
    compute: async (input) => {
      let query = createAdminClient()
        .from('crm_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', input.workspaceId)
        .eq('status', 'open')
        .is('deleted_at', null)
        // A task with no due date is undated, not late.
        .not('due_at', 'is', null)
        .lt('due_at', new Date().toISOString())
      if (input.ownerUserId) query = query.eq('assigned_to_user_id', input.ownerUserId)
      const { count } = await query
      return { value: count ?? 0 }
    },
  },
  {
    key: 'email.sent',
    label: 'Emails sent',
    description: 'Messages that actually left a mailbox during the period.',
    source: 'Email',
    permission: 'email.campaign.view',
    visuals: ['stat'],
    compute: async (input) => {
      const { count } = await createAdminClient()
        .from('email_messages')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', input.workspaceId)
        .eq('status', 'sent')
        .gte('created_at', since(input.sinceDays))
      /*
       * ⚠️ NOT OWNER-SCOPED, AND THAT IS DELIBERATE. A mailbox belongs to the
       * workspace, and `email_messages` has no owner column to filter on.
       * Inventing one by joining through the contact would report a different
       * number from the Email module's own analytics for the same period, and
       * two disagreeing figures are worse than one honest workspace-wide one.
       */
      return { value: count ?? 0 }
    },
  },
  {
    key: 'email.replies',
    label: 'Replies',
    description: 'Genuine replies received. Auto-replies and bounces are excluded.',
    source: 'Email',
    permission: 'email.inbox.view',
    visuals: ['stat'],
    compute: async (input) => {
      const { count } = await createAdminClient()
        .from('email_inbound_messages')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', input.workspaceId)
        // The classification the reply-sync pipeline already decided.
        .eq('classification', 'reply')
        .gte('received_at', since(input.sinceDays))
      return { value: count ?? 0 }
    },
  },
]

export function metric(key: string): MetricDefinition | null {
  return METRICS.find((m) => m.key === key) ?? null
}

/** Grouped for the picker. */
export function metricsBySource(): Record<string, MetricDefinition[]> {
  const grouped: Record<string, MetricDefinition[]> = {}
  for (const m of METRICS) {
    grouped[m.source] = [...(grouped[m.source] ?? []), m]
  }
  return grouped
}
