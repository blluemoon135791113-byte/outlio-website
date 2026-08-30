/**
 * Telling a real reply from a robot — M6 Phase 17.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  M6 CRITERION 1: "reply stops the sequence within one sync cycle; OOO     ║
 * ║  does not."                                                               ║
 * ║                                                                           ║
 * ║  ⚠️ DETERMINISTIC. NO MODEL, NO CREDITS. The brief requires the           ║
 * ║  pre-filter to run BEFORE any classification, and this is why: a decision ║
 * ║  that stops a sequence must be reproducible and explainable. "The model   ║
 * ║  thought it was an auto-reply" is not something a customer can audit when ║
 * ║  they ask why a prospect stopped receiving mail.                          ║
 * ║                                                                           ║
 * ║  ⚠️ WHEN UNSURE, TREAT IT AS A GENUINE REPLY. The two errors are not      ║
 * ║  symmetric:                                                               ║
 * ║                                                                           ║
 * ║   - Calling a REAL reply an auto-reply → the sequence keeps mailing       ║
 * ║     someone who already answered. That is the behaviour that produces     ║
 * ║     spam complaints, and the recipient experiences it as being ignored.   ║
 * ║   - Calling an OOO a real reply → the sequence stops early. The seller    ║
 * ║     loses a follow-up. Nobody is harmed.                                  ║
 * ║                                                                           ║
 * ║  So only STRONG, standards-based signals mark something automatic.        ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

export type ReplyKind = 'reply' | 'auto_reply' | 'bounce'

export type ReplyClassification = {
  kind: ReplyKind
  /** The specific signal that decided it. Shown in the activity timeline. */
  reason: string
  /** True when a standards-defined header decided it, rather than a heuristic. */
  definitive: boolean
}

export type InboundMessage = {
  /** Lowercased header names → values. */
  headers: Record<string, string>
  subject: string | null
  fromEmail: string
  text?: string
}

function header(msg: InboundMessage, name: string): string {
  return (msg.headers[name.toLowerCase()] ?? '').trim().toLowerCase()
}

/**
 * ⚠️ RFC 3834 IS THE ONLY REALLY RELIABLE SIGNAL. `Auto-Submitted` exists
 * specifically so that automatic responders can identify themselves, and a
 * value other than `no` means the sender is declaring itself a robot. Every
 * other check below is a heuristic bolted on because not everyone complies.
 */
function autoSubmitted(msg: InboundMessage): string | null {
  const value = header(msg, 'auto-submitted')
  if (!value || value === 'no') return null
  return value
}

/**
 * Bounce detection.
 *
 * ⚠️ A BOUNCE IS NOT A REPLY AND MUST NOT STOP A SEQUENCE THE SAME WAY. It
 * means the address is bad, which is a SUPPRESSION event — continuing to mail
 * a dead address is what drives a bounce rate up and burns the domain.
 */
function isBounce(msg: InboundMessage): string | null {
  const contentType = header(msg, 'content-type')
  // RFC 3464 delivery status notification.
  if (contentType.includes('report-type=delivery-status')) {
    return 'a delivery status notification (RFC 3464)'
  }

  const from = msg.fromEmail.toLowerCase()
  if (from.startsWith('mailer-daemon@') || from.startsWith('postmaster@')) {
    return 'a message from MAILER-DAEMON'
  }

  // An empty envelope sender is the classic bounce marker.
  if (header(msg, 'return-path') === '<>') {
    return 'an empty return-path, which marks a bounce'
  }

  return null
}

/**
 * Subject prefixes that mail clients ADD THEMSELVES to automatic replies.
 *
 * ⚠️ ANCHORED AT THE START, NOT MATCHED ANYWHERE. This distinction is the
 * whole safety margin. Someone genuinely writing "Re: your note about our out
 * of office policy" must NOT be filtered — a substring match would swallow
 * that real reply and keep mailing a person who answered.
 *
 * Localised because Outlook and Gmail localise these, and a customer selling
 * into Germany or France would otherwise see every OOO treated as a reply.
 */
