/**
 * §4.13 — the two rules the Action Inbox exists to enforce.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  A card hands a real person a link to click and a form to fill in, and     ║
 * ║  both of those are ways to do damage with somebody else's LinkedIn         ║
 * ║  account:                                                                 ║
 * ║                                                                           ║
 * ║   • the link, if it turns out to perform an action rather than show a      ║
 * ║     profile — and the URL came from uploaded or fetched HTML;             ║
 * ║   • the form, if "I sent the request" can be recorded as "they accepted",  ║
 * ║     because acceptance is what gates the first DM.                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { describe, expect, it } from 'vitest'

import { profileReference } from '@/lib/linkedin/profile-reference'
import {
  allowedOutcomes,
  allowsBulk,
  isAllowedOutcome,
  isObservation,
  OBSERVATIONS,
  releasesQuota,
  requiresReason,
  type TaskKind,
} from '@/lib/linkedin/outcomes'

describe('a profile reference cannot perform an action', () => {
  it('accepts a public profile and rebuilds the href', () => {
    const ref = profileReference('https://www.linkedin.com/in/ada-okonkwo/')

    expect(ref).toEqual({ href: 'https://www.linkedin.com/in/ada-okonkwo', kind: 'public' })
  })

  it('keeps a Sales Navigator lead distinct rather than rewriting it', () => {
    /*
     * §4.5: "Do not convert Sales Navigator identifiers to public profile slugs
     * by guessing." They are different addresses for the same person and the
     * card must not imply it knows the public one.
     */
    const ref = profileReference('https://www.linkedin.com/sales/lead/ACwAAAB123,NAME_SEARCH,xyz')

    expect(ref?.kind).toBe('sales_navigator')
    expect(ref?.href).toContain('/sales/lead/')
  })

  it('refuses every LinkedIn path that is not a profile', () => {
    /*
     * ⚠️ THE POINT OF THE ALLOWLIST. Each of these is a real LinkedIn surface
     * and several of them DO something. A card rendering one hands an operator
     * a one-click action against a stranger, performed by their own account,
     * that Outlio never decided to take.
     */
    for (const path of [
      '/mynetwork/invite-connect/connections/',
      '/messaging/thread/abc',
      '/company/acme/',
      '/feed/update/urn:li:activity:1234',
      '/in/ada/detail/recent-activity/',
      '/',
    ]) {
      expect(profileReference(`https://www.linkedin.com${path}`), path).toBeNull()
    }
  })

  it('refuses a javascript: url even though it parses', () => {
    /*
     * `new URL('javascript:alert(1)')` succeeds. Only the protocol check stops
     * it, and `ValueProvenance` already records what happens without one: stored
     * XSS executing for every user who opens the record.
     */
    expect(profileReference('javascript:alert(1)')).toBeNull()
    expect(profileReference('data:text/html,<script>alert(1)</script>')).toBeNull()
  })

  it('refuses a lookalike host', () => {
    // An unanchored `includes('linkedin.com')` matches all of these.
    for (const host of [
      'linkedin.com.evil.example',
      'notlinkedin.com',
      'evil.example/www.linkedin.com',
    ]) {
      expect(profileReference(`https://${host}/in/ada`), host).toBeNull()
    }
  })

  it('drops query and fragment rather than preserving them', () => {
    /*
     * They carry tracking, and more importantly they are where an action would
     * hide. Keeping "just the harmless ones" means a second allowlist for a
     * part of the URL the card has no use for.
     */
    const ref = profileReference('https://www.linkedin.com/in/ada?action=invite&trk=x#top')

    expect(ref?.href).toBe('https://www.linkedin.com/in/ada')
  })

  it('accepts a country subdomain', () => {
    expect(profileReference('https://uk.linkedin.com/in/ada')?.kind).toBe('public')
  })
})

