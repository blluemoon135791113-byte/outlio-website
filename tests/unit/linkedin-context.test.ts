/**
 * The evidence mapper, tested almost entirely on what it REFUSES to say.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ A MAPPER THAT FILLS EVERY VARIABLE PASSES EVERY NAIVE TEST AND IS THE ║
 * ║  MOST DANGEROUS FUNCTION IN THIS CODEBASE.                                ║
 * ║                                                                           ║
 * ║  Its output becomes a sentence about a stranger, sent from a customer's   ║
 * ║  own LinkedIn account, under their name. Every assertion below is really  ║
 * ║  the same assertion: nothing here may state more than was observed.       ║
 * ║                                                                           ║
 * ║  §4.9: "If neither context nor role is supported, require a manual        ║
 * ║  rewrite or skip; do not fabricate familiarity."                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { describe, expect, it } from 'vitest'

import {
  buildLinkedInContext,
  missingForGroundedOpener,
  verificationForSource,
  type ContactFacts,
} from '@/lib/linkedin/context'
import { renderLinkedInMessage } from '@/lib/linkedin/render'

const fromLeadEngine: ContactFacts = {
  source: 'lead_engine',
  firstName: 'Ada',
  fullName: 'Ada Lovelace',
  jobTitle: 'VP of Engineering',
  headline: null,
}

describe('verification follows how the row came to exist', () => {
  it('treats a parsed Sales Navigator page as verified', () => {
    /*
     * ⚠️ THE ONLY SOURCE THAT EARNS `VERIFIED`. A `lead_engine` row was parsed
     * from a page the customer opened in LinkedIn themselves, so the name on it
     * is what LinkedIn displays for that person. Reading it is an observation.
     */
    expect(verificationForSource('lead_engine')).toBe('VERIFIED')
  })

  it('treats everything else as the customer having recorded it', () => {
    /*
     * ⚠️ A NAME IN A CSV IS NOT VERIFIED BY BEING IN OUR DATABASE. It may be
     * years stale, a nickname, or simply wrong, and no amount of storage makes
     * it an observation of the person.
     */
    for (const source of ['csv_import', 'manual', 'api', 'flow'] as const) {
      expect(verificationForSource(source), source).toBe('USER_RECORDED')
    }
  })
})

describe('what it fills', () => {
  it('greets by a stored first name at the source’s verification', () => {
    const context = buildLinkedInContext({
      contact: fromLeadEngine,
      campaign: { topic: 'booking more qualified calls' },
    })
    expect(context.greeting).toEqual({ value: 'Hi Ada,', verification: 'VERIFIED' })
    expect(context.name_suffix).toEqual({ value: ', Ada', verification: 'VERIFIED' })
  })

  it('carries the customer’s own words at USER_RECORDED, never higher', () => {
    /*
     * ⚠️ "We help teams ship faster" is true in the sense that the customer
     * said it — a different kind of true from a fact read off a profile, and
     * unverifiable from outside. §4.9 requires only USER_RECORDED here for
     * exactly that reason.
     */
    const context = buildLinkedInContext({
      contact: fromLeadEngine,
      campaign: { topic: 'booking more qualified calls' },
    })
    expect(context.topic).toEqual({
      value: 'booking more qualified calls',
      verification: 'USER_RECORDED',
    })
  })

  it('reuses the topic as topic_short, which invents nothing', () => {
    // `variables.ts` states this fallback: reusing the customer's own words at
    // their own verification adds no claim.
    const context = buildLinkedInContext({
      contact: fromLeadEngine,
      campaign: { topic: 'shorter sales cycles' },
    })
    expect(context.topic_short?.value).toBe('shorter sales cycles')
  })
})

