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
  /*
   * ╔═══════════════════════════════════════════════════════════════════════╗
   * ║  ⚠️ `meeting.booked` / `.cancelled` / `.rescheduled` WERE WITHDRAWN     ║
   * ║  HERE ON 2026-09-13 (DECISION-18). DO NOT ADD THEM BACK WITHOUT A      ║
   * ║  PAYLOAD CONTRACT.                                                     ║
   * ║                                                                        ║
   * ║  They were offered as checkboxes for months and never fired once: no   ║
   * ║  product moment publishes them, because §5.13 specifies the transport   ║
   * ║  and nothing about bodies. The only shape in the codebase is            ║
   * ║  `NormalizedMeetingEvent`, which is Calendly's internal normalisation.  ║
   * ║                                                                        ║
   * ║  Publishing that verbatim would freeze an internal type as a public API ║
   * ║  nobody agreed to — and a webhook body IS the API: once a subscriber    ║
   * ║  parses it, changing it is a breaking release. Offering an event that   ║
   * ║  never arrives is the same fabrication one step earlier.               ║
   * ║                                                                        ║
   * ║  Withdrawn rather than left dark because the catalogue is a promise. A  ║
   * ║  developer ticking a box here is entitled to assume something arrives.  ║
   * ║  Cost of being wrong: if meetings become a near-term promise, this is   ║
   * ║  one array entry plus the payload design that was always required.     ║
   * ╚═══════════════════════════════════════════════════════════════════════╝
   */
] as const

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]
