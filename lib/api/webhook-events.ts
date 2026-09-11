/**
 * The webhook event catalog, split from `lib/api/signing.ts` because a client
 * component (`DeveloperSettings.tsx`) needs the list to render checkboxes, and
 * webpack refuses to read `node:crypto` — which signing legitimately imports —
 * inside a browser module graph. This file must stay free of Node imports.
 */

/**
 * The domain events a customer can subscribe to.
 *
 * ⚠️ NAMED `noun.verb-in-past-tense`, consistently. A consumer writing a switch
 * over these should never have to remember whether it is `contact.create` or
 * `contact.created`.
 */
export const WEBHOOK_EVENTS = [
  'crm.contact.created',
  'crm.contact.assigned',
  'crm.opportunity.stage_changed',
  'crm.opportunity.won',
  'crm.task.completed',
  'email.message.sent',
  'email.message.replied',
  'email.message.bounced',
  /* Unsubscribing is about the PERSON, not a message — hence `contact`, and
     three parts like every other event. */
  'email.contact.unsubscribed',
  'meeting.booked',
  'meeting.cancelled',
  'meeting.rescheduled',
] as const

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]
