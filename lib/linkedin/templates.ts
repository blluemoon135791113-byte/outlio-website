/**
 * §4.9's complete message set, T01–T08.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  §4.9'S FALLBACKS ARE ALTERNATE SENTENCES, NOT PER-TOKEN DEFAULTS.        ║
 * ║                                                                           ║
 * ║  `{{name|there}}` handles "this word is missing". It cannot express what   ║
 * ║  the brief actually specifies: T01 falls back to a DIFFERENT sentence      ║
 * ║  when relationship context is absent, that sentence is only permitted if   ║
 * ║  role evidence is verified, and if neither holds the touch must be         ║
 * ║  rewritten by a human or skipped outright.                                ║
 * ║                                                                           ║
 * ║  So a template is an ORDERED LIST OF VARIANTS, each with its own           ║
 * ║  requirements, and an explicit outcome when none of them can render.      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ THE COPY IS TRANSCRIBED, NOT WRITTEN. Every string below is §4.9's,
 * character for character. It is a generic skeleton compiled against the
 * customer's own approved offer — the brief is explicit that these "are not
 * finished campaign facts", and improving the prose here would be inventing
 * marketing copy on a customer's behalf.
 */
import type { VariableName } from '@/lib/linkedin/variables'

export type TemplateId =
  | 'T01'
  | 'T02_NEW'
  | 'T02_EXISTING'
  | 'T03'
  | 'T04'
  | 'T05'
  | 'T06'
  | 'T07'
  | 'T08'

export type Variant = {
  id: string
  /** Uses `{{token}}` syntax, rendered by `lib/email/template.ts`. */
  body: string
  /** Every one must be present AND meet its verification floor. */
  requires: readonly VariableName[]
  /** Why this variant is second choice, for the reviewer's benefit. */
  note?: string
}

export type LinkedInTemplate = {
  id: TemplateId
  label: string
  /** InMail only. */
  subject?: Variant[]
  variants: readonly Variant[]
  /**
   * What happens when no variant can render.
   *
   * `skip` — the touch is dropped and the sequence continues. §4.9 uses this
   * where a fallback would add nothing: "Use the fallback only if it adds a
   * useful qualification question beyond T02. Otherwise skip this touch."
   *
   * `manual_rewrite` — a human must write it. Used where skipping would break
   * the sequence but no honest automatic text exists.
   *
   * `block` — the step cannot proceed at all.
   */
  onExhausted: 'skip' | 'manual_rewrite' | 'block'
}

