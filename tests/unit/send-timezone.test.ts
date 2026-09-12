/**
 * §5.7's fallback chain — whose clock a sending window is measured in.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ONLY THE LAST LINK WAS EVER CONSULTED.                                   ║
 * ║                                                                           ║
 * ║  `scheduleOf` took the mailbox's zone unconditionally, so a 09:00–17:00    ║
 * ║  window meant nine in the MAILBOX's morning — the middle of the night for  ║
 * ║  a recipient eight hours away, which is exactly what the customer set a    ║
 * ║  window to avoid.                                                         ║
 * ║                                                                           ║
 * ║  `crm_contacts.timezone` landed in migration 0121 and nothing read it: a   ║
 * ║  column shipped and then starved, which is this repository's signature     ║
 * ║  defect wearing a schema's clothes.                                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { describeSendTimezone, resolveSendTimezone } from '@/lib/email/send-timezone'

const ROOT = join(__dirname, '..', '..')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const SEND = strip(readFileSync(join(ROOT, 'lib/email/send.ts'), 'utf8'))

describe('the chain is contact, then campaign, then mailbox', () => {
  it('prefers the recipient', () => {
    const out = resolveSendTimezone({
      contactTimezone: 'Asia/Tokyo',
      campaignTimezone: 'Europe/London',
      accountTimezone: 'America/New_York',
    })

    expect(out).toEqual({ timezone: 'Asia/Tokyo', source: 'contact' })
  })

  it('falls to the campaign when the contact has none', () => {
    const out = resolveSendTimezone({
      contactTimezone: null,
      campaignTimezone: 'Europe/London',
      accountTimezone: 'America/New_York',
    })

    expect(out).toEqual({ timezone: 'Europe/London', source: 'campaign' })
  })

  it('falls to the mailbox when neither has one', () => {
    const out = resolveSendTimezone({
      contactTimezone: null,
      campaignTimezone: null,
      accountTimezone: 'America/New_York',
    })

    expect(out).toEqual({ timezone: 'America/New_York', source: 'account' })
  })
})

describe('a blank is not a timezone', () => {
  it('treats an empty string as unknown', () => {
    /*
     * ⚠️ `crm_contacts.timezone` IS FREE TEXT BEHIND A SHAPE CHECK, and a
     * column an import can write is a column that will eventually hold `''`.
     * Treating that as known hands `zonedParts` a value it cannot resolve, and
     * the failure surfaces as an unusable schedule on a send rather than as the
     * missing data it actually is.
     */
    expect(resolveSendTimezone({
      contactTimezone: '',
      campaignTimezone: 'Europe/London',
      accountTimezone: 'UTC',
    }).source).toBe('campaign')
  })

  it('treats whitespace as unknown', () => {
    expect(resolveSendTimezone({
      contactTimezone: '   ',
      campaignTimezone: null,
      accountTimezone: 'UTC',
    }).source).toBe('account')
  })

  it('trims a value it does accept', () => {
    expect(resolveSendTimezone({
      contactTimezone: ' Asia/Tokyo ',
      campaignTimezone: null,
      accountTimezone: 'UTC',
    }).timezone).toBe('Asia/Tokyo')
  })
})

describe('the fallback is named, never silent', () => {
  it('says which clock was used in every case', () => {
    /*
     * §4.8 requires the fallback shown EXPLICITLY. "Sending 09:00–17:00" is the
     * same sentence whether that is the recipient's morning or a stranger's,
     * and the difference is eight hours.
     */
    const contact = describeSendTimezone({ timezone: 'Asia/Tokyo', source: 'contact' })
    const campaign = describeSendTimezone({ timezone: 'Europe/London', source: 'campaign' })
    const account = describeSendTimezone({ timezone: 'UTC', source: 'account' })

    expect(contact).toContain("recipient's")
    expect(campaign).toContain('not known')
    expect(account).toContain('neither')
    for (const text of [contact, campaign, account]) {
      expect(text).toMatch(/Asia\/Tokyo|Europe\/London|UTC/)
    }
  })
})

describe('the allowance keeps the mailbox’s clock', () => {
  it('moves only the window timezone, never the ramp', () => {
    /*
     * ⚠️ THE DEFECT THIS PREVENTS IS SUBTLE AND EXPENSIVE. A ramp of 20/day is
     * 20 per MAILBOX day. Evaluating it against a recipient's calendar would
     * let one mailbox send two Mondays' worth by picking recipients either side
     * of the date line — a burst, from a domain that sells deliverability.
     *
     * So `scheduleOf` takes an optional window timezone and everything else
     * stays on the account.
     */
    expect(SEND).toMatch(/timezone: windowTimezone \?\? account\.timezone/)
    expect(SEND).toMatch(/scheduleOf\(account, sendZone\.timezone\)/)
    // The ramp check must not be handed the recipient's zone.
    expect(SEND, 'the ramp is being evaluated in the recipient timezone').not.toMatch(
      /p_timezone: sendZone/,
    )
  })

  it('reads the contact timezone on the enqueue path', () => {
    expect(SEND).toContain('recipientTimezone(input.workspaceId, input.contactId)')
    expect(SEND).toContain('resolveSendTimezone({')
  })

  it('scopes that lookup by workspace and never lets it fail a send', () => {
    const block = SEND.slice(
      SEND.indexOf('async function recipientTimezone'),
      SEND.indexOf('export async function suppressEmail'),
    )
    expect(block).toMatch(/\.eq\('workspace_id', workspaceId\)/)
    expect(block).toMatch(/catch \{\s*return null/)
  })
})
