import 'server-only'

/**
 * Turning domain events into flow runs — R8.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  SEVENTEEN TRIGGER TYPES. ONE OF THEM EVER FIRED.                        ║
 * ║                                                                           ║
 * ║  `startRun` had exactly one caller outside the engine — Calendly's        ║
 * ║  `call_booked`. Every other trigger was declared in the schema, accepted  ║
 * ║  by the validator, offered in the builder and PUBLISHABLE, and nothing    ║
 * ║  in the product ever started a run for it.                                ║
 * ║                                                                           ║
 * ║  So a customer could build a flow, publish it, watch it sit at "published"║
 * ║  and never run — with no error anywhere, because nothing had gone wrong.  ║
 * ║  Nothing had happened at all.                                             ║
 * ║                                                                           ║
 * ║  Same shape as R10's dead workers: correct code, unreachable.             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { startRun } from '@/lib/flows/engine'
import { createAdminClient } from '@/lib/supabase/admin'
import type { TriggerType } from '@/lib/flows/definition'

export type DispatchResult = {
  matched: number
  started: number
  skipped: number
}

/**
 * Starts every published flow whose trigger matches this event.
 *
 * ⚠️ NEVER THROWS INTO ITS CALLER. This is invoked from the middle of business
 * operations — creating a contact, recording a reply, moving a deal. A flow
 * that cannot start must not roll back the thing that happened: the reply was
 * still received and the deal still moved. Failures are logged and counted.
 */
export async function dispatchFlowTrigger(input: {
  workspaceId: string
  triggerType: TriggerType
  contactId?: string | null
  /**
   * ⚠️ DETERMINISTIC PER OCCURRENCE, NOT PER CALL. `startRun` de-duplicates on
   * this, so it is what stops a retried webhook or a double-clicked button
   * from running someone through the same flow twice. A random value here
   * would make the guarantee meaningless.
   */
  idempotencyKey: string
}): Promise<DispatchResult> {
  const result: DispatchResult = { matched: 0, started: 0, skipped: 0 }

  try {
    const db = createAdminClient()

    /*
     * Only published flows, and only in this workspace. A draft must never
     * run — that is the whole meaning of draft, and someone reviewing a
     * template would otherwise set it loose by opening it.
     */
    const { data: flows } = await db
      .from('flows')
      .select('id, published_version_id, flow_versions!flows_published_version_fk(definition)')
      .eq('workspace_id', input.workspaceId)
      .eq('status', 'published')
      .is('deleted_at', null)
      .not('published_version_id', 'is', null)

    for (const flow of flows ?? []) {
      const version = flow.flow_versions as { definition: unknown } | null
      const definition = version?.definition as { trigger?: { type?: string } } | undefined

      if (definition?.trigger?.type !== input.triggerType) continue
      result.matched += 1

      try {
        const started = await startRun({
          workspaceId: input.workspaceId,
          flowId: flow.id,
          triggerType: input.triggerType,
          contactId: input.contactId ?? null,
          // Scoped to the flow as well as the event: two flows on the same
          // trigger are two runs, not one.
          idempotencyKey: `${input.idempotencyKey}:${flow.id}`,
        })

        if (started.started) result.started += 1
        else result.skipped += 1
      } catch (error) {
        /*
         * ⚠️ ONE BROKEN FLOW MUST NOT STOP THE OTHERS, and must not stop the
         * business operation that triggered it.
         */
        result.skipped += 1
        console.error('[flow-dispatch] a flow failed to start', {
          triggerType: input.triggerType,
          message: error instanceof Error ? error.message : 'failed',
        })
      }
    }
  } catch (error) {
    // Logged without the payload — never a contact record or a message body.
    console.error('[flow-dispatch] dispatch failed', {
      triggerType: input.triggerType,
      message: error instanceof Error ? error.message : 'failed',
    })
  }

  return result
}
