/**
 * Provider capabilities — M5 Phase 11.
 *
 * M5 ACCEPTANCE CRITERION 2: "capability model correctly gates features per
 * provider (SMTP w/o IMAP reports no replies)."
 *
 * The expensive failure is reporting `replies: supported` for an account that
 * can never see one: a sequence whose stop-on-reply never fires keeps mailing
 * people who already answered, and the customer finds out from the person they
 * annoyed.
 */
import { describe, expect, it } from 'vitest'

import {
  capabilitiesFor,
  EMAIL_PROVIDERS,
  isUsable,
  unavailableReason,
} from '@/lib/email/capabilities'

describe('SMTP is send-only until IMAP is configured', () => {
  it('reports NO replies for plain SMTP', () => {
    const caps = capabilitiesFor('smtp')
    expect(caps.send).toBe('supported')
    expect(isUsable(caps.replies)).toBe(false)
    expect(isUsable(caps.threads)).toBe(false)
  })

  it('distinguishes "not set up" from "impossible"', () => {
    // Both are unusable, but only one has a fix. Collapsing them to `false`
    // would throw away the only actionable thing the UI can say.
    const caps = capabilitiesFor('smtp')
    expect(caps.replies).toBe('unconfigured')
    expect(caps.webhookEvents).toBe('unsupported')
  })

  it('gains replies and threads once an IMAP host is configured', () => {
    const caps = capabilitiesFor('smtp', { imapHost: 'imap.example.com', imapPort: 993 })
    expect(caps.replies).toBe('supported')
    expect(caps.threads).toBe('supported')
  })

  it('still cannot receive pushed events even with IMAP', () => {
    // IMAP is polling. There is no configuration that gives a plain mail
    // server a push channel, so this stays a dead end rather than becoming a
    // prompt to configure something that does not exist.
    const caps = capabilitiesFor('smtp', { imapHost: 'imap.example.com' })
    expect(caps.webhookEvents).toBe('unsupported')
  })

  it('does not unlock replies from an SMTP host alone', () => {
    // Submission settings say nothing about reading. This is the exact
    // confusion the capability model exists to prevent.
    const caps = capabilitiesFor('smtp', { smtpHost: 'smtp.example.com', smtpPort: 587 })
    expect(caps.replies).toBe('unconfigured')
  })

  it('uses password auth, not OAuth', () => {
    expect(capabilitiesFor('smtp').oauth).toBe('unsupported')
  })
})

describe('the full mailbox APIs can read as well as send', () => {
  it.each(['gmail', 'microsoft'] as const)('%s supports replies and threads', (provider) => {
    const caps = capabilitiesFor(provider)
    expect(caps.replies).toBe('supported')
    expect(caps.threads).toBe('supported')
    expect(caps.oauth).toBe('supported')
    expect(caps.webhookEvents).toBe('supported')
  })

  it('does not need configuration to read replies', () => {
    // The same OAuth grant authorises both, so an unconfigured Gmail account
    // is a contradiction — if it is connected, it can read.
    expect(capabilitiesFor('gmail', {})).toEqual(capabilitiesFor('gmail', { imapHost: 'x' }))
  })
})

describe('every provider', () => {
  it('can send — an account that cannot send has no reason to exist', () => {
    for (const provider of EMAIL_PROVIDERS) {
      expect(capabilitiesFor(provider).send).toBe('supported')
    }
  })

  it('supports one-click List-Unsubscribe, because we set the header ourselves', () => {
    // RFC 8058 compliance is ours to provide, not the provider's to grant.
    // M6 must never gate an unsubscribe header on provider support.
    for (const provider of EMAIL_PROVIDERS) {
      expect(capabilitiesFor(provider).listUnsubscribe).toBe('supported')
    }
  })

  it('is a pure function of provider and configuration', () => {
    for (const provider of EMAIL_PROVIDERS) {
      expect(capabilitiesFor(provider, { imapHost: 'a' })).toEqual(
        capabilitiesFor(provider, { imapHost: 'a' }),
      )
    }
  })
})

describe('the reason a feature is unavailable is actionable', () => {
  it('tells an SMTP user exactly what to add', () => {
    const reason = unavailableReason('replies', capabilitiesFor('smtp').replies)
    expect(reason).toContain('IMAP')
  })

  it('says nothing when the feature works', () => {
    expect(unavailableReason('replies', capabilitiesFor('gmail').replies)).toBeNull()
  })

  it('explains polling rather than offering a setting that does not exist', () => {
    const reason = unavailableReason('webhookEvents', capabilitiesFor('smtp').webhookEvents)
    expect(reason).toContain('schedule')
  })
})