describe('a result form records what happened, and nothing else', () => {
  const KINDS: TaskKind[] = ['REVIEW_PROFILE', 'CONNECTION_REQUEST', 'DIRECT_MESSAGE', 'INMAIL']

  it('never offers acceptance as the outcome of sending a request', () => {
    /*
     * ⚠️ THE ONE THIS MODULE EXISTS FOR. §4.13: "'Mark request sent' cannot
     * mark acceptance." Acceptance gates the first DM, so collapsing them sends
     * a message into a connection that was never made.
     */
    const outcomes = allowedOutcomes('CONNECTION_REQUEST')

    expect(outcomes).toContain('REQUEST_MARKED_SENT')
    expect(outcomes).not.toContain('CONNECTION_ACCEPTANCE_RECORDED')
  })

  it('never offers any observation as a task outcome', () => {
    // The general form of the rule: an observation is not something the
    // operator did, so it cannot complete a task.
    for (const kind of KINDS) {
      for (const observation of OBSERVATIONS) {
        expect(
          isAllowedOutcome(kind, observation),
          `${kind} accepts the observation ${observation}`,
        ).toBe(false)
      }
    }
  })

  it('gives each kind exactly one affirmative outcome', () => {
    // A task asks for one action, so "what happened" has one affirmative
    // answer. Two would make the form a place to assert state.
    for (const kind of KINDS) {
      const affirmative = allowedOutcomes(kind).filter(
        (o) => o !== 'SKIPPED' && o !== 'FAILED' && o !== 'OUTCOME_UNKNOWN',
      )
      expect(affirmative, `${kind} has ${affirmative.length} affirmative outcomes`).toHaveLength(1)
    }
  })

  it('always allows skip, failed and unknown', () => {
    for (const kind of KINDS) {
      for (const always of ['SKIPPED', 'FAILED', 'OUTCOME_UNKNOWN']) {
        expect(isAllowedOutcome(kind, always), `${kind} cannot record ${always}`).toBe(true)
      }
    }
  })
})

describe('an unknown outcome is not a failure', () => {
  it('keeps its quota slot', () => {
    /*
     * §4.17: "retain its action/quota reservation conservatively." An action we
     * cannot rule out having happened has to keep counting, because the cost of
     * being wrong is a restriction on somebody's real account.
     */
    expect(releasesQuota('OUTCOME_UNKNOWN')).toBe(false)
    expect(releasesQuota('SKIPPED')).toBe(true)
    expect(releasesQuota('FAILED')).toBe(true)
  })

  it('does not release the slot for a recorded send either', () => {
    // The obvious one, stated so a refactor cannot quietly invert it.
    expect(releasesQuota('REQUEST_MARKED_SENT')).toBe(false)
    expect(releasesQuota('MESSAGE_MARKED_SENT')).toBe(false)
  })

  it('demands a reason', () => {
    expect(requiresReason('OUTCOME_UNKNOWN')).toBe(true)
    expect(requiresReason('SKIPPED')).toBe(true)
    expect(requiresReason('REQUEST_MARKED_SENT')).toBe(false)
  })
})

describe('manual tasks are never bulk-marked sent', () => {
  it('permits bulk skip only', () => {
    /*
     * §4.13, verbatim. Bulk skip is a decision the operator made inside Outlio.
     * Bulk "sent" is a claim that they performed N actions in LinkedIn's own
     * interface — which at bulk scale they did not.
     */
    expect(allowsBulk('SKIPPED')).toBe(true)

    for (const outcome of ['REQUEST_MARKED_SENT', 'MESSAGE_MARKED_SENT', 'PROFILE_REVIEW_RECORDED', 'OUTCOME_UNKNOWN', 'FAILED'] as const) {
      expect(allowsBulk(outcome), `${outcome} is bulk-applicable`).toBe(false)
    }
  })
})

describe('the two vocabularies do not overlap', () => {
  it('no observation is also an outcome name', () => {
    const everyOutcome = new Set(
      (['REVIEW_PROFILE', 'CONNECTION_REQUEST', 'DIRECT_MESSAGE', 'INMAIL'] as TaskKind[]).flatMap(
        (k) => allowedOutcomes(k),
      ),
    )
    for (const observation of OBSERVATIONS) {
      expect(everyOutcome.has(observation as never), observation).toBe(false)
      expect(isObservation(observation)).toBe(true)
    }
  })
})
