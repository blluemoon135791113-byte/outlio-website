/**
 * Starter flow templates — R9.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  A BLANK CANVAS IS THE REASON AUTOMATION GOES UNUSED.                    ║
 * ║                                                                           ║
 * ║  The builder, the engine, the actions and the run history all exist and   ║
 * ║  work. What was missing is a starting point: "Create flow" opened an      ║
 * ║  empty graph and asked someone to invent a trigger, a condition and a     ║
 * ║  branch before they had ever seen one run.                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ EVERY TEMPLATE HERE IS A REAL, VALID DEFINITION. They are parsed by
 * `validateFlowDefinition` in the test suite, so a template can never ship
 * pointing at a step that does not exist or an action that was renamed — which
 * would hand someone a broken flow as their first experience of the feature.
 *
 * ⚠️ NONE OF THEM SEND EMAIL OR SPEND CREDITS. Every template uses free,
 * deterministic actions. A starter someone clicks without reading must not
 * commit them to spend, and a Hubble step across a large list does exactly
 * that. AI steps are for a flow somebody chose deliberately.
 */
import type { FlowDefinition } from '@/lib/flows/definition'

export type FlowTemplate = {
  key: string
  name: string
  /** What it does, in the words someone would use to ask for it. */
  description: string
  definition: FlowDefinition
}

