import 'server-only'

/**
 * Intake routing — §5, R12, F02.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE DATABASE DECIDES WHO GETS A LEAD; THIS FILE ANNOUNCES IT.            ║
 * ║                                                                           ║
 * ║  `crm_route_batch` (0127) takes the workspace lock, walks the published   ║
 * ║  rules in order, checks membership, availability and each rule's          ║
 * ║  workload cap, writes the OWNER_ASSIGNED activity through 0123, and       ║
 * ║  records every decision — including "nobody was eligible, and here is     ║
 * ║  why" — once per intake. None of that can be done safely here: counting   ║
 * ║  load in TypeScript and then assigning is the race #29 fixed.             ║
 * ║                                                                           ║
 * ║  What is left for TypeScript is the notification. `contact_assigned` is   ║
 * ║  emitted AFTER the transaction commits, one per NEW assignment, keyed on  ║
 * ║  the activity the function wrote — so an "on assigned" flow can task      ║
 * ║  whoever just received a routed lead, and a re-run import announces       ║
 * ║  nothing twice.                                                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ ONLY SYSTEM INTAKE IS ROUTED. A contact a member adds by hand belongs to
 * them (§5: "Creator ownership takes precedence for member-added records"), and
 * the function refuses `manual` intake outright.
 */
import { emitDomainEvent } from '@/lib/events/emit'
import { createAdminClient } from '@/lib/supabase/admin'

export type RoutingSummary = {
  /** Newly given an owner by a rule, or already given one by an earlier run of this batch. */
  assigned: number
  /** No rule matched, or nobody a rule named was eligible. Waiting in the Unassigned queue. */
  unassigned: number
  /** Already had an owner when routing ran, and kept them. */
  alreadyOwned: number
}

type BatchRouting = {
  assigned: number
  unassigned: number
  already_owned: number
  assignments: { contact_id: string; owner: string; activity_id: string }[]
}

/**
 * Announcements go out in small groups rather than one long sequence or one
 * unbounded burst: an import can place thousands of leads, and each event fans
 * out to flows, webhooks and notifications.
 */
const EVENT_CONCURRENCY = 20

export async function routeBatch(workspaceId: string, batchId: string): Promise<RoutingSummary> {
  const db = createAdminClient()
  const { data, error } = await db.rpc('crm_route_batch', {
    p_workspace_id: workspaceId,
    p_batch_id: batchId,
  })

  if (error) throw new Error(`routeBatch failed: ${error.message}`)

  const result = data as unknown as BatchRouting
  const assignments = result.assignments ?? []

  for (let i = 0; i < assignments.length; i += EVENT_CONCURRENCY) {
    await Promise.all(
      assignments.slice(i, i + EVENT_CONCURRENCY).map((a) =>
        emitDomainEvent({
          workspaceId,
          triggerType: 'contact_assigned',
          contactId: a.contact_id,
          // The activity is the occurrence: one routing decision, one event,
          // however many times the batch is routed again.
          idempotencyKey: `contact_assigned:${a.activity_id}`,
          payload: { contactId: a.contact_id, to: a.owner, by: 'routing' },
        }),
      ),
    )
  }

  return {
    assigned: result.assigned,
    unassigned: result.unassigned,
    alreadyOwned: result.already_owned,
  }
}
