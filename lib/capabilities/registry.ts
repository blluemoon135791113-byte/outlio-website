/**
 * The capability registry — Phase 12.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ONE CLOSED SET OF EVERYTHING THE PRODUCT CAN DO ON A CUSTOMER'S BEHALF,  ║
 * ║  EACH ENTRY SAYING WHETHER IT CALLS A MODEL AND WHAT THAT COSTS.          ║
 * ║                                                                           ║
 * ║  Build contract §5.11: "Deterministic actions never touch the ledger —    ║
 * ║  enforced by the capability registry's `is_ai` flag, not by convention."  ║
 * ║                                                                           ║
 * ║  Convention is what failed. `lib/hubble/execute.ts` metered correctly,    ║
 * ║  and being metered depended on a caller remembering to import it; three   ║
 * ║  HTTP routes did not. So the flag lives here, the price lives here, and   ║
 * ║  `hubbleExecute` refuses anything this file does not name.                ║
 * ║                                                                           ║
 * ║  ⚠️ VERSIONED; DEPRECATED, NEVER DELETED (§5.10). A published flow pins   ║
 * ║  the ids it was compiled against. Removing an entry would make a stored   ║
 * ║  definition unreadable; marking it `deprecated` keeps it readable and     ║
 * ║  lets a validator warn. `tests/unit/capability-registry.test.ts` refuses  ║
 * ║  a deletion.                                                              ║
 * ║                                                                           ║
 * ║  ⚠️ PURE. No `server-only`, no database — the flow editor renders prices  ║
 * ║  from this file in the browser while a step is being edited.              ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import type { Permission } from '@/lib/workspaces/permissions'

/** Bumped when an entry is added or deprecated. Never when one is edited in place. */
export const CAPABILITY_REGISTRY_VERSION = 2

export type CapabilityStatus = 'active' | 'deprecated'

type CapabilityBase = {
  /** Permission the caller must hold. Declared here; enforced where the call enters. */
  permission: Permission
  status: CapabilityStatus
  /** Registry version that introduced the entry. */
  since: number
  /** The flow action that performs this capability, when one does. */
  flowAction?: string
}

export type DeterministicCapability = CapabilityBase & {
  isAi: false
  /** Zero by construction, not by choice: a deterministic step never reaches the ledger. */
  credits: 0
}

export type AiCapability = CapabilityBase & {
  isAi: true
  /** Shown to the customer next to the step, so it is a human phrase. */
  label: string
} & (
    | { credits: number }
    /**
     * ⚠️ AN UNPRICED CAPABILITY IS A REFUSAL, NOT A FREE CALL. `hubbleExecute`
     * will not run it. The entry exists so the closed set is honest about what
     * the product does, while the number stays with the person whose decision
     * it is — named here so the test can check the decision is still open.
     */
    | { credits: null; pricingDecision: string }
  )

export type Capability = DeterministicCapability | AiCapability