export const TEMPLATES: Readonly<Record<TemplateId, LinkedInTemplate>> = {
  T01: {
    id: 'T01',
    label: 'Connection note',
    variants: [
      {
        id: 'T01.context',
        body: '{{greeting}} {{connection_context}} I work on {{topic}}. Open to connecting?',
        requires: ['greeting', 'connection_context', 'topic'],
      },
      {
        id: 'T01.role',
        body: '{{greeting}} Your work in {{role_area}} caught my attention. I work on {{topic}}. Open to connecting?',
        requires: ['greeting', 'role_area', 'topic'],
        note: 'Used only when role_area is verified. §4.9: "Use that fallback only when role_area is verified."',
      },
    ],
    /*
     * ⚠️ NOT `skip`. §4.9: "If neither context nor role is supported, require a
     * manual rewrite or skip; do not fabricate familiarity." Sending a
     * connection request with no note is a separate, explicitly-enabled choice
     * — it is not this template degrading quietly.
     */
    onExhausted: 'manual_rewrite',
  },

  T02_NEW: {
    id: 'T02_NEW',
    label: 'First DM after a newly recorded acceptance',
    variants: [
      {
        id: 'T02_NEW.default',
        body: 'Thanks for connecting{{name_suffix}}. {{relevance_sentence}} {{offer_sentence}} Would a short outline be useful?',
        requires: ['name_suffix', 'relevance_sentence', 'offer_sentence'],
      },
    ],
    onExhausted: 'manual_rewrite',
  },

  T02_EXISTING: {
    id: 'T02_EXISTING',
    label: 'First DM to a confirmed existing connection',
    variants: [
      {
        id: 'T02_EXISTING.default',
        body: '{{greeting}} {{relevance_sentence}} {{offer_sentence}} Would a short outline be useful?',
        requires: ['greeting', 'relevance_sentence', 'offer_sentence'],
      },
    ],
    onExhausted: 'manual_rewrite',
  },

  T03: {
    id: 'T03',
    label: 'First follow-up with a new useful point',
    variants: [
      {
        id: 'T03.insight',
        body: 'One thought on {{topic}}: {{practical_insight}}. Is {{desired_outcome}} something your team is working on, or is it outside your remit?',
        requires: ['topic', 'practical_insight', 'desired_outcome'],
      },
      {
        id: 'T03.qualify',
        body: "Is {{desired_outcome}} a priority for your team at the moment? If it is, I can explain how {{capability_short}} works. If not, I'll leave it here.",
        requires: ['desired_outcome', 'capability_short'],
        note: 'Only earns its place by adding a qualification question T02 did not ask.',
      },
    ],
    /*
     * ⚠️ `skip`, AND THIS IS THE ONE THAT MATTERS. §4.9: "Otherwise skip this
     * touch." A follow-up with nothing new to say is a message whose only
     * content is that we want something — which is the touch that gets an
     * account reported.
     */
    onExhausted: 'skip',
  },

  T04: {
    id: 'T04',
    label: 'Final follow-up',
    variants: [
      {
        id: 'T04.default',
        body: "I'll leave this here{{name_suffix}}. If {{topic}} becomes relevant later, feel free to message me. No need to reply.",
        requires: ['name_suffix', 'topic'],
      },
    ],
    onExhausted: 'skip',
  },

  T05: {
    id: 'T05',
    label: 'One-time InMail',
    subject: [
      {
        id: 'T05.subject',
        body: 'A question about {{topic_short}}',
        requires: ['topic_short'],
      },
    ],
    variants: [
      {
        id: 'T05.default',
        body: '{{greeting}} {{relevance_sentence}} {{offer_sentence}} Would a short outline be useful? If this is outside your remit, no need to reply.',
        requires: ['greeting', 'relevance_sentence', 'offer_sentence'],
      },
    ],
    onExhausted: 'manual_rewrite',
  },

  T06: {
    id: 'T06',
    label: 'Requested outline delivery',
    variants: [
      {
        id: 'T06.deliver',
        body: "Here's the outline you asked for: {{outline_delivery}}. {{qualification_question}}",
        requires: ['outline_delivery', 'qualification_question'],
      },
      {
        id: 'T06.preparing',
        body: 'Happy to put that together. Which part of {{topic}} would be most useful for me to focus on?',
        requires: ['topic'],
        note: '§4.9: "Do not claim to have delivered something unavailable."',
      },
    ],
    onExhausted: 'manual_rewrite',
  },

  T07: {
    id: 'T07',
    label: 'Meeting proposal after relevant interest',
    variants: [
      {
        id: 'T07.slots',
        body: 'Based on what you’ve shared, a short conversation about {{agreed_topic}} could be useful. Would {{slot_one}} or {{slot_two}} work? Both are in {{meeting_timezone}}.',
        requires: ['agreed_topic', 'slot_one', 'slot_two', 'meeting_timezone'],
      },
      {
        id: 'T07.ask',
        body: 'Would a short conversation about {{agreed_topic}} be useful? What day and timezone usually work for you?',
        requires: ['agreed_topic'],
        note: '§4.9: "Never invent availability."',
      },
    ],
    onExhausted: 'manual_rewrite',
  },

  T08: {
    id: 'T08',
    label: 'Confirmed booking',
    variants: [
      {
        id: 'T08.default',
        body: "You're booked for {{meeting_datetime}} ({{meeting_timezone}}). We'll cover {{agreed_topic}}. {{meeting_join_instruction}}",
        requires: ['meeting_datetime', 'meeting_timezone', 'agreed_topic', 'meeting_join_instruction'],
      },
    ],
    /*
     * ⚠️ `block`, NOT `manual_rewrite`. §4.9: "Only show this after a verified
     * booking event or an explicitly labelled owner-recorded booking", and
     * "missing → no T08". A confirmation is a claim that something is in the
     * recipient's calendar; if we cannot state the time we must not send it at
     * all, and a human rewriting it around the gap would be doing the exact
     * thing the rule forbids.
     */
    onExhausted: 'block',
  },
}