const AUTO_SUBJECT_PREFIXES = [
  'automatic reply:',
  'auto-reply:',
  'autoreply:',
  'out of office:',
  'out of the office:',
  'automatische antwort:', // German
  'abwesenheitsnotiz:',
  'réponse automatique:', // French
  'respuesta automática:', // Spanish
  'risposta automatica:', // Italian
  'automatisch antwoord:', // Dutch
  'autosvar:', // Swedish/Danish
  'automatiskt svar:',
  '自動応答:', // Japanese
] as const

/**
 * Classifies one inbound message.
 *
 * Order matters: bounces first (they are not replies at all), then declared
 * automation, then the heuristics.
 */
export function classifyInbound(msg: InboundMessage): ReplyClassification {
  const bounce = isBounce(msg)
  if (bounce) {
    return { kind: 'bounce', reason: `Identified as ${bounce}.`, definitive: true }
  }

  const declared = autoSubmitted(msg)
  if (declared) {
    return {
      kind: 'auto_reply',
      reason: `The sender declared \`Auto-Submitted: ${declared}\` (RFC 3834).`,
      definitive: true,
    }
  }

  // Vendor headers. Present only on automatic mail, so a match is conclusive.
  for (const name of [
    'x-autoreply',
    'x-autorespond',
    'x-autoreply-from',
    'x-mail-autoreply',
  ]) {
    if (header(msg, name)) {
      return {
        kind: 'auto_reply',
        reason: `The message carried an \`${name}\` header.`,
        definitive: true,
      }
    }
  }

  /*
   * ⚠️ `Precedence` IS CHECKED FOR EXACT VALUES, NOT SUBSTRINGS. Some
   * legitimate mail carries `Precedence: list`, and treating that as automatic
   * would filter genuine replies arriving via a mailing list.
   */
  const precedence = header(msg, 'precedence')
  if (['bulk', 'auto_reply', 'junk'].includes(precedence)) {
    return {
      kind: 'auto_reply',
      reason: `The message carried \`Precedence: ${precedence}\`.`,
      definitive: true,
    }
  }

  // Microsoft Exchange sets this on out-of-office replies.
  if (header(msg, 'x-auto-response-suppress')) {
    return {
      kind: 'auto_reply',
      reason: 'The message carried `X-Auto-Response-Suppress`, which Exchange sets on automatic replies.',
      definitive: true,
    }
  }

  const subject = (msg.subject ?? '').trim().toLowerCase()
  for (const prefix of AUTO_SUBJECT_PREFIXES) {
    if (subject.startsWith(prefix)) {
      return {
        kind: 'auto_reply',
        // Not `definitive`: a human COULD type this, so it is flagged as a
        // judgement rather than a fact.
        reason: `The subject begins with “${prefix}”, which mail clients add to automatic replies.`,
        definitive: false,
      }
    }
  }

  /*
   * A "Re:" prefix in front of an automatic-reply phrase, which some clients
   * produce: "Re: Automatic reply: ...". Still anchored.
   */
  const withoutRe = subject.replace(/^(re|fwd|fw)\s*:\s*/i, '')
  for (const prefix of AUTO_SUBJECT_PREFIXES) {
    if (withoutRe.startsWith(prefix)) {
      return {
        kind: 'auto_reply',
        reason: `The subject begins with “${prefix}” after its Re: prefix.`,
        definitive: false,
      }
    }
  }

  /*
   * ⚠️ EVERYTHING ELSE IS A REAL REPLY. No body-text scanning for phrases like
   * "I am currently out of the office": a genuine reply saying "I'm out of the
   * office until Tuesday, but yes let's talk" is a QUALIFIED LEAD, and
   * filtering it would be the expensive mistake this whole file is arranged to
   * avoid.
   */
  return { kind: 'reply', reason: 'No automatic-reply markers were present.', definitive: true }
}

/** Whether this inbound message should stop a sequence. */
export function shouldStopSequence(classification: ReplyClassification): boolean {
  return classification.kind === 'reply'
}

/** Whether it counts toward the reply rate in reporting. */
export function countsAsReply(classification: ReplyClassification): boolean {
  // M4 criterion 3: auto-replies never count as replies. An inflated reply
  // rate is worse than no reply rate, because people act on it.
  return classification.kind === 'reply'
}
