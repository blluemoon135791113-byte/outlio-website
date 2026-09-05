/**
 * Channel notification formatting — M8 Phase 25.
 *
 * ⚠️ A CHANNEL NOTIFICATION IS A BROADCAST, NOT A RECORD. Anyone in the Slack
 * channel can read it, including people with no CRM access. So the tests here
 * are as much about what a message must NOT contain as how it is shaped.
 */
import { describe, expect, it } from 'vitest'

import {
  CHANNEL_SETUP,
  describeEvent,
  formatNotification,
} from '@/lib/notifications/format'

describe('Slack and Teams are genuinely different formats', () => {
  it('sends Slack a `text` field it can render standalone', () => {
    /*
     * `text` is what appears in a push preview and in clients that cannot
     * render blocks, so it has to carry the message on its own.
     */
    const body = formatNotification('slack', { title: 'Deal won — Dana Reyes' })
    expect(body.text).toContain('Deal won — Dana Reyes')
  })

  it('sends Teams an Adaptive Card in an attachment', () => {
    const body = formatNotification('teams', { title: 'Deal won' }) as {
      type: string
      attachments: { contentType: string; content: { body: unknown[] } }[]
    }
    expect(body.type).toBe('message')
    expect(body.attachments[0]!.contentType).toBe('application/vnd.microsoft.card.adaptive')
    expect(body.attachments[0]!.content.body).toHaveLength(1)
  })

  it('does not send one payload shape to both', () => {
    // Pretending they are the same renders as raw JSON in one of them.
    const slack = formatNotification('slack', { title: 'x' })
    const teams = formatNotification('teams', { title: 'x' })
    expect(Object.keys(slack)).not.toEqual(Object.keys(teams))
  })
})

describe('Slack markup is escaped', () => {
  it('escapes angle brackets, which Slack treats as a link', () => {
    /*
     * An unescaped `<` swallows everything up to the next `>` as a link, so a
     * company called "Smith & Sons <Holdings>" would render mangled or vanish.
     */
    const body = formatNotification('slack', {
      title: 'Deal won — Smith & Sons <Holdings>',
    }) as { text: string }

    expect(body.text).toContain('&lt;Holdings&gt;')
    expect(body.text).toContain('&amp;')
    expect(body.text).not.toMatch(/<Holdings>/)
  })

  it('escapes the link LABEL but not our own URL', () => {
    const body = formatNotification('slack', {
      title: 't',
      url: 'https://app.outlio.io/crm/contacts/abc',
      urlLabel: 'Open <now>',
    }) as { text: string }

    expect(body.text).toContain('https://app.outlio.io/crm/contacts/abc')
    expect(body.text).toContain('Open &lt;now&gt;')
  })
})

describe('long values cannot dominate a channel', () => {
  it('truncates a runaway field', () => {
    const body = formatNotification('slack', {
      title: 'x',
      fields: [{ label: 'Note', value: 'y'.repeat(5000) }],
    }) as { text: string }

    expect(body.text.length).toBeLessThan(500)
    expect(body.text).toContain('…')
  })

  it('collapses newlines for Teams, which would break the card', () => {
    const body = formatNotification('teams', {
      title: 'Line one\n\n\nline two',
    }) as { attachments: { content: { body: { text: string }[] } }[] }

    expect(body.attachments[0]!.content.body[0]!.text).toBe('Line one line two')
  })
})

describe('what a notification says about an event', () => {
  it('states the FACT of a reply, never its contents', () => {
    /*
     * ⚠️ THE POINT OF THE WHOLE MODULE. "Dana Reyes replied" is safe in a
     * shared channel; the text of the reply is not, and a link back to Outlio
     * is where permissions still apply.
     */
    const line = describeEvent('email.message.replied', { contactName: 'Dana Reyes' })
    expect(line).toBe('Dana Reyes replied')
  })

  it('names a won deal with its amount when there is one', () => {
    expect(describeEvent('crm.opportunity.won', { contactName: 'Dana', amount: '£12,000' }))
      .toBe('Deal won — Dana, £12,000')
    // ...and omits it cleanly when there is not.
    expect(describeEvent('crm.opportunity.won', { contactName: 'Dana' })).toBe('Deal won — Dana')
  })

  it('falls back to "A contact" rather than saying "null"', () => {
    expect(describeEvent('meeting.booked', {})).toBe('A contact booked a call')
  })

  it('covers every domain event without falling through', () => {
    for (const event of [
      'crm.contact.created', 'crm.contact.assigned', 'crm.opportunity.won',
      'crm.opportunity.stage_changed', 'crm.task.completed', 'email.message.replied',
      'email.message.bounced', 'email.contact.unsubscribed', 'meeting.booked',
      'meeting.cancelled', 'meeting.rescheduled',
    ]) {
      const line = describeEvent(event, { contactName: 'Dana' })
      // The fallback prints the raw event name, which reads as a bug.
      expect(line).not.toContain(event)
    }
  })
})

describe('setup guidance is honest about Microsoft', () => {
  it('warns that the old Teams connector webhooks are retired', () => {
    /*
     * Microsoft retired Office 365 connectors — announced 2024, retired
     * through 2025. Sending someone down that route would give them an
     * integration with an expiry date.
     */
    expect(CHANNEL_SETUP.teams.help).toContain('Workflows')
    expect(CHANNEL_SETUP.teams.help).toMatch(/retired|stop working/)
  })

  it('tells a Slack user exactly where to click', () => {
    expect(CHANNEL_SETUP.slack.help).toContain('Incoming Webhooks')
  })
})
