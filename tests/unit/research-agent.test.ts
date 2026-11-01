/**
 * The research agent: the model navigates, code decides what is stored.
 *
 * Pinned:
 *   · a value is kept only when it is written on the page the model cited and
 *     passes the providers' own identity checks — never on the model's word;
 *   · the model can open only results and links it was shown, never a URL of
 *     its own, and never LinkedIn or a people-search site;
 *   · the loop is bounded by steps, and stops when the lead is complete;
 *   · a model that fails stops the lead without inventing anything.
 *
 * All names, domains and numbers are fabricated.
 */
import { describe, expect, it, vi } from 'vitest'

import type { SearchHit } from '@/lib/hubble/providers/types'
import type { LlmRequest, LLMProvider } from '@/lib/intelligence/llm/provider'
import type { CompanyEntity, PersonEntity } from '@/lib/intelligence/types'

vi.mock('server-only', () => ({}))

import {
  AGENT_STEPS,
  acceptFact,
  excerpt,
  parseStep,
  researchSubject,
  type AgentPage,
  type AgentSubject,
  type AgentTools,
} from '@/lib/intelligence/research-agent'

const COMPANY: CompanyEntity = {
  type: 'company',
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Fabricated Labs',
  domain: 'fabricated.example',
  linkedinUrl: null,
}

const PERSON: PersonEntity = {
  type: 'person',
  id: '00000000-0000-4000-8000-000000000001',
  fullName: 'Jamie Rivera',
  linkedinUrl: null,
  location: null,
  jobTitle: 'Founder',
  companyName: 'Fabricated Labs',
  companyDomain: 'fabricated.example',
  companyId: COMPANY.id,
}

const SUBJECT: AgentSubject = { person: PERSON, company: COMPANY, wants: ['person_email', 'company_phone'] }

const page = (url: string, content: string, extra: Partial<AgentPage> = {}): AgentPage =>
  ({ url, title: 'Page', content, emails: [], phones: [], links: [], ...extra })

const SPEAKERS = page(
  'https://events.example/speakers',
  'Speakers. Jamie Rivera, Founder at Fabricated Labs. Contact: jamie.rivera@fabricated.example',
)
const CONTACT = page('https://fabricated.example/contact', 'Fabricated Labs. Call us on (415) 555-0132.', {
  phones: ['(415) 555-0132'],
})

/** A model that answers each step from a script, recording what it was shown. */
function scriptedModel(steps: unknown[]): LLMProvider & { prompts: string[] } {
  const prompts: string[] = []
  let call = 0
  return {
    vendor: 'xai',
    model: 'scripted',
    prompts,
    isConfigured: () => true,
    generateJson: async (request: LlmRequest) => {
      prompts.push(request.user)
      const json = steps[call++]
      return json === undefined
        ? { ok: false, code: 'unavailable', detail: 'script exhausted' }
        : { ok: true, json, vendor: 'xai', model: 'scripted' }
    },
  }
}

function fakeTools(hits: SearchHit[], pages: AgentPage[]): AgentTools & { opened: string[]; searched: string[] } {
  const opened: string[] = []
  const searched: string[] = []
  return {
    opened,
    searched,
    search: async (query) => {
      searched.push(query)
      return hits
    },
    open: async (url) => {
      opened.push(url)
      return pages.find((candidate) => candidate.url === url) ?? null
    },
  }
}

const hit = (url: string, title = 'Result'): SearchHit => ({ url, title, snippet: null, publishedDate: null })
const FAR = Date.now() + 60_000

describe('accepting what the model proposes', () => {
  it("keeps a person's email only when the page ties it to them", () => {
    expect(acceptFact('person_email', 'jamie.rivera@fabricated.example', SPEAKERS, SUBJECT)?.value)
      .toBe('jamie.rivera@fabricated.example')
    // Not on the page: a guessed pattern is refused however plausible it looks.
    expect(acceptFact('person_email', 'jrivera@fabricated.example', SPEAKERS, SUBJECT)).toBeNull()
    // On the page, but somebody else's.
    const other = page('https://events.example/s2', 'Jamie Rivera, Founder at Fabricated Labs. Press: sam.ortiz@fabricated.example')
    expect(acceptFact('person_email', 'sam.ortiz@fabricated.example', other, SUBJECT)).toBeNull()
  })

  it("keeps a person's phone only right beside their name, as written on the page", () => {
    const near = page('https://events.example/s3', 'Jamie Rivera, Founder, Fabricated Labs — +1 415 555 0147')
    expect(acceptFact('person_phone', '14155550147', near, SUBJECT)?.value).toBe('+14155550147')
    const far = page('https://events.example/s4', `Jamie Rivera, Founder, Fabricated Labs.${' Filler.'.repeat(60)} Switchboard +1 415 555 0147`)
    expect(acceptFact('person_phone', '+1 415 555 0147', far, SUBJECT)).toBeNull()
  })

  it("keeps a company's line from its own site, and from elsewhere only when anchored to it", () => {
    expect(acceptFact('company_phone', '415-555-0132', CONTACT, SUBJECT)?.sourceConfidence).toBe('high')
    // The reader holds it as bare digits: judged as written on the page instead.
    expect(acceptFact('company_phone', '1-844-555-0132', page(CONTACT.url, 'Member services 1-844-555-0132', { phones: ['18445550132'] }), SUBJECT)?.value)
      .toBe('1-844-555-0132')
    // Run into the ZIP before it: the reader's digits match, so the number stands.
    expect(acceptFact('company_phone', '1-844-555-0132', page(CONTACT.url, 'Orange, CA 928681-844-555-0132', { phones: ['18445550132'] }), SUBJECT)?.value)
      .toBe('1-844-555-0132')
    // A number in the text that the reader did not judge a page phone.
    expect(acceptFact('company_phone', '415-555-0132', { ...CONTACT, phones: [] }, SUBJECT)).toBeNull()
    expect(acceptFact('company_email', 'hello@fabricated.example', page(CONTACT.url, 'Write to hello@fabricated.example'), SUBJECT)?.value)
      .toBe('hello@fabricated.example')
    // Another business's address on the company's own site is not the company's.
    expect(acceptFact('company_email', 'help@vendor.example', page(CONTACT.url, 'Powered by help@vendor.example'), SUBJECT)).toBeNull()
  })
})

