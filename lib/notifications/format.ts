/**
 * Turning a domain event into a channel message — M8 Phase 25.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  A CHANNEL NOTIFICATION IS A BROADCAST, NOT A RECORD.                    ║
 * ║                                                                           ║
 * ║  Anyone in a Slack channel can read it, including people who have no CRM  ║
 * ║  access at all — contractors, a shared #sales room, whoever was in the    ║
 * ║  channel two years ago. So a notification carries the FACT and a LINK,    ║
 * ║  never the contents: "Dana Reyes replied" and a link, not the text of     ║
 * ║  what they said.                                                          ║
 * ║                                                                           ║
 * ║  The permission model stops at the product boundary. Once a message is in ║
 * ║  Slack it obeys Slack's permissions, which nobody here controls.          ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ PURE. Every provider's payload shape is testable without a network.
 */

export type ChannelProvider = 'slack' | 'teams'

export type NotificationInput = {
  /** One line, already safe to broadcast. */
  title: string
  /** Optional supporting facts. Values are shown; keep them non-sensitive. */
  fields?: { label: string; value: string }[]
  /** Deep link back into Outlio, where permissions still apply. */
  url?: string | null
  urlLabel?: string
}

/**
 * ⚠️ ESCAPED FOR SLACK'S OWN MARKUP, not for HTML. Slack treats `<`, `>` and
 * `&` specially — an unescaped `<` swallows everything up to the next `>` as a
 * link. A contact called "Smith & Sons <Holdings>" would otherwise render as
 * mangled text or vanish entirely.
 */
function escapeSlack(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * ⚠️ TEAMS RENDERS ADAPTIVE CARDS, which are JSON — so the danger is not
 * markup but LENGTH and newlines breaking the card layout. Text is trimmed and
 * collapsed rather than escaped.
 */
function cleanForTeams(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** Cap on any single value, so one long field cannot dominate a channel. */
const MAX_VALUE = 200

function truncate(value: string): string {
  const clean = value.trim()
  return clean.length <= MAX_VALUE ? clean : `${clean.slice(0, MAX_VALUE - 1)}…`
}

/**
 * Builds the body for one provider.
 *
 * ⚠️ SLACK AND TEAMS ARE GENUINELY DIFFERENT FORMATS, not one payload with a
 * flag. Slack takes `text` plus optional Block Kit; Teams' Workflows endpoint
 * takes an Adaptive Card wrapped in an attachment. Pretending they are the same
 * produces a message that renders as raw JSON in one of them.
 */
export function formatNotification(
  provider: ChannelProvider,
  input: NotificationInput,
): Record<string, unknown> {
  const fields = (input.fields ?? []).map((f) => ({
    label: truncate(f.label),
    value: truncate(f.value),
  }))

  if (provider === 'slack') {
    const lines = [
      `*${escapeSlack(truncate(input.title))}*`,
      ...fields.map((f) => `${escapeSlack(f.label)}: ${escapeSlack(f.value)}`),
    ]

    if (input.url) {
      // Slack's own link syntax; the label is escaped, the URL is not — it is
      // ours, not user input.
      lines.push(`<${input.url}|${escapeSlack(input.urlLabel ?? 'Open in Outlio')}>`)
    }

    return {
      // `text` is also what appears in a notification preview and in clients
      // that cannot render blocks, so it must stand alone.
      text: lines.join('\n'),
    }
  }

  /*
   * Teams. Note this targets a POWER AUTOMATE WORKFLOWS url, not the retired
   * Office 365 connector — see `CHANNEL_SETUP` below.
   */
  const body: Record<string, unknown>[] = [
    { type: 'TextBlock', text: cleanForTeams(truncate(input.title)), weight: 'Bolder', wrap: true },
  ]

  if (fields.length > 0) {
    body.push({
      type: 'FactSet',
      facts: fields.map((f) => ({ title: cleanForTeams(f.label), value: cleanForTeams(f.value) })),
    })
  }

  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body,
          ...(input.url
            ? {
                actions: [
                  {
                    type: 'Action.OpenUrl',
                    title: cleanForTeams(input.urlLabel ?? 'Open in Outlio'),
                    url: input.url,
                  },
                ],
              }
            : {}),
        },
      },
    ],
  }
}

