/**
 * The Flow Copilot evaluation corpus — §5.10's "≥30-prompt eval corpus".
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ A CORPUS OF ONLY-SUCCESSFUL CASES MEASURES NOTHING THAT MATTERS.      ║
 * ║                                                                           ║
 * ║  The copilot's dangerous failure is not "it could not build a flow" — it   ║
 * ║  is a flow that LOOKS right and quietly does something else: a condition   ║
 * ║  on a fact Outlio cannot observe, an action nobody asked for, a branch     ║
 * ║  with both arms going the same way.                                       ║
 * ║                                                                           ║
 * ║  So roughly a third of these are REFUSAL cases: requests that cannot be    ║
 * ║  expressed with what exists. A model that satisfies them has invented      ║
 * ║  something, and a corpus that never asks for the impossible would score    ║
 * ║  that model perfectly.                                                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ EVERY EXPECTATION HERE IS CHECKED AGAINST THE LIVE SNAPSHOT by
 * `tests/unit/flow-copilot-corpus.test.ts`, offline and free. A corpus that
 * expects `ADD_TAG` after `ADD_TAG` is renamed would quietly score every model
 * as failing, and the fault would look like the model's.
 */
import type { ActionType, TriggerType } from '@/lib/flows/definition'

export type EvalCase = {
  /** Stable id, so a regression can be pointed at. */
  id: string
  prompt: string
} & (
  | {
      outcome: 'flow'
      trigger: TriggerType
      /** Actions the flow is wrong without. */
      mustUse: readonly ActionType[]
      /** Actions whose presence means it did something unasked. */
      mustNotUse?: readonly ActionType[]
      /** True when the request genuinely needs a conditional. */
      needsBranch?: boolean
      /** True when the request genuinely needs a delay. */
      needsWait?: boolean
    }
  | {
      outcome: 'refusal'
      /** What is absent from the snapshot. Named, so the case cannot rot into vagueness. */
      because: string
    }
)

