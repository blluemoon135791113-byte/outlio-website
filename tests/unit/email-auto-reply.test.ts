/**
 * Distinguishing a real reply from a robot — M6 Phase 17.
 *
 * M6 ACCEPTANCE CRITERION 1: "reply stops the sequence within one sync cycle;
 * OOO does not."
 *
 * ⚠️ THE ASYMMETRY IS THE DESIGN. Calling a REAL reply an auto-reply keeps
 * mailing someone who already answered — the behaviour that earns spam
 * complaints. Calling an OOO a real reply merely stops a sequence early. So
 * the filter only fires on strong, standards-based signals, and everything
 * else is treated as a genuine reply.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  classifyInbound,
  countsAsReply,
  isOwnOutbound,
  shouldStopSequence,
  type InboundMessage,
} from '@/lib/email/auto-reply'

function msg(over: Partial<InboundMessage> = {}): InboundMessage {
  return {
    headers: {},
    subject: 'Re: Quick question about Northwind',
    fromEmail: 'dana@buyer.example',
    text: 'Sure, Thursday works.',
    ...over,
  }
}

describe('a genuine reply stops the sequence', () => {
  it('classifies an ordinary reply as a reply', () => {
    const result = classifyInbound(msg())
    expect(result.kind).toBe('reply')
    expect(shouldStopSequence(result)).toBe(true)
    expect(countsAsReply(result)).toBe(true)
  })

  it('treats Auto-Submitted: no as a real reply', () => {
    // RFC 3834 says `no` explicitly means "a human sent this".
    const result = classifyInbound(msg({ headers: { 'auto-submitted': 'no' } }))
    expect(result.kind).toBe('reply')
  })
})

describe('declared automation is filtered', () => {
  it.each([
    ['auto-replied'],
    ['auto-generated'],
    ['auto-notified'],
  ])('filters Auto-Submitted: %s', (value) => {
    const result = classifyInbound(msg({ headers: { 'auto-submitted': value } }))
    expect(result.kind).toBe('auto_reply')
    expect(result.definitive).toBe(true)
    expect(shouldStopSequence(result)).toBe(false)
    expect(countsAsReply(result)).toBe(false)
  })

  it.each(['x-autoreply', 'x-autorespond', 'x-mail-autoreply'])(
    'filters on the %s header',
    (name) => {
      expect(classifyInbound(msg({ headers: { [name]: 'yes' } })).kind).toBe('auto_reply')
    },
  )

  it('filters Exchange out-of-office replies', () => {
    const result = classifyInbound(msg({ headers: { 'x-auto-response-suppress': 'All' } }))
    expect(result.kind).toBe('auto_reply')
  })

  it.each(['bulk', 'auto_reply', 'junk'])('filters Precedence: %s', (value) => {
    expect(classifyInbound(msg({ headers: { precedence: value } })).kind).toBe('auto_reply')
  })

  it('does NOT filter Precedence: list', () => {
    /*
     * Legitimate mail arriving through a mailing list carries this. A
     * substring match on "l" or a loose check would swallow genuine replies.
     */
    expect(classifyInbound(msg({ headers: { precedence: 'list' } })).kind).toBe('reply')
  })
})

describe('subject prefixes are anchored, never matched anywhere', () => {
  it.each([
    'Automatic reply: Quick question',
    'Out of office: back Monday',
    'Automatische Antwort: Frage',
    'Réponse automatique: bonjour',
    'Respuesta automática: hola',
    'Autosvar: hej',
  ])('filters "%s"', (subject) => {
    const result = classifyInbound(msg({ subject }))
    expect(result.kind).toBe('auto_reply')
    // Flagged as a judgement, not a fact — a human could type this.
    expect(result.definitive).toBe(false)
  })

  it('filters an auto-reply that a client prefixed with Re:', () => {
    expect(classifyInbound(msg({ subject: 'Re: Automatic reply: hello' })).kind).toBe('auto_reply')
  })

  it('does NOT filter a real reply that MENTIONS out of office', () => {
    /*
     * ⚠️ THE CASE THAT MATTERS MOST. A substring match would swallow this real
     * reply and keep mailing a person who answered.
     */
    const result = classifyInbound(
      msg({ subject: 'Re: your note about our out of office policy' }),
    )
    expect(result.kind).toBe('reply')
    expect(shouldStopSequence(result)).toBe(true)
  })

  it('does NOT filter a reply whose BODY mentions being out of office', () => {
    /*
     * "I'm out of the office until Tuesday, but yes — let's talk" is a
     * QUALIFIED LEAD. Scanning the body for that phrase would discard it.
     */
    const result = classifyInbound(
      msg({
        subject: 'Re: Quick question',
        text: "I'm out of the office until Tuesday, but yes — let's talk Thursday.",
      }),
    )
    expect(result.kind).toBe('reply')
  })
})

describe('bounces are not replies', () => {
  it('detects a delivery status notification', () => {
    const result = classifyInbound(
      msg({ headers: { 'content-type': 'multipart/report; report-type=delivery-status' } }),
    )
    expect(result.kind).toBe('bounce')
  })

  it('detects mail from MAILER-DAEMON', () => {
    expect(classifyInbound(msg({ fromEmail: 'MAILER-DAEMON@acme.example' })).kind).toBe('bounce')
  })

  it('detects an empty return-path', () => {
    expect(classifyInbound(msg({ headers: { 'return-path': '<>' } })).kind).toBe('bounce')
  })

  it('does not stop a sequence the way a reply does, and never counts as one', () => {
    // A bounce means the address is dead. It is a suppression event, and
    // counting it as a reply would inflate the reply rate with failures.
    const result = classifyInbound(msg({ fromEmail: 'mailer-daemon@acme.example' }))
    expect(shouldStopSequence(result)).toBe(false)
    expect(countsAsReply(result)).toBe(false)
  })

  it('takes precedence over auto-reply markers', () => {
    // Bounces frequently carry Auto-Submitted too; the bounce is the more
    // actionable fact because it means the address should be suppressed.
    const result = classifyInbound(
      msg({
        fromEmail: 'mailer-daemon@acme.example',
        headers: { 'auto-submitted': 'auto-replied' },
      }),
    )
    expect(result.kind).toBe('bounce')
  })
})