export const CAPABILITIES = {
  // --- Deterministic flow actions. Free, every one. ---------------------------
  'flow.assign_owner': { isAi: false, credits: 0, permission: 'flow.manage', status: 'active', since: 1, flowAction: 'ASSIGN_OWNER' },
  'flow.round_robin': { isAi: false, credits: 0, permission: 'flow.manage', status: 'active', since: 1, flowAction: 'ROUND_ROBIN' },
  'flow.create_task': { isAi: false, credits: 0, permission: 'flow.manage', status: 'active', since: 1, flowAction: 'CREATE_TASK' },
  'flow.move_stage': { isAi: false, credits: 0, permission: 'flow.manage', status: 'active', since: 1, flowAction: 'MOVE_STAGE' },
  'flow.update_field': { isAi: false, credits: 0, permission: 'flow.manage', status: 'active', since: 1, flowAction: 'UPDATE_FIELD' },
  'flow.add_tag': { isAi: false, credits: 0, permission: 'flow.manage', status: 'active', since: 1, flowAction: 'ADD_TAG' },
  'flow.remove_tag': { isAi: false, credits: 0, permission: 'flow.manage', status: 'active', since: 1, flowAction: 'REMOVE_TAG' },
  'flow.add_to_list': { isAi: false, credits: 0, permission: 'flow.manage', status: 'active', since: 1, flowAction: 'ADD_TO_LIST' },
  'flow.remove_from_list': { isAi: false, credits: 0, permission: 'flow.manage', status: 'active', since: 1, flowAction: 'REMOVE_FROM_LIST' },
  'flow.create_opportunity': { isAi: false, credits: 0, permission: 'flow.manage', status: 'active', since: 1, flowAction: 'CREATE_OPPORTUNITY' },
  'flow.create_activity': { isAi: false, credits: 0, permission: 'flow.manage', status: 'active', since: 1, flowAction: 'CREATE_ACTIVITY' },
  'flow.notify': { isAi: false, credits: 0, permission: 'flow.manage', status: 'active', since: 1, flowAction: 'NOTIFY' },
  'flow.dedupe_check': { isAi: false, credits: 0, permission: 'flow.manage', status: 'active', since: 1, flowAction: 'DEDUPE_CHECK' },
  'flow.date_calc': { isAi: false, credits: 0, permission: 'flow.manage', status: 'active', since: 1, flowAction: 'DATE_CALC' },
  'flow.text_transform': { isAi: false, credits: 0, permission: 'flow.manage', status: 'active', since: 1, flowAction: 'TEXT_TRANSFORM' },
  'flow.webhook': { isAi: false, credits: 0, permission: 'flow.manage', status: 'active', since: 1, flowAction: 'WEBHOOK' },
  'flow.enroll_sequence': { isAi: false, credits: 0, permission: 'flow.manage', status: 'active', since: 1, flowAction: 'ENROLL_SEQUENCE' },
  'flow.remove_sequence': { isAi: false, credits: 0, permission: 'flow.manage', status: 'active', since: 1, flowAction: 'REMOVE_SEQUENCE' },
  'flow.pause_sequence': { isAi: false, credits: 0, permission: 'flow.manage', status: 'active', since: 1, flowAction: 'PAUSE_SEQUENCE' },
  'flow.resume_sequence': { isAi: false, credits: 0, permission: 'flow.manage', status: 'active', since: 1, flowAction: 'RESUME_SEQUENCE' },
  'flow.create_email_task': { isAi: false, credits: 0, permission: 'flow.manage', status: 'active', since: 1, flowAction: 'CREATE_EMAIL_TASK' },
  /*
   * The one deterministic action whose permission is not `flow.manage`:
   * `publishFlow` stamps `actorAuthorized` from `email.campaign.launch`, and
   * the send gate refuses without it. The registry names the same permission
   * so the two cannot drift apart unnoticed.
   */
  'flow.send_email': { isAi: false, credits: 0, permission: 'email.campaign.launch', status: 'active', since: 1, flowAction: 'SEND_EMAIL' },

  // --- AI flow steps. Priced since M7 Phase 22; the numbers are unchanged. ----
  'hubble.icp_score': { isAi: true, credits: 1, label: 'Score against your ICP', permission: 'hubble.use', status: 'active', since: 1, flowAction: 'HUBBLE_ICP_SCORE' },
  'hubble.research': { isAi: true, credits: 3, label: 'Research this company', permission: 'hubble.use', status: 'active', since: 1, flowAction: 'HUBBLE_RESEARCH' },
  'hubble.classification': { isAi: true, credits: 1, label: 'Classify', permission: 'hubble.use', status: 'active', since: 1, flowAction: 'HUBBLE_CLASSIFY' },
  'hubble.personalization': { isAi: true, credits: 2, label: 'Personalise this message', permission: 'hubble.use', status: 'active', since: 1, flowAction: 'HUBBLE_PERSONALIZE' },
  'hubble.reply_draft': { isAi: true, credits: 2, label: 'Draft a reply', permission: 'hubble.use', status: 'active', since: 1, flowAction: 'HUBBLE_REPLY_DRAFT' },
  'hubble.response_classification': { isAi: true, credits: 1, label: 'Classify this reply', permission: 'hubble.use', status: 'active', since: 1, flowAction: 'HUBBLE_CLASSIFY_REPLY' },
  'hubble.account_summary': { isAi: true, credits: 2, label: 'Summarise this account', permission: 'hubble.use', status: 'active', since: 1, flowAction: 'HUBBLE_ACCOUNT_SUMMARY' },

  /*
   * --- AI reached over HTTP. Priced 2026-09-08 (DECISION-16, first half). -----
   *
   * ⚠️ METER AT 0: RECORD THE SPEND, CHARGE NOTHING. These three served the
   * four routes Phase 12 found calling a model with no credit context. The
   * number is deliberately zero so `hubble_calls` fills with real rows before
   * a real price is chosen — a price picked over an empty ledger is a guess.
   * Flow parity for reference: `ask` would be 3, `clarify` 1.
   *
   * The routes now enter through `hubbleExecute`, so the boundary test's
   * exemption list is empty and stays empty. Raising a price here is a
   * one-line change with an audit trail in this file's history.
   */
  'hubble.ask': { isAi: true, credits: 0, label: 'Ask Hubble', permission: 'hubble.use', status: 'active', since: 2 },
  'intelligence.plan': { isAi: true, credits: 0, label: 'Plan a research query', permission: 'hubble.use', status: 'active', since: 2 },
  'intelligence.summarize': { isAi: true, credits: 0, label: 'Summarise a research run', permission: 'hubble.use', status: 'active', since: 2 },
} as const satisfies Record<string, Capability>