describe("a company's line, not a person's or a department's", () => {
  it('takes a shared inbox from its own site, never a staff address', () => {
    const team = page('https://fabricated.example/team', 'Jamie Rivera jamie.rivera@fabricated.example. General: info@fabricated.example')
    expect(acceptFact('company_email', 'info@fabricated.example', team, SUBJECT)).not.toBeNull()
    expect(acceptFact('company_email', 'jamie.rivera@fabricated.example', team, SUBJECT)).toBeNull()
  })

  it('takes the labelled main line when its own site lists several numbers, never the fax', () => {
    const several = page(CONTACT.url, 'Fax: (415) 555-0177. Claims dept (415) 555-0188. Main phone: (415) 555-0132', {
      phones: ['(415) 555-0177', '(415) 555-0188', '(415) 555-0132'],
    })
    expect(acceptFact('company_phone', '(415) 555-0132', several, SUBJECT)).not.toBeNull()
    expect(acceptFact('company_phone', '(415) 555-0177', several, SUBJECT)).toBeNull()
    expect(acceptFact('company_phone', '(415) 555-0188', several, SUBJECT)).toBeNull()
    // A label run into an address block, as a real contact page printed it.
    const glued = page(CONTACT.url, 'Corporate Office1100 Fabricated Rd.Suite 16San Francisco, CA 941071-844-555-0132Hours. Members 1-888-555-0101', {
      phones: ['18445550132', '18885550101'],
    })
    expect(acceptFact('company_phone', '1-844-555-0132', glued, SUBJECT)?.value).toBe('1-844-555-0132')
  })

  it('refuses a listing on a page that compares companies rather than lists one', () => {
    const versus = { ...page('https://reviews.example/fabricated-labs-vs-other', 'Fabricated Labs, San Francisco — call (415) 555-0132, fabricated.example'), title: 'Fabricated Labs vs Other Co' }
    expect(acceptFact('company_phone', '(415) 555-0132', versus, SUBJECT)).toBeNull()
  })
})