describe('every decision is explainable', () => {
  it('says which signal decided it', () => {
    // "The model thought so" is not auditable when a customer asks why a
    // prospect stopped receiving mail.
    expect(classifyInbound(msg({ headers: { 'auto-submitted': 'auto-replied' } })).reason)
      .toContain('RFC 3834')
    expect(classifyInbound(msg()).reason).toContain('No automatic-reply markers')
  })

  it('handles a missing subject without throwing', () => {
    expect(classifyInbound(msg({ subject: null })).kind).toBe('reply')
  })

  it('is case-insensitive about header names and values', () => {
    expect(classifyInbound(msg({ headers: { 'auto-submitted': 'AUTO-REPLIED' } })).kind).toBe(
      'auto_reply',
    )
  })
})

describe('isOwnOutbound', () => {
  /**
   * ╔═══════════════════════════════════════════════════════════════════════════╗
   * ║  ⚠️ THE PRODUCT COULD READ ITS OWN MESSAGE BACK AS A PROSPECT REPLY.      ║
   * ║                                                                           ║
   * ║  `reply-sync` matches on `enrollments.to_email = <from address>` and had  ║
   * ║  no exclusion for the sending mailbox. A sequence step addressed to the   ║
   * ║  sending address lands in that same INBOX, and the next sync treats it as ║
   * ║  a genuine reply: the sequence stops, `email_replied` fires, and the CRM  ║
   * ║  timeline records a reply nobody wrote.                                  ║
   * ║                                                                           ║
   * ║  Found while building the reply E2E fixture — the naive version of that   ║
   * ║  fixture would have gone green without a human ever replying.            ║
   * ╚═══════════════════════════════════════════════════════════════════════════╝
   */
  it('recognises the mailbox writing to itself', () => {
    expect(isOwnOutbound('husnain@outlio.io', 'husnain@outlio.io')).toBe(true)
  })

  it('normalises case and spacing, which providers do not agree on', () => {
    // A raw comparison would let this through the guard it exists to enforce.
    expect(isOwnOutbound('Husnain@Outlio.IO', 'husnain@outlio.io')).toBe(true)
    expect(isOwnOutbound('  husnain@outlio.io  ', 'husnain@outlio.io')).toBe(true)
  })

  it('still lets a real prospect through', () => {
    /*
     * The positive control. A guard that returned true for everything would
     * silence every reply in the product and pass the assertions above.
     */
    expect(isOwnOutbound('prospect@acme.example', 'husnain@outlio.io')).toBe(false)
    expect(isOwnOutbound('husnain@other.example', 'husnain@outlio.io')).toBe(false)
    expect(isOwnOutbound('someone@outlio.io', 'husnain@outlio.io')).toBe(false)
  })

  it('does not treat an empty address as our own', () => {
    // An unparsed From header must not be silently swallowed as self-mail.
    expect(isOwnOutbound('', 'husnain@outlio.io')).toBe(false)
    expect(isOwnOutbound('husnain@outlio.io', '')).toBe(false)
  })
})

describe('the self-send guard is actually wired into reply-sync', () => {
  /**
   * ╔═══════════════════════════════════════════════════════════════════════════╗
   * ║  ⚠️ TESTING THE PREDICATE IS NOT TESTING THE GUARD. Deleting the call from ║
   * ║  `reply-sync.ts` left all 2,980 unit tests green — `isOwnOutbound` was    ║
   * ║  still correct, still covered, and no longer used. That is the defect     ║
   * ║  class this project keeps finding, reproduced by its own fix.            ║
   * ║                                                                           ║
   * ║  The end-to-end path belongs to `email-reply-sync.test.ts`, which needs   ║
   * ║  GreenMail and is SKIPPED wherever Docker is absent — including the        ║
   * ║  machine this was written on. So a structural check is what stands        ║
   * ║  between the guard and a silent deletion.                                ║
   * ╚═══════════════════════════════════════════════════════════════════════════╝
   */
  const source = readFileSync(join(__dirname, '..', '..', 'lib/email/reply-sync.ts'), 'utf8')

  it('calls isOwnOutbound', () => {
    expect(
      source.includes('isOwnOutbound('),
      'reply-sync no longer skips the mailbox\'s own outbound mail, so a sequence ' +
        'step addressed to the sending address will be read back as a prospect reply.',
    ).toBe(true)
  })

  it('skips before matching enrollments, not after', () => {
    /*
     * Order is the whole point. Checked after the enrollment lookup, the sync
     * would already have counted an `unmatched` or recorded an inbound row for
     * its own message before deciding to ignore it.
     */
    const guard = source.indexOf('isOwnOutbound(')
    const match = source.indexOf("from('email_enrollments')")
    expect(guard).toBeGreaterThan(-1)
    expect(match).toBeGreaterThan(-1)
    expect(guard, 'the self-send check runs after the enrollment match').toBeLessThan(match)
  })
})
