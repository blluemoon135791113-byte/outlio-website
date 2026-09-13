/**
 * §4.9 — the message set, and every way it is allowed to say less.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE INTERESTING CASES ARE ALL ABSENCES.                                  ║
 * ║                                                                           ║
 * ║  A template with every value filled is the easy path and nobody ships a    ║
 * ║  bug in it. The defects live in what happens when a fact is missing,       ║
 * ║  weakly evidenced, or empty — because each of those has a plausible,       ║
 * ║  fluent, wrong output, and a fluent wrong message to a stranger is         ║
 * ║  indistinguishable from a right one until they reply.                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { describe, expect, it } from 'vitest'

import { renderLinkedInMessage, CONNECTION_NOTE_LIMIT } from '@/lib/linkedin/render'
import { publicationRequired, usable } from '@/lib/linkedin/variables'
import type { LinkedInContext } from '@/lib/linkedin/render'

const v = (value: string) => ({ value, verification: 'VERIFIED' as const })
const recorded = (value: string) => ({ value, verification: 'USER_RECORDED' as const })
const inferred = (value: string) => ({ value, verification: 'INFERRED' as const })

const FULL: LinkedInContext = {
  greeting: v('Hi Ada,'),
  name_suffix: v(', Ada'),
  connection_context: v('We both spoke at the Lagos fintech meetup.'),
  role_area: v('payments infrastructure'),
  topic: recorded('reducing failed card payments'),
  topic_short: recorded('failed payments'),
  relevance_sentence: v('Your team just moved onto a new PSP.'),
  offer_sentence: recorded('We cut failed-payment rates for mid-market retailers.'),
  practical_insight: recorded('retry windows under 30 minutes recover most soft declines'),
  desired_outcome: recorded('a lower failed-payment rate'),
  capability_short: recorded('our retry scheduler'),
  outline_delivery: recorded('https://example.com/outline'),
  qualification_question: recorded('How many transactions do you process monthly?'),
  agreed_topic: recorded('failed payment recovery'),
  slot_one: v('Tuesday 10:00'),
  slot_two: v('Wednesday 14:00'),
  meeting_timezone: v('Africa/Lagos'),
  meeting_datetime: v('Tuesday 16 September, 10:00'),
  meeting_join_instruction: recorded('Google Meet link to follow.'),
}

const without = (...names: (keyof LinkedInContext)[]): LinkedInContext => {
  const next = { ...FULL }
  for (const n of names) delete next[n]
  return next
}

describe('the strongest permitted variant wins', () => {
  it('uses grounded relationship context when there is some', () => {
    const out = renderLinkedInMessage('T01', FULL)
    if (out.kind !== 'rendered') throw new Error(`expected rendered, got ${out.kind}`)

    expect(out.variantId).toBe('T01.context')
    expect(out.usedFallbackVariant).toBe(false)
    expect(out.text).toContain('Lagos fintech meetup')
  })

  it('falls back to a verified role observation when context is absent', () => {
    const out = renderLinkedInMessage('T01', without('connection_context'))
    if (out.kind !== 'rendered') throw new Error(`expected rendered, got ${out.kind}`)

    expect(out.variantId).toBe('T01.role')
    expect(out.usedFallbackVariant).toBe(true)
    expect(out.text).toContain('payments infrastructure')
  })
})

describe('it never fabricates familiarity', () => {
  it('demands a human rewrite when neither context nor role is supported', () => {
    /*
     * §4.9: "If neither context nor role is supported, require a manual
     * rewrite or skip; do not fabricate familiarity."
     */
    const out = renderLinkedInMessage('T01', without('connection_context', 'role_area'))

    expect(out.kind).toBe('manual_rewrite')
  })

  it('refuses an INFERRED role even though a value is present', () => {
    /*
     * ⚠️ THE LOAD-BEARING ONE. §4.9: "Use that fallback only when role_area is
     * verified." A role guessed from a job-title string is not a role we
     * observed, and "Your work in X caught my attention" is a claim about a
     * stranger. The value is right there and must still not be used.
     */
    const context = { ...without('connection_context'), role_area: inferred('growth') }
    const out = renderLinkedInMessage('T01', context)

    expect(out.kind).toBe('manual_rewrite')
    expect(usable('role_area', inferred('growth'))).toBe(false)
  })

  it('treats a verified empty string as absent', () => {
    // "Verified empty" is how a blank lands mid-sentence.
    const context = { ...without('connection_context'), role_area: v('   ') }
    expect(renderLinkedInMessage('T01', context).kind).toBe('manual_rewrite')
  })
})

