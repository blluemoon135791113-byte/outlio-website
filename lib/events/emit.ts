import 'server-only'

/**
 * One domain event, fanned out to everything that listens — Phase 23.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  TWO EVENT SYSTEMS FIRE FROM THE SAME MOMENTS, AND ONLY ONE WAS WIRED.    ║
 * ║                                                                           ║
 * ║  `dispatchFlowTrigger` runs the customer's flows. `publishEvent` delivers  ║
 * ║  their webhooks. Six places in the product mean "a contact was created",   ║
 * ║  "a deal was won", "a reply arrived" — and every one of them called the    ║
 * ║  first and not the second.                                                ║
 * ║                                                                           ║
 * ║  So twelve webhook events were offered in Settings → Developers, the       ║
 * ║  delivery worker drained an empty queue every five minutes, and a customer ║
 * ║  who subscribed received silence. Nothing errored, because nothing had     ║
 * ║  gone wrong. Nothing had happened at all.                                  ║
 * ║                                                                           ║
 * ║  ⚠️ THE FIX IS NOT SIX REMEMBERED CALL SITES. That is the defect Phase 12  ║
 * ║  spent a phase removing — being metered depended on a caller remembering   ║
 * ║  to import the meter. The next person to add a domain event would wire one ║
 * ║  system and not the other, exactly as happened here. So there is one door, ║
 * ║  and `tests/unit/domain-event-boundary.test.ts` refuses the others.        ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { publishEvent } from '@/lib/api/webhooks'
import type { WebhookEvent } from '@/lib/api/signing'
import type { TriggerType } from '@/lib/flows/definition'
import { dispatchFlowTrigger, type DispatchResult } from '@/lib/flows/dispatch'

/**
 * Which webhook event a flow trigger corresponds to.
 *
 * ⚠️ PARTIAL ON PURPOSE, AND THE GAPS ARE NOT OVERSIGHTS. A trigger with no
 * entry has no public event by design — `call_booked` is Calendly's own
 * concern, and inventing `meeting.booked` here would publish an event whose
 * payload shape nobody has specified.
 *
 * The reverse gap is the honest one: `crm.contact.assigned`,
 * `email.message.sent`, `email.contact.unsubscribed` and the three `meeting.*`
 * events are in the catalogue with no dispatch point anywhere in the product.
 * They are still offered in Settings and still never fire. Wiring them needs a
 * source, not a line here.
 */
const WEBHOOK_FOR_TRIGGER: Partial<Record<TriggerType, WebhookEvent>> = {
  contact_created: 'crm.contact.created',
  stage_changed: 'crm.opportunity.stage_changed',
  opportunity_won: 'crm.opportunity.won',
  task_completed: 'crm.task.completed',
  email_replied: 'email.message.replied',
  email_bounced: 'email.message.bounced',
}

export type EmitResult = {
  flow: DispatchResult
  /** Deliveries queued — 0 when nobody subscribes, which is not a failure. */
  webhooksQueued: number
}

/**
 * Announces that something happened, to the flow engine and to subscribers.
 *
 * ⚠️ NEITHER SIDE MAY SINK THE OTHER, AND NEITHER MAY SINK THE CALLER. This is
 * invoked from the middle of business operations. A broken webhook endpoint
 * must not stop a flow from running; a flow that cannot start must not swallow
 * a customer's webhook; and neither must roll back the contact that was
 * created. Both are awaited separately and both already refuse to throw —
 * `dispatchFlowTrigger` catches internally, `publishEvent` logs and returns 0 —
 * so the `catch` here is the belt to their braces, not the only guard.
 */
export async function emitDomainEvent(input: {
  workspaceId: string
  triggerType: TriggerType
  contactId?: string | null
  /**
   * ⚠️ DETERMINISTIC PER OCCURRENCE. `startRun` de-duplicates flow runs on this
   * so a retry cannot run someone through a flow twice. See the webhook caveat
   * below — the same protection does not exist on the publish side.
   */
  idempotencyKey: string
  /**
   * What subscribers receive. Defaults to the contact id alone: a webhook body
   * leaves our system, so it carries what the event is ABOUT rather than
   * everything we happen to know.
   */
  payload?: Record<string, unknown>
}): Promise<EmitResult> {
  const flow = await dispatchFlowTrigger({
    workspaceId: input.workspaceId,
    triggerType: input.triggerType,
    contactId: input.contactId,
    idempotencyKey: input.idempotencyKey,
  })

  const event = WEBHOOK_FOR_TRIGGER[input.triggerType]
  if (!event) return { flow, webhooksQueued: 0 }

  /*
   * ⚠️ NOT IDEMPOTENT, AND THAT IS A PROPERTY OF THE RPC, NOT A CHOICE MADE
   * HERE. `enqueue_webhook_delivery(workspace, event_type, payload)` takes no
   * idempotency key, so a business operation retried at this point publishes
   * twice while the flow side de-duplicates. `webhook_deliveries.event_id` is
   * stable across RETRIES OF ONE DELIVERY — it is what makes a consumer able to
   * dedupe a redelivery — and does not span two separate publishes.
   *
   * Left as-is deliberately: closing it means a schema change to a table that
   * has never carried a row, and inventing a key shape before anyone has been
   * double-delivered would be guessing at the grain. Recorded in PHASE_23.md.
   */
  let webhooksQueued = 0
  try {
    webhooksQueued = await publishEvent(
      input.workspaceId,
      event,
      input.payload ?? { contactId: input.contactId ?? null },
    )
  } catch (error) {
    console.error('[events] webhook publish failed', {
      workspaceId: input.workspaceId,
      event,
      message: error instanceof Error ? error.message : 'unknown',
    })
  }

  return { flow, webhooksQueued }
}

/** The mapping, for tests and for the settings screen that documents it. */
export function webhookEventForTrigger(trigger: TriggerType): WebhookEvent | null {
  return WEBHOOK_FOR_TRIGGER[trigger] ?? null
}