export type CapabilityId = keyof typeof CAPABILITIES

export type AiCapabilityId = {
  [K in CapabilityId]: (typeof CAPABILITIES)[K] extends { isAi: true } ? K : never
}[CapabilityId]

/** AI capabilities a flow step can perform. The `HubbleTask` of `lib/hubble/pricing.ts`. */
export type AiFlowCapabilityId = {
  [K in CapabilityId]: (typeof CAPABILITIES)[K] extends { isAi: true; flowAction: string } ? K : never
}[CapabilityId]

export const CAPABILITY_IDS = Object.keys(CAPABILITIES) as CapabilityId[]

export function isCapabilityId(value: string): value is CapabilityId {
  return Object.prototype.hasOwnProperty.call(CAPABILITIES, value)
}

export function capability(id: CapabilityId): Capability {
  return CAPABILITIES[id]
}

/** Every AI capability, priced or not. */
export function aiCapabilityIds(): AiCapabilityId[] {
  return CAPABILITY_IDS.filter((id): id is AiCapabilityId => CAPABILITIES[id].isAi)
}

const BY_FLOW_ACTION: ReadonlyMap<string, CapabilityId> = new Map(
  CAPABILITY_IDS.flatMap((id) => {
    const action = (CAPABILITIES[id] as Capability).flowAction
    return action ? [[action, id] as const] : []
  }),
)

/**
 * The capability behind a flow action.
 *
 * ⚠️ THROWS FOR AN UNREGISTERED ACTION, AT MODULE LOAD. `lib/flows/definition.ts`
 * derives `costsCredits` from this, so an action added to the catalogue without
 * a registry entry breaks every import of the flow definition — loudly, in the
 * first test that runs — instead of defaulting to free.
 */
export function capabilityForFlowAction(action: string): Capability & { id: CapabilityId } {
  const id = BY_FLOW_ACTION.get(action)
  if (!id) {
    throw new Error(
      `Flow action "${action}" has no entry in lib/capabilities/registry.ts. Every action must say whether it calls a model.`,
    )
  }
  return { id, ...CAPABILITIES[id] }
}

/** The Hubble task a flow action performs, or `null` for a deterministic action. */
export function hubbleTaskForAction(action: string): AiFlowCapabilityId | null {
  const id = BY_FLOW_ACTION.get(action)
  if (!id || !CAPABILITIES[id].isAi) return null
  return id as AiFlowCapabilityId
}