describe('what it refuses, and why each refusal is the point', () => {
  it('never splits a full name to invent a first name', () => {
    /*
     * ⚠️ WHICH TOKEN IS THE GIVEN NAME DEPENDS ON THE CULTURE THE NAME COMES
     * FROM. Guessing wrong means opening a cold message by calling somebody by
     * their family name — and the greeting is the first word a stranger reads.
     * §4.9: "Never a nickname from an uncertain field."
     */
    const context = buildLinkedInContext({
      contact: { ...fromLeadEngine, firstName: null, fullName: 'Ada Lovelace' },
      campaign: { topic: 'x' },
    })
    expect(context.greeting).toBeUndefined()
    expect(context.name_suffix).toBeUndefined()
  })

  it('never derives role_area from a job title', () => {
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  ⚠️ THE SPEC NAMES THIS EXACT MISTAKE: role_area is "a verified        ║
     * ║  responsibility or function — NOT an inferred seniority".              ║
     * ║                                                                       ║
     * ║  Turning "VP of Engineering" into "engineering" is that inference, and ║
     * ║  it would render "Your work in engineering caught my attention" — a    ║
     * ║  claim of having noticed something, made up from a title string.       ║
     * ║                                                                       ║
     * ║  The title is kept OUT of the context entirely rather than passed at a ║
     * ║  lower verification, because a variable present at the wrong level is  ║
     * ║  one `atLeast()` change away from being used.                          ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    const context = buildLinkedInContext({
      contact: fromLeadEngine,
      campaign: { topic: 'x' },
    })
    expect(context.role_area).toBeUndefined()
    expect(JSON.stringify(context), 'the job title leaked into the context').not.toContain(
      'Engineering',
    )
  })

  it('never invents connection_context', () => {
    /*
     * "One factual relationship sentence grounded in a source. Never inferred."
     * Outlio holds no relationship data — no shared group, no mutual
     * connection, no event — so there is nothing honest to put here.
     */
    const context = buildLinkedInContext({
      contact: { ...fromLeadEngine, headline: 'Building the future of fintech' },
      campaign: { topic: 'x' },
    })
    expect(context.connection_context).toBeUndefined()
  })

  it('fills nothing from a blank contact but the campaign copy', () => {
    const context = buildLinkedInContext({
      contact: { source: 'csv_import', firstName: null, fullName: null, jobTitle: null, headline: null },
      campaign: { topic: 'x' },
    })
    expect(Object.keys(context).sort()).toEqual(['topic', 'topic_short'])
  })

  it('drops whitespace-only values rather than storing them', () => {
    // "   " is not a name, and a greeting of "Hi ," is worse than "Hi,".
    const context = buildLinkedInContext({
      contact: { ...fromLeadEngine, firstName: '   ' },
      campaign: { topic: '  ' },
    })
    expect(context.greeting).toBeUndefined()
    expect(context.topic).toBeUndefined()
  })
})

describe('the honest context routes to a human, which is §4.9 working', () => {
  it('cannot render a grounded connection note from a real contact', () => {
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  ⚠️ THIS IS THE HEADLINE RESULT, AND IT LOOKS LIKE A FAILURE.         ║
     * ║                                                                       ║
     * ║  A `lead_engine` contact with a verified name and a job title still    ║
     * ║  cannot render T01: its context variant needs a relationship we do not ║
     * ║  have, and its role variant needs a verified responsibility, which a   ║
     * ║  title is not. So the template routes to `manual_rewrite`.             ║
     * ║                                                                       ║
     * ║  That is §4.9's stated outcome, not a gap: "require a manual rewrite   ║
     * ║  or skip; do not fabricate familiarity." A mapper that made this pass  ║
     * ║  would have had to invent the missing fact.                            ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    const context = buildLinkedInContext({
      contact: fromLeadEngine,
      campaign: { topic: 'booking more qualified calls' },
    })
    const outcome = renderLinkedInMessage('T01', context)
    expect(outcome.kind).toBe('manual_rewrite')
  })

  it('renders once a verified relationship actually exists', () => {
    /*
     * The other direction, and what makes the test above meaningful rather than
     * a statement that rendering never works: give it the real evidence §4.9
     * asks for and the grounded variant renders.
     */
    const context = {
      ...buildLinkedInContext({
        contact: fromLeadEngine,
        campaign: { topic: 'booking more qualified calls' },
      }),
      connection_context: {
        value: 'We were both at the RevOps London meetup last month.',
        verification: 'VERIFIED' as const,
      },
    }
    const outcome = renderLinkedInMessage('T01', context)
    expect(outcome.kind).toBe('rendered')
  })

  it('names which fact is missing, so an operator can act on it', () => {
    /*
     * ⚠️ "NOT ENOUGH DETAIL" MAKES SOMEBODY RETRY THE SAME CONTACT TOMORROW.
     * Naming the absent fact lets them go and find it, or decide to write the
     * note themselves.
     */
    const context = buildLinkedInContext({
      contact: fromLeadEngine,
      campaign: { topic: 'x' },
    })
    expect(missingForGroundedOpener(context)).toEqual(['connection_context', 'role_area'])
  })

  it('reports the topic missing when the customer supplied none', () => {
    const context = buildLinkedInContext({
      contact: fromLeadEngine,
      campaign: { topic: null },
    })
    expect(missingForGroundedOpener(context)).toContain('topic')
  })
})