/**
 * ⚠️ WHAT TO TELL A CUSTOMER, and it differs sharply per provider.
 *
 * Microsoft RETIRED Office 365 connectors — the old "Incoming Webhook" in a
 * Teams channel — announced in 2024 and retired through 2025. Building against
 * it would ship an integration with an expiry date, so the Teams path here is
 * Power Automate Workflows, which is Microsoft's own replacement and takes the
 * same shape: an HTTP URL that accepts a POST.
 */
export const CHANNEL_SETUP: Record<ChannelProvider, { label: string; help: string }> = {
  slack: {
    label: 'Slack',
    help: 'In Slack: Apps → Incoming Webhooks → Add to Slack, pick a channel, and paste the webhook URL here.',
  },
  teams: {
    label: 'Microsoft Teams',
    help: 'In Teams: Workflows → "Post to a channel when a webhook request is received", then paste the URL it gives you. Microsoft retired the older Office 365 connector webhooks, so a URL from that route will stop working.',
  },
}

/**
 * The events a channel may subscribe to.
 *
 * ⚠️ A SUBSET OF `WEBHOOK_EVENTS`, NOT THE SAME LIST. A webhook consumer wants
 * everything, including high-volume machine events; a room of people wants the
 * handful worth interrupting them for. Subscribing a Slack channel to every
 * `crm.contact.created` in a workspace doing volume outbound is how a team
 * learns to mute the channel — after which the feature is worse than absent.
 */
export const NOTIFIABLE_EVENTS = [
  { value: 'email.message.replied', label: 'Someone replies' },
  { value: 'meeting.booked', label: 'A meeting is booked' },
  { value: 'meeting.cancelled', label: 'A meeting is cancelled' },
  { value: 'crm.opportunity.won', label: 'A deal is won' },
  { value: 'crm.opportunity.stage_changed', label: 'A deal changes stage' },
  { value: 'crm.contact.assigned', label: 'A contact is assigned to someone' },
  { value: 'email.message.bounced', label: 'An email hard-bounces' },
  { value: 'email.contact.unsubscribed', label: 'Someone unsubscribes' },
] as const

export type NotifiableEvent = (typeof NOTIFIABLE_EVENTS)[number]['value']

/**
 * A human sentence for a domain event.
 *
 * ⚠️ THE FACT, NEVER THE CONTENTS. "Dana Reyes replied" is safe in a shared
 * channel; the text of the reply is not, and a link back to Outlio is where
 * permissions still apply.
 */
export function describeEvent(
  event: string,
  context: { contactName?: string | null; campaignName?: string | null; amount?: string | null },
): string {
  const who = context.contactName ?? 'A contact'

  switch (event) {
    case 'crm.contact.created':
      return `${who} was added`
    case 'crm.contact.assigned':
      return `${who} was assigned`
    case 'crm.opportunity.won':
      return context.amount ? `Deal won — ${who}, ${context.amount}` : `Deal won — ${who}`
    case 'crm.opportunity.stage_changed':
      return `${who} moved stage`
    case 'crm.task.completed':
      return `A task was completed for ${who}`
    case 'email.message.replied':
      // Deliberately not the reply itself.
      return `${who} replied`
    case 'email.message.bounced':
      return `An email to ${who} bounced`
    case 'email.contact.unsubscribed':
      return `${who} unsubscribed`
    case 'meeting.booked':
      return `${who} booked a call`
    case 'meeting.cancelled':
      return `${who} cancelled their call`
    case 'meeting.rescheduled':
      return `${who} rescheduled their call`
    default:
      return `${who}: ${event}`
  }
}
