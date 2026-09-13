/**
 * §4.7 — durable cancellation, and the states a single status column cannot
 * hold.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE PROPERTY UNDER TEST IS THAT PERMISSION IS RE-EARNED, NEVER           ║
 * ║  INHERITED.                                                               ║
 * ║                                                                           ║
 * ║  A task approved an hour ago carries no authority now. If a reply, a DNC   ║
 * ║  or a warning arrived in between, the approval is stale — and it has to    ║
 * ║  be stale even when the cancellation message never arrived, because the    ║
 * ║  case that matters is the one where something went wrong.                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { describe, expect, it } from 'vitest'

import {
  canTransition,
  disposeLateEvent,
  isTerminal,
  reasonMeansSuccess,
  stateForReason,
  TERMINAL_STATES,
  type EnrollmentState,
  type TerminalReason,
} from '@/lib/linkedin/enrollment'
import {
  DEFAULT_THREAD_CHECK_MAX_AGE_MS,
  preflight,
  refusalMessage,
  type PreflightInput,
} from '@/lib/linkedin/preflight'

const NOW = new Date('2026-09-12T12:00:00Z')

const PASSING: PreflightInput = {
  channel: 'linkedin',
  stage: 'dispatch',
  approvedAtContactVersion: 7,
  currentContactVersion: 7,
  contactStopped: false,
  senderCondition: 'ok',
  lastThreadCheckAt: new Date(NOW.getTime() - 5 * 60 * 1000),
  threadCheckMaxAgeMs: DEFAULT_THREAD_CHECK_MAX_AGE_MS,
  now: NOW,
}

describe('a stale approval cannot be spent', () => {
  it('passes when nothing has changed', () => {
    expect(preflight(PASSING)).toEqual({ ok: true })
  })

  it('refuses when the contact version moved', () => {
    /*
     * ⚠️ THE WHOLE GUARANTEE. A reply increments the contact's version, so a
     * task approved before it fails here even if the cancellation notification
     * was never delivered. §4.7: "Lost UI notifications must not restore
     * action permission."
     */
    const out = preflight({ ...PASSING, currentContactVersion: 8 })

    expect(out).toEqual({ ok: false, refusal: 'APPROVAL_STALE' })
  })

  it('refuses when the version moved BACKWARDS', () => {
    /*
     * A counter that wrapped, was reset, or came back from a backup. `>` would
     * read this as "nothing has changed"; the approval was granted against one
     * specific state and anything else is stale.
     */
    const out = preflight({ ...PASSING, currentContactVersion: 6 })

    expect(out).toEqual({ ok: false, refusal: 'APPROVAL_STALE' })
  })
})

describe('the refusal order is by who is harmed', () => {
  it('reports the contact stop even when everything else is also wrong', () => {
    const out = preflight({
      ...PASSING,
      contactStopped: true,
      currentContactVersion: 99,
      senderCondition: 'restricted',
      lastThreadCheckAt: null,
    })

    expect(out).toEqual({ ok: false, refusal: 'CONTACT_STOPPED' })
  })

  it('reports a stale approval ahead of a sender problem', () => {
    // The contact is the one who cannot undo being messaged.
    const out = preflight({
      ...PASSING,
      currentContactVersion: 8,
      senderCondition: 'limit_reached',
    })

    expect(out).toEqual({ ok: false, refusal: 'APPROVAL_STALE' })
  })
})

describe('a sender warning is a stop, not a caution', () => {
  it('refuses on a warning exactly as on a restriction', () => {
    /*
     * §4.10: a warning "immediately stops new proactive task release". It is
     * not a signal to weigh against the value of the touch.
     */
    expect(preflight({ ...PASSING, senderCondition: 'warning' })).toEqual({
      ok: false,
      refusal: 'SENDER_RESTRICTED',
    })
  })

  it('distinguishes a limit from a restriction', () => {
    // One is a wait; the other means somebody must read a notice from
    // LinkedIn. Reporting them the same way trains people to ignore both.
    expect(preflight({ ...PASSING, senderCondition: 'limit_reached' })).toEqual({
      ok: false,
      refusal: 'SENDER_LIMIT_REACHED',
    })
  })
})