export const CORPUS: readonly EvalCase[] = [
  /* ── Single action, unambiguous. The floor. ──────────────────────────────── */
  {
    id: 'tag-new-contact',
    prompt: 'When a new contact is created, tag them as "new lead".',
    outcome: 'flow',
    trigger: 'contact_created',
    mustUse: ['ADD_TAG'],
    mustNotUse: ['SEND_EMAIL'],
  },
  {
    id: 'assign-new-contact',
    prompt: 'Assign every newly created contact to the round robin.',
    outcome: 'flow',
    trigger: 'contact_created',
    mustUse: ['ROUND_ROBIN'],
  },
  {
    id: 'task-on-reply',
    prompt: 'When someone replies to an email, create a task to follow up.',
    outcome: 'flow',
    trigger: 'email_replied',
    mustUse: ['CREATE_TASK'],
  },
  {
    id: 'log-activity-on-booking',
    prompt: 'When a call is booked, log an activity on the contact.',
    outcome: 'flow',
    trigger: 'call_booked',
    mustUse: ['CREATE_ACTIVITY'],
  },
  {
    id: 'tag-on-won',
    prompt: 'Tag the contact as "customer" when an opportunity is won.',
    outcome: 'flow',
    trigger: 'opportunity_won',
    mustUse: ['ADD_TAG'],
  },
  {
    id: 'notify-on-won',
    prompt: 'Notify the team whenever we win a deal.',
    outcome: 'flow',
    trigger: 'opportunity_won',
    mustUse: ['NOTIFY'],
  },
  {
    id: 'list-add-tag',
    prompt: 'When a contact is added to a list, tag them "listed".',
    outcome: 'flow',
    trigger: 'list_added',
    mustUse: ['ADD_TAG'],
  },
  {
    id: 'webhook-create-task',
    prompt: 'When our webhook fires, create a task for the owner to review it.',
    outcome: 'flow',
    trigger: 'webhook',
    mustUse: ['CREATE_TASK'],
  },
  {
    id: 'manual-tag',
    prompt: 'Let me run this by hand to tag a contact as "vip".',
    outcome: 'flow',
    trigger: 'manual',
    mustUse: ['ADD_TAG'],
  },
  {
    id: 'bounce-remove-from-list',
    prompt: 'If an email bounces, take that contact off the active list.',
    outcome: 'flow',
    trigger: 'email_bounced',
    mustUse: ['REMOVE_FROM_LIST'],
  },
  {
    id: 'unsubscribe-tag',
    prompt: 'When someone unsubscribes, tag them "do not contact".',
    outcome: 'flow',
    trigger: 'email_unsubscribed',
    mustUse: ['ADD_TAG'],
    /*
     * ⚠️ MUST NOT MAIL SOMEONE WHO JUST UNSUBSCRIBED. The obvious wrong answer
     * is a courteous confirmation email, and it is the one output here that
     * would be a compliance problem rather than a bug.
     */
    mustNotUse: ['SEND_EMAIL', 'ENROLL_SEQUENCE'],
  },

  /* ── Multi-step, order matters. ──────────────────────────────────────────── */
  {
    id: 'tag-then-assign',
    prompt: 'When a contact is created, tag them "inbound" and then assign them to an owner.',
    outcome: 'flow',
    trigger: 'contact_created',
    mustUse: ['ADD_TAG', 'ASSIGN_OWNER'],
  },
  {
    id: 'stage-change-task-and-activity',
    prompt: 'When a deal moves stage, log an activity and create a task to review it.',
    outcome: 'flow',
    trigger: 'stage_changed',
    mustUse: ['CREATE_ACTIVITY', 'CREATE_TASK'],
  },
  {
    id: 'assigned-notify-and-task',
    prompt: 'When a contact is assigned to someone, notify them and create a task to make first contact.',
    outcome: 'flow',
    trigger: 'contact_assigned',
    mustUse: ['NOTIFY', 'CREATE_TASK'],
  },
  {
    id: 'task-completed-move-stage',
    prompt: 'When a task is completed, move the opportunity to the next stage and log it.',
    outcome: 'flow',
    trigger: 'task_completed',
    mustUse: ['MOVE_STAGE', 'CREATE_ACTIVITY'],
  },
  {
    id: 'batch-tag-and-list',
    prompt: 'When a batch of contacts is added, tag them "imported" and add them to the nurture list.',
    outcome: 'flow',
    trigger: 'batch_added',
    mustUse: ['ADD_TAG', 'ADD_TO_LIST'],
  },

  /* ── Needs a WAIT. ───────────────────────────────────────────────────────── */
  {
    id: 'wait-then-task',
    prompt: 'When a contact is created, wait three days and then create a task to check in.',
    outcome: 'flow',
    trigger: 'contact_created',
    mustUse: ['CREATE_TASK'],
    needsWait: true,
  },
  {
    id: 'no-activity-followup',
    prompt: 'If a contact has had no activity, wait a week and then create a follow-up task.',
    outcome: 'flow',
    trigger: 'no_activity',
    mustUse: ['CREATE_TASK'],
    needsWait: true,
  },
  {
    id: 'scheduled-weekly-review',
    prompt: 'On a schedule, wait a day and then create a review task.',
    outcome: 'flow',
    trigger: 'scheduled',
    mustUse: ['CREATE_TASK'],
    needsWait: true,
  },

  /* ── Needs a BRANCH on a fact that genuinely exists. ─────────────────────── */
  {
    id: 'branch-on-job-title',
    prompt: 'When a contact is created, if they have a job title tag them "qualified", otherwise tag them "needs research".',
    outcome: 'flow',
    trigger: 'contact_created',
    mustUse: ['ADD_TAG'],
    needsBranch: true,
  },
  {
    id: 'branch-on-company',
    prompt: 'When a contact is created, only assign an owner if we know their company name.',
    outcome: 'flow',
    trigger: 'contact_created',
    mustUse: ['ASSIGN_OWNER'],
    needsBranch: true,
  },
  {
    id: 'branch-on-location',
    prompt: 'Tag new contacts "local" when their location is exactly London.',
    outcome: 'flow',
    trigger: 'contact_created',
    mustUse: ['ADD_TAG'],
    needsBranch: true,
  },

  /* ── Sequence and field operations. ──────────────────────────────────────── */
  {
    id: 'enroll-on-created',
    prompt: 'Enrol newly created contacts into the welcome sequence.',
    outcome: 'flow',
    trigger: 'contact_created',
    mustUse: ['ENROLL_SEQUENCE'],
  },
  {
    id: 'pause-sequence-on-reply',
    prompt: 'When someone replies, pause their sequence so we stop mailing them.',
    outcome: 'flow',
    trigger: 'email_replied',
    mustUse: ['PAUSE_SEQUENCE'],
    /*
     * ⚠️ THE WRONG ANSWER IS REMOVE_SEQUENCE, and it is wrong in a way that is
     * hard to see afterwards: pausing is reversible, removing loses where they
     * had got to. A model that "helpfully" removes has destroyed state nobody
     * asked it to touch.
     */
    mustNotUse: ['REMOVE_SEQUENCE'],
  },
  {
    id: 'remove-tag-on-won',
    prompt: 'When we win a deal, remove the "prospect" tag.',
    outcome: 'flow',
    trigger: 'opportunity_won',
    mustUse: ['REMOVE_TAG'],
  },
  {
    id: 'update-field-on-stage',
    prompt: 'When a deal changes stage, update a field on the contact to record it.',
    outcome: 'flow',
    trigger: 'stage_changed',
    mustUse: ['UPDATE_FIELD'],
  },
  {
    id: 'dedupe-on-batch',
    prompt: 'When a batch is added, check for duplicates before anything else.',
    outcome: 'flow',
    trigger: 'batch_added',
    mustUse: ['DEDUPE_CHECK'],
  },
  {
    id: 'webhook-out-on-won',
    prompt: 'Send a webhook to our system when an opportunity is won.',
    outcome: 'flow',
    trigger: 'opportunity_won',
    mustUse: ['WEBHOOK'],
  },
  {
    id: 'opportunity-on-campaign',
    prompt: 'When a contact is enrolled in a campaign, create an opportunity for them.',
    outcome: 'flow',
    trigger: 'campaign_enrolled',
    mustUse: ['CREATE_OPPORTUNITY'],
  },
  {
    id: 'email-sent-log',
    prompt: 'Log an activity every time an email is sent.',
    outcome: 'flow',
    trigger: 'email_sent',
    mustUse: ['CREATE_ACTIVITY'],
  },

  /* ── REFUSALS: the request needs something that does not exist. ──────────── */
  /*
   * ⚠️ EACH NAMES A SPECIFIC ABSENCE. "The model should refuse vague things" is
   * not a test — it is a mood. These fail because a particular fact or
   * capability is not in the snapshot, and `flow-copilot-corpus.test.ts`
   * asserts that absence against the live snapshot so a case cannot silently
   * become satisfiable.
   */
  {
    id: 'refuse-seniority',
    prompt: 'When a contact is created, branch on their seniority level and tag senior people "priority".',
    outcome: 'refusal',
    because: 'contact.seniority is not a fact Outlio observes',
  },
  {
    id: 'refuse-revenue',
    prompt: 'Only assign an owner when the company revenue is over ten million.',
    outcome: 'refusal',
    because: 'company.revenue is not a fact Outlio observes',
  },
  {
    id: 'refuse-linkedin-connect',
    prompt: 'When a contact is created, send them a LinkedIn connection request.',
    outcome: 'refusal',
    because: 'there is no LinkedIn action in the flow catalogue — the channel is manual by design',
  },
  {
    id: 'refuse-sms',
    prompt: 'Text the contact when they book a call.',
    outcome: 'refusal',
    because: 'there is no SMS action',
  },
  /*
   * ⚠️ THIS WAS A REFUSAL CASE AND IT WAS WRONG. It marked the copilot down for
   * building NOTIFY here, on the grounds that a channel post is not a direct
   * message. But `ChannelProvider` is `'slack' | 'teams'` — NOTIFY really does
   * reach Slack, and the person asking to be told about wins gets told about
   * wins.
   *
   * ⚠️ THE TEST THAT SEPARATES IT FROM `refuse-sms` IS WHO RECEIVES SOMETHING.
   * "Text the contact" answered with a task changes the recipient from the
   * CONTACT to the operator — a different outcome wearing the right shape. DM
   * versus channel changes the envelope, not the reader.
   *
   * Marking a correct answer wrong is the failure mode this corpus polices in
   * the other direction; it was doing it here from the start.
   */
  {
    id: 'slack-notify-on-won',
    prompt: 'Send me a Slack DM whenever a deal is won.',
    outcome: 'flow',
    trigger: 'opportunity_won',
    mustUse: ['NOTIFY'],
  },
  {
    id: 'refuse-delete-contact',
    prompt: 'Delete the contact when their email bounces twice.',
    outcome: 'refusal',
    because: 'there is no delete action — erasure is a data-subject-rights path, not a flow step',
  },
  {
    id: 'refuse-score',
    prompt: 'Branch on the contact lead score and tag anyone above 80.',
    outcome: 'refusal',
    because: 'there is no lead-score fact in the catalogue',
  },
  {
    id: 'refuse-call',
    prompt: 'Automatically call the contact when they reply.',
    outcome: 'refusal',
    because: 'there is no dialler action',
  },
  {
    id: 'refuse-charge',
    prompt: 'Charge the customer when the opportunity is won.',
    outcome: 'refusal',
    because: 'there is no billing action, and money movement is never a flow step',
  },
  {
    id: 'refuse-social-post',
    prompt: 'Post about the win on our company social account.',
    outcome: 'refusal',
    because: 'there is no publishing action',
  },
] as const