describe('the navigation loop', () => {
  it('searches, opens what it chose, and stores only what code accepted', async () => {
    const model = scriptedModel([
      { facts: [], search: ['"Jamie Rivera" "Fabricated Labs"'], open: [], done: false },
      { facts: [], search: [], open: ['R1', 'R2'], done: false },
      {
        facts: [
          { kind: 'person_email', value: 'jamie.rivera@fabricated.example', source: 'P1' },
          // Cited a page that does not carry it: refused.
          { kind: 'company_phone', value: '(415) 555-0199', source: 'P2' },
        ],
        search: [], open: [], done: true,
      },
    ])
    const tools = fakeTools([hit(SPEAKERS.url), hit(CONTACT.url)], [SPEAKERS, CONTACT])
    const outcome = await researchSubject(model, SUBJECT, tools, FAR)

    expect(tools.opened).toEqual([SPEAKERS.url, CONTACT.url])
    expect(outcome.found).toEqual(['person_email'])
    expect(outcome.proposed).toBe(2)
    expect(outcome.rejected).toBe(1)
    expect(outcome.evidence.map((row) => row.field)).toEqual(['work_email', 'email_status'])
    expect(outcome.evidence[0]).toMatchObject({ sourceProvider: 'research-agent', sourceUrl: SPEAKERS.url })
    // The model read the page it opened.
    expect(model.prompts[2]).toContain('jamie.rivera@fabricated.example')
  })

  it('cannot open a URL it was not shown, nor LinkedIn or a people-search site', async () => {
    const model = scriptedModel([
      { facts: [], search: ['Jamie Rivera'], open: [], done: false },
      { facts: [], search: [], open: ['R1', 'R2', 'https://made-up.example/jamie', 'R9'], done: false },
      { facts: [], search: [], open: [], done: true },
    ])
    const tools = fakeTools(
      [hit('https://www.linkedin.com/in/fabricated-1'), hit('https://www.spokeo.com/Jamie-Rivera'), hit(SPEAKERS.url)],
      [SPEAKERS],
    )
    await researchSubject(model, SUBJECT, tools, FAR)
    // LinkedIn and the people-search hit were never listed, so R1 is the speakers page.
    expect(tools.opened).toEqual([SPEAKERS.url])
    expect(model.prompts[1]).not.toContain('linkedin.com')
    expect(model.prompts[1]).not.toContain('spokeo.com')
  })

  it('checks a value seen in a snippet on the page itself, never on the snippet', async () => {
    const model = scriptedModel([
      { facts: [], search: ['q'], open: [], done: false },
      {
        facts: [
          { kind: 'person_email', value: 'jamie.rivera@fabricated.example', source: 'R1' },
          // In a snippet, but not on the page behind it: refused.
          { kind: 'company_phone', value: '(415) 555-0199', source: 'R1' },
        ],
        search: [], open: [], done: true,
      },
    ])
    const tools = fakeTools([hit(SPEAKERS.url)], [SPEAKERS])
    const outcome = await researchSubject(model, SUBJECT, tools, FAR)
    expect(tools.opened).toEqual([SPEAKERS.url])
    expect(outcome.found).toEqual(['person_email'])
    expect(outcome.rejected).toBe(1)
  })

  it('opens a result by the exact URL it was shown, and never a contact-data vendor', async () => {
    const model = scriptedModel([
      { facts: [], search: ['q'], open: [], done: false },
      { facts: [], search: [], open: [SPEAKERS.url, 'https://leadiq.com/c/fabricated/email-format'], done: false },
      { facts: [], search: [], open: [], done: true },
    ])
    const tools = fakeTools([hit('https://leadiq.com/c/fabricated/email-format'), hit(SPEAKERS.url)], [SPEAKERS])
    await researchSubject(model, SUBJECT, tools, FAR)
    expect(tools.opened).toEqual([SPEAKERS.url])
    expect(model.prompts[1]).not.toContain('leadiq.com')
  })

  it('stops as soon as everything wanted is found', async () => {
    const model = scriptedModel([
      { facts: [], search: [], open: [], done: false },
    ])
    const outcome = await researchSubject(model, SUBJECT, fakeTools([], []), FAR)
    expect(outcome.stoppedBy).toBe('no_actions')

    const filled = scriptedModel([
      { facts: [], search: ['q'], open: [], done: false },
      { facts: [], search: [], open: ['R1', 'R2'], done: false },
      {
        facts: [
          { kind: 'person_email', value: 'jamie.rivera@fabricated.example', source: 'P1' },
          { kind: 'company_phone', value: '(415) 555-0132', source: 'P2' },
        ],
        search: ['more'], open: [], done: false,
      },
    ])
    const tools = fakeTools([hit(SPEAKERS.url), hit(CONTACT.url)], [SPEAKERS, CONTACT])
    const done = await researchSubject(filled, SUBJECT, tools, FAR)
    expect(done.stoppedBy).toBe('filled')
    expect(done.found.sort()).toEqual(['company_phone', 'person_email'])
    expect(tools.searched).toEqual(['q'])
  })

  it('is bounded by its steps, and a failed model stores nothing', async () => {
    const forever = scriptedModel(Array.from({ length: 20 }, (_, index) => ({ facts: [], search: [`q${index}`], open: [], done: false })))
    const bounded = await researchSubject(forever, SUBJECT, fakeTools([], []), FAR)
    expect(bounded.llmCalls).toBe(AGENT_STEPS)

    const broken = await researchSubject(scriptedModel([]), SUBJECT, fakeTools([], []), FAR)
    expect(broken).toMatchObject({ stoppedBy: 'model_unavailable', evidence: [] })
  })

  it('does nothing once its deadline has passed', async () => {
    const model = scriptedModel([{ facts: [], search: ['q'], open: [], done: false }])
    const outcome = await researchSubject(model, SUBJECT, fakeTools([], []), Date.now() - 1)
    expect(outcome).toMatchObject({ stoppedBy: 'deadline', llmCalls: 0 })
  })
})

describe('what the model is given and what it may return', () => {
  it('reads the passages around the lead, their employer and every contact', () => {
    const long = `${'Navigation menu. '.repeat(400)}Jamie Rivera leads Fabricated Labs.${' Filler text.'.repeat(400)} Reach us at info@fabricated.example`
    const text = excerpt({ content: long }, SUBJECT)
    expect(text).toContain('Jamie Rivera leads Fabricated Labs')
    expect(text).toContain('info@fabricated.example')
    expect(text.length).toBeLessThanOrEqual(3_000)
  })

  it('drops malformed steps and unknown kinds rather than trusting them', () => {
    expect(parseStep(null)).toBeNull()
    expect(parseStep({ facts: [{ kind: 'home_address', value: 'x', source: 'P1' }, { kind: 'person_email', value: ' a@b.example ', source: 'p1' }], search: [1, 'q'], open: ['r2'], done: 'yes' }))
      .toEqual({ facts: [{ kind: 'person_email', value: 'a@b.example', source: 'P1' }], search: ['q'], open: ['R2'], done: false })
  })
})