describe('a follow-up with nothing new to say is not sent', () => {
  it('skips T03 when neither an insight nor a capability exists', () => {
    /*
     * §4.9: "Otherwise skip this touch." A follow-up whose only content is that
     * we want something is the touch that gets an account reported — so the
     * exhausted outcome here is `skip`, not a weaker message.
     */
    const out = renderLinkedInMessage('T03', without('practical_insight', 'capability_short'))

    expect(out.kind).toBe('skip')
  })

  it('uses the qualification variant when only the insight is missing', () => {
    const out = renderLinkedInMessage('T03', without('practical_insight'))
    if (out.kind !== 'rendered') throw new Error(`expected rendered, got ${out.kind}`)

    expect(out.variantId).toBe('T03.qualify')
    expect(out.text).toContain('our retry scheduler')
  })
})

describe('a booking confirmation is blocked, never rewritten', () => {
  it('blocks T08 when the time is unknown', () => {
    /*
     * §4.9: "missing → no T08". A confirmation asserts something is in the
     * recipient's calendar. A human rewriting it around the missing time would
     * be doing precisely what the rule forbids, so this is `blocked` rather
     * than `manual_rewrite`.
     */
    const out = renderLinkedInMessage('T08', without('meeting_datetime'))

    expect(out.kind).toBe('blocked')
  })

  it('uses the stated fallback for join instructions, which is allowed', () => {
    const out = renderLinkedInMessage('T08', without('meeting_join_instruction'))
    if (out.kind !== 'rendered') throw new Error(`expected rendered, got ${out.kind}`)

    expect(out.text).toContain("I'll confirm the joining details in this thread.")
  })
})

describe('it never invents availability', () => {
  it('asks for a time when a slot is missing rather than proposing one', () => {
    const out = renderLinkedInMessage('T07', without('slot_two'))
    if (out.kind !== 'rendered') throw new Error(`expected rendered, got ${out.kind}`)

    expect(out.variantId).toBe('T07.ask')
    expect(out.text).toContain('What day and timezone usually work for you?')
    expect(out.text).not.toContain('Tuesday 10:00')
  })
})

describe('it never claims to have delivered something it has not', () => {
  it('offers to prepare the outline when there is none', () => {
    const out = renderLinkedInMessage('T06', without('outline_delivery'))
    if (out.kind !== 'rendered') throw new Error(`expected rendered, got ${out.kind}`)

    expect(out.variantId).toBe('T06.preparing')
    expect(out.text).not.toContain("Here's the outline")
  })
})

describe('rendering hygiene', () => {
  it('closes the gap an empty suffix leaves rather than punctuating air', () => {
    // `name_suffix` has an empty literal fallback by design — "Thanks for
    // connecting." is correct — but the naive substitution leaves a space
    // before the full stop. §4.9 rejects malformed punctuation.
    const out = renderLinkedInMessage('T02_NEW', without('name_suffix'))
    if (out.kind !== 'rendered') throw new Error(`expected rendered, got ${out.kind}`)

    expect(out.text).toContain('Thanks for connecting.')
    expect(out.text).not.toContain(' .')
    expect(out.text).not.toMatch(/ {2}/)
  })

  it('refuses a value that itself contains a token', () => {
    /*
     * ⚠️ THE SECOND PASS. A customer pasting `{{first_name}}` into their offer
     * sentence, or a fetched page echoing one, would otherwise reach a
     * recipient as visible tooling.
     */
    const context = { ...FULL, offer_sentence: recorded('We help {{company}} ship faster.') }
    const out = renderLinkedInMessage('T02_NEW', context)

    expect(out.kind).not.toBe('rendered')
  })

  it('refuses an overlong connection note instead of truncating it', () => {
    // §4.9: "Do not blindly truncate."
    const context = {
      ...FULL,
      connection_context: v('x'.repeat(CONNECTION_NOTE_LIMIT + 50)),
      role_area: undefined,
    }
    const out = renderLinkedInMessage('T01', context)

    expect(out.kind).toBe('manual_rewrite')
  })

  it('renders an InMail subject and body together', () => {
    const out = renderLinkedInMessage('T05', FULL)
    if (out.kind !== 'rendered') throw new Error(`expected rendered, got ${out.kind}`)

    expect(out.subject).toBe('A question about failed payments')
    expect(out.text).toContain('no need to reply')
  })

  it('refuses the InMail when the subject cannot be built', () => {
    // §4.9 rejects blank subjects outright.
    const out = renderLinkedInMessage('T05', without('topic_short'))
    expect(out.kind).not.toBe('rendered')
  })
})

describe('the publication contract', () => {
  it('names exactly the variables §4.9 marks required', () => {
    /*
     * These block publication rather than degrading at render, because no
     * fallback can substitute for the customer not having said what they do.
     */
    expect(publicationRequired().sort()).toEqual(
      ['capability_short', 'desired_outcome', 'offer_sentence', 'topic'].sort(),
    )
  })

  it('renders every template from a full context', () => {
    // A coverage floor: no template may be unreachable from complete evidence.
    for (const id of ['T01', 'T02_NEW', 'T02_EXISTING', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08'] as const) {
      expect(renderLinkedInMessage(id, FULL).kind, `${id} did not render`).toBe('rendered')
    }
  })
})