export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    key: 'new_lead_assignment',
    name: 'New lead assignment',
    description:
      'Share incoming contacts across the team in turn, and give whoever gets one a task to work it.',
    definition: {
      trigger: { type: 'contact_created', config: {} },
      entryStepId: 'assign',
      allowReEnrollment: false,
      steps: [
        {
          id: 'assign',
          type: 'ACTION',
          label: 'Share out in turn',
          action: 'ROUND_ROBIN',
          config: {},
          next: 'task',
        },
        {
          id: 'task',
          type: 'ACTION',
          label: 'Task the new owner',
          action: 'CREATE_TASK',
          config: { title: 'Research and reach out to this new lead' },
          next: null,
        },
      ],
    },
  },
  {
    key: 'list_follow_up',
    name: 'Follow up on a list',
    description:
      'When someone joins a list, wait two days and raise a follow-up task if nothing has happened.',
    definition: {
      trigger: { type: 'list_added', config: {} },
      entryStepId: 'wait',
      allowReEnrollment: false,
      steps: [
        {
          id: 'wait',
          type: 'WAIT',
          label: 'Give it two days',
          hours: 48,
          next: 'tag',
        },
        {
          id: 'tag',
          type: 'ACTION',
          label: 'Mark as following up',
          action: 'ADD_TAG',
          config: { tag: 'following-up' },
          next: 'task',
        },
        {
          id: 'task',
          type: 'ACTION',
          label: 'Raise the follow-up',
          action: 'CREATE_TASK',
          config: { title: 'Follow up — two days since they joined the list' },
          next: null,
        },
      ],
    },
  },
  {
    key: 'reply_handling',
    name: 'Handle a reply',
    description:
      'When someone answers, tell their owner immediately and put a task on it so the reply is not left sitting.',
    definition: {
      trigger: { type: 'email_replied', config: {} },
      entryStepId: 'notify',
      allowReEnrollment: true,
      steps: [
        {
          id: 'notify',
          type: 'ACTION',
          label: 'Tell the owner',
          action: 'NOTIFY',
          config: { message: 'A contact has replied.' },
          next: 'task',
        },
        {
          id: 'task',
          type: 'ACTION',
          label: 'Task the owner to answer',
          action: 'CREATE_TASK',
          config: { title: 'Reply received — respond today' },
          next: null,
        },
      ],
    },
  },
  {
    key: 'call_booked',
    name: 'Call booked',
    description:
      'When a meeting is booked, create the opportunity and tag the contact so the pipeline reflects it straight away.',
    definition: {
      trigger: { type: 'call_booked', config: {} },
      entryStepId: 'tag',
      allowReEnrollment: true,
      steps: [
        {
          id: 'tag',
          type: 'ACTION',
          label: 'Mark as meeting booked',
          action: 'ADD_TAG',
          config: { tag: 'meeting-booked' },
          next: 'opportunity',
        },
        {
          id: 'opportunity',
          type: 'ACTION',
          label: 'Open a deal',
          action: 'CREATE_OPPORTUNITY',
          config: {},
          next: 'notify',
        },
        {
          id: 'notify',
          type: 'ACTION',
          label: 'Tell the owner',
          action: 'NOTIFY',
          config: { message: 'A meeting has been booked.' },
          next: null,
        },
      ],
    },
  },
  {
    key: 'stage_changed',
    name: 'Deal moved stage',
    description:
      'Record the move on the contact timeline and task the owner with the next step.',
    definition: {
      trigger: { type: 'stage_changed', config: {} },
      entryStepId: 'activity',
      allowReEnrollment: true,
      steps: [
        {
          id: 'activity',
          type: 'ACTION',
          label: 'Record it on the timeline',
          action: 'CREATE_ACTIVITY',
          config: {},
          next: 'task',
        },
        {
          id: 'task',
          type: 'ACTION',
          label: 'Task the next step',
          action: 'CREATE_TASK',
          config: { title: 'Deal moved stage — agree the next step' },
          next: null,
        },
      ],
    },
  },
  {
    key: 'no_activity',
    name: 'Gone quiet',
    description:
      'When a contact has had no activity for a while, tag them and put them back in front of their owner.',
    definition: {
      trigger: { type: 'no_activity', config: { days: 14 } },
      entryStepId: 'tag',
      allowReEnrollment: false,
      steps: [
        {
          id: 'tag',
          type: 'ACTION',
          label: 'Mark as gone quiet',
          action: 'ADD_TAG',
          config: { tag: 'gone-quiet' },
          next: 'task',
        },
        {
          id: 'task',
          type: 'ACTION',
          label: 'Ask the owner to revive it',
          action: 'CREATE_TASK',
          config: { title: 'No activity for two weeks — revive or close' },
          next: null,
        },
      ],
    },
  },
  {
    key: 'won_deal',
    name: 'Deal won',
    description:
      'Celebrate and hand over: tag the contact, record it, and tell the team.',
    definition: {
      trigger: { type: 'opportunity_won', config: {} },
      entryStepId: 'tag',
      allowReEnrollment: true,
      steps: [
        {
          id: 'tag',
          type: 'ACTION',
          label: 'Mark as a customer',
          action: 'ADD_TAG',
          config: { tag: 'customer' },
          next: 'activity',
        },
        {
          id: 'activity',
          type: 'ACTION',
          label: 'Record the win',
          action: 'CREATE_ACTIVITY',
          config: {},
          next: 'notify',
        },
        {
          id: 'notify',
          type: 'ACTION',
          label: 'Tell the team',
          action: 'NOTIFY',
          config: { message: 'A deal has been won.' },
          next: null,
        },
      ],
    },
  },
  {
    key: 'bounce_cleanup',
    name: 'Clean up a bounce',
    description:
      'When an address hard-bounces, tag the contact and task someone to find a working one.',
    definition: {
      trigger: { type: 'email_bounced', config: {} },
      entryStepId: 'tag',
      allowReEnrollment: true,
      steps: [
        {
          id: 'tag',
          type: 'ACTION',
          label: 'Mark the address as bad',
          action: 'ADD_TAG',
          config: { tag: 'bad-email' },
          next: 'task',
        },
        {
          id: 'task',
          type: 'ACTION',
          label: 'Find a working address',
          action: 'CREATE_TASK',
          config: { title: 'Email bounced — find a valid address' },
          next: null,
        },
      ],
    },
  },
]

export function flowTemplate(key: string): FlowTemplate | null {
  return FLOW_TEMPLATES.find((t) => t.key === key) ?? null
}