describe('no thread check is stale, not fresh', () => {
  it('refuses when nobody has looked', () => {
    /*
     * The tempting reading of `null` is "no check recorded, so nothing has
     * changed", which is exactly backwards. §4.13 holds tasks lacking review.
     */
    expect(preflight({ ...PASSING, lastThreadCheckAt: null })).toEqual({
      ok: false,
      refusal: 'THREAD_CHECK_STALE',
    })
  })

  it('refuses an old check', () => {
    const old = new Date(NOW.getTime() - DEFAULT_THREAD_CHECK_MAX_AGE_MS - 1000)
    expect(preflight({ ...PASSING, lastThreadCheckAt: old }).ok).toBe(false)
  })

  it('refuses a check timestamped in the future', () => {
    // Clock skew or a bad write. Treating it as maximally fresh turns a wrong
    // clock into permission.
    const ahead = new Date(NOW.getTime() + 60 * 1000)
    expect(preflight({ ...PASSING, lastThreadCheckAt: ahead })).toEqual({
      ok: false,
      refusal: 'THREAD_CHECK_STALE',
    })
  })
})

describe('every refusal explains itself without blaming the reader', () => {
  it('has a message for each, naming no internals', () => {
    const refusals = [
      'CONTACT_STOPPED',
      'APPROVAL_STALE',
      'SENDER_RESTRICTED',
      'SENDER_PAUSED',
      'SENDER_LIMIT_REACHED',
      'SENDER_DISCONNECTED',
      'THREAD_CHECK_STALE',
    ] as const

    for (const refusal of refusals) {
      const message = refusalMessage(refusal)
      expect(message.length, refusal).toBeGreaterThan(20)
      expect(message, `${refusal} leaks an internal name`).not.toMatch(/_|version|enum|null/)
    }
  })
})

describe('a reply is not a result', () => {
  it('counts only GOAL_MET as success', () => {
    /*
     * §4.18 asks for qualified conversations and held meetings as separate
     * denominators precisely so a wall of "replied" cannot be presented as the
     * channel working.
     */
    expect(reasonMeansSuccess('GOAL_MET')).toBe(true)

    for (const reason of ['REPLIED', 'NOT_INTERESTED', 'NO_REPLY', 'DNC'] as TerminalReason[]) {
      expect(reasonMeansSuccess(reason), reason).toBe(false)
    }
  })

  it('maps every reason to a terminal state', () => {
    const reasons: TerminalReason[] = [
      'GOAL_MET', 'REPLIED', 'NOT_INTERESTED', 'DNC', 'NOT_ACCEPTED',
      'NO_REPLY', 'EXPIRED', 'DISQUALIFIED', 'MANUAL_STOP',
    ]
    for (const reason of reasons) {
      expect(isTerminal(stateForReason(reason)), reason).toBe(true)
    }
  })
})

describe('a stop can arrive at any moment', () => {
  it('lets every non-terminal state be cancelled', () => {
    /*
     * ⚠️ INCLUDING FROM `WAITING_APPROVAL`. A hostile reply can land while a
     * draft sits approved and waiting, and a machine that cannot accept that
     * keeps outreach running after somebody asked it to stop.
     */
    const nonTerminal: EnrollmentState[] = [
      'DRAFT', 'ELIGIBILITY_REVIEW', 'READY', 'RUNNING',
      'WAITING_EVENT', 'WAITING_APPROVAL', 'WAITING_MANUAL_ACTION', 'PAUSED',
    ]
    for (const state of nonTerminal) {
      expect(canTransition(state, 'CANCELLED'), `${state} cannot be cancelled`).toBe(true)
    }
  })

  it('lets nothing leave a terminal state', () => {
    for (const state of TERMINAL_STATES) {
      for (const to of ['RUNNING', 'READY', 'PAUSED'] as EnrollmentState[]) {
        expect(canTransition(state, to), `${state} → ${to}`).toBe(false)
      }
    }
  })
})

describe('a late event is recorded, never replayed and never dropped', () => {
  it('records against a terminal enrollment rather than reopening it', () => {
    /*
     * §4.7: "Late events update CRM history without silently reopening a
     * terminal enrollment." A late acceptance after NOT_ACCEPTED must not
     * replay the invitation route — the prospect would get a message about a
     * request they answered weeks ago.
     */
    const out = disposeLateEvent('COMPLETED', 'RUNNING')

    expect(out).toEqual({
      kind: 'recorded_for_review',
      because: 'enrollment_already_terminal',
    })
  })

  it('applies an event a live enrollment can legally take', () => {
    expect(disposeLateEvent('WAITING_EVENT', 'RUNNING')).toEqual({
      kind: 'applied',
      to: 'RUNNING',
    })
  })

  it('never discards — an illegal transition still gets reviewed', () => {
    // Discarding loses a fact about a real person. A late acceptance is still
    // an acceptance and belongs in the CRM either way.
    expect(disposeLateEvent('DRAFT', 'RUNNING').kind).toBe('recorded_for_review')
  })
})
