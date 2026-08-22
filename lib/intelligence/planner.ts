import 'server-only'

/**
 * Natural language → ResearchPlan (spec §6, §7).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THE MODEL PLANS. IT NEVER ANSWERS.                                      ║
 * ║                                                                          ║
 * ║  It decides WHICH FIELDS a question needs. It never supplies a funding   ║
 * ║  figure, a headcount, a technology, or a date — those come from a        ║
 * ║  provider with a source URL, or they stay `unknown`.                     ║
 * ║                                                                          ║
 * ║  Its output is a PROPOSAL. `researchPlanSchema` decides whether anything ║
 * ║  runs. Unstructured or invented output never reaches a paid API.         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * The model is also never shown lead records. It sees the question and the
 * catalog of fields this system can research — nothing about the customer's
 * prospects (spec §5).
 */
import { validatePlan, type ResearchPlan } from '@/lib/intelligence/plan'
import { preserveExplicitConstraints } from '@/lib/intelligence/filters'
import { resolveLlmProvider, type LLMProvider } from '@/lib/intelligence/llm/provider'
import { RESEARCH_FIELDS, type ResearchField } from '@/lib/intelligence/types'

/**
 * What each field means, in the model's terms.
 *
 * `Record<ResearchField, string>` so a new field cannot be added without
 * describing it — an undescribed field is one the planner will never choose.
 */
const FIELD_DESCRIPTIONS: Record<ResearchField, string> = {
  company_domain: "the company's official website domain",
  employee_count: 'number of employees / company size / headcount',
  industry: 'the industry or sector the company operates in',
  headquarters: 'where the company is based; country, city, or region',
  company_description: 'what the company does, in prose',
  business_model: 'B2B, B2C, marketplace, agency, SaaS and similar',
  revenue_estimate: 'estimated annual revenue',
  company_number: 'the official company registration number',
  company_status: 'official legal status such as active, dissolved, or liquidation',
  company_type: 'official legal company type such as limited company, PLC, or LLP',
  jurisdiction: 'the legal registry jurisdiction in which the company is incorporated',
  incorporation_date: 'the official date the company was incorporated',
  sic_codes: 'official Standard Industrial Classification codes',
  registered_office: 'the official registered office address, which is not necessarily HQ',
  accounts_overdue: 'whether the official registry marks company accounts as overdue',
  confirmation_statement_overdue:
    'whether the official registry marks the confirmation statement as overdue',
  insolvency_history: 'whether the official registry reports insolvency history',
  sec_cik: 'the official SEC Central Index Key (CIK) for an SEC filer',
  sec_legal_name: 'the official legal company name in SEC EDGAR',
  sec_entity_type: 'the SEC filer entity type',
  sec_sic: 'the SEC Standard Industrial Classification code',
  sec_sic_description: 'the SEC Standard Industrial Classification description',
  sec_ein: 'the public employer identification number reported in SEC EDGAR',
  sec_lei: 'the Legal Entity Identifier reported in SEC EDGAR',
  sec_tickers: 'stock ticker symbols reported in SEC EDGAR',
  sec_exchanges: 'stock exchanges reported in SEC EDGAR',
  sec_state_of_incorporation: 'the state or jurisdiction of incorporation reported by the SEC',
  sec_business_address: 'the official business address reported in SEC EDGAR',
  sec_website: 'the company website reported in SEC EDGAR',
  sec_former_names: 'former legal names reported in SEC EDGAR',
  sec_filing_history: 'recent SEC EDGAR filing forms, dates, identifiers, and document links',

  federal_awards_total: 'total value of US federal government contracts or grants awarded to the company',
  federal_awards_count: 'how many US federal awards the company has received',
  federal_award_types: 'the kinds of US federal awards held: contracts, grants, loans, IDVs',
  federal_recipient_name: 'the company\'s registered name in US federal award records',
  employee_growth: 'whether headcount is growing or shrinking, and by how much',
  tech_churn: 'technologies the company recently started or stopped using',
  company_age: 'how many years the company has existed',
  funding_recency: 'how recently the company raised, in months',
  social_profiles:
    "the COMPANY's own X/Twitter, Instagram, Facebook, YouTube and Crunchbase " +
    'pages — not the profiles of the people who work there',
  person_seniority: 'how senior the person is: C-Suite, VP, Director, Founder',
  person_department: 'which function the person works in: Sales, Engineering, Marketing',
  person_social_profiles:
    "the INDIVIDUAL's own X/Twitter, GitHub, Facebook and LinkedIn profiles — " +
    'use this, not social_profiles, when the question is about the people rather ' +
    'than the companies they work for',
  funding_round: 'the funding stage: Seed, Series A, Series B and so on',
  funding_amount: 'how much money was raised',
  funding_currency: 'the currency an amount was raised in',
  funding_date: 'when funding was announced',
  funding_investors: 'which investors led or participated',

  tech_stack: 'technologies, tools, or software the company uses on its website',
  product_launches: 'product launches, including Product Hunt and Show HN',

  recent_news: 'recent news, announcements, or public events',
  hiring_signals: 'whether the company is hiring, and for which roles',
  competitors: 'competitors, alternatives, or comparable companies',

  website_signals: 'signals from the company website such as positioning',
  pricing_signals: 'public pricing information',

  review_presence: 'presence on review platforms',
  review_rating: 'average rating on review platforms',
  review_count: 'number of public reviews',

  github_presence: 'public GitHub organisation and open-source activity',

  work_email: 'a business email address for a person',
  email_status: 'whether an email address was verified',
  mobile_phone: 'a phone number for a person',
  phone_status: 'whether a phone number was verified',
}

/**
 * Characteristics no B2B qualification may ever use (spec §44).
 *
 * Checked on the QUESTION, before a model sees it, because refusing at the
 * planning stage is the only place this can be enforced once — everything
 * downstream is field-driven and would happily research a proxy.
 */
const PROTECTED_CHARACTERISTIC_TERMS = [
  'race',
  'racial',
  'ethnicity',
  'ethnic',
  'religion',
  'religious',
  'muslim',
  'christian',
  'jewish',
  'hindu',
  'sexual orientation',
  'gay',
  'lesbian',
  'lgbt',
  'disability',
  'disabled',
  'health condition',
  'medical condition',
  'pregnan',
  'political opinion',
  'political affiliation',
  'trade union',
  'union member',
  'caste',
]

export function usesProtectedCharacteristic(question: string): boolean {
  const haystack = question.toLowerCase()
  return PROTECTED_CHARACTERISTIC_TERMS.some((term) => haystack.includes(term))
}

/** JSON Schema handed to the model. Mirrors `researchPlanSchema`. */
const PLAN_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    entityScope: { type: 'string', enum: ['companies', 'people'] },
    requiredFields: {
      type: 'array',
      items: { type: 'string', enum: [...RESEARCH_FIELDS] },
    },
    outputFields: { type: 'array', items: { type: 'string' } },
    filters: { type: 'object' },
    clarificationRequired: { type: 'boolean' },
    clarificationQuestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'question'],
      },
    },
  },
  required: ['requiredFields', 'clarificationRequired'],
}

export function buildSystemPrompt(): string {
  const catalog = RESEARCH_FIELDS.map(
    (field) => `- ${field}: ${FIELD_DESCRIPTIONS[field]}`,
  ).join('\n')

  return `You plan B2B research for a sales prospecting tool.

You are given a question about a list of business contacts and the companies
they work for. You do NOT answer the question. You decide which pieces of
information must be researched in order to answer it.

You may ONLY choose fields from this catalog. Never invent a field name:

${catalog}

RULES

1. Choose the SMALLEST set of fields that answers the question. Every extra
   field costs the customer money. If the question only asks for email
   addresses, choose only contact fields — never funding or technology.
2. Never state a fact. You do not know any company's funding, size, or
   technology. You only decide what needs looking up.
3. Put the user's criteria in "filters" using their own numbers and words.
   Do not invent thresholds the user did not give.
4. Set clarificationRequired to true ONLY when two reasonable readings of the
   question would lead to genuinely different research. A vague time period
   such as "recently" is worth asking about. A question that already names a
   round, a figure, or a date range is not.
5. Ask at most two clarification questions, each with concrete options.
6. "outputFields" are the columns to display. They never widen what is
   researched.
7. Interpret obvious spelling mistakes from context, but preserve company,
   person, product, and domain names exactly as the user wrote them.

Reply with JSON only.`
}

export type PlannerOutcome =
  | { status: 'planned'; plan: ResearchPlan; vendor: string; model: string }
  | {
      status: 'clarification_required'
      plan: ResearchPlan
      questions: ResearchPlan['clarificationQuestions']
      vendor: string
      model: string
    }
  | { status: 'refused'; reason: string }
  | { status: 'failed'; reason: string }

export type PlanQueryOptions = {
  question: string
  llm?: LLMProvider
  /** One retry with the validation error fed back. Two total attempts. */
  maxAttempts?: number
}

/**
 * Common funding questions do not need a model to repeat words the user
 * already supplied. This path is intentionally narrow: it handles explicit
 * round/date or investor-count requests and leaves open-ended research to the
 * LLM router.
 */
function deterministicFundingPlan(question: string): ResearchPlan | null {
  const lower = question.toLowerCase()
  const fundingIntent = /\b(fund(?:ing|ed)?|rais(?:e|ed|es|ing)|series\s+[a-j]|investors?)\b/i.test(
    question,
  )
  if (!fundingIntent) return null

  // Absolute natural-language dates belong to the model-backed parser. The
  // fast path only handles relative windows it can normalize without guessing.
  if (/\b(after|since|before)\b/i.test(question)) return null

  // Amount comparisons need currency/number parsing beyond this narrow path.
  if (/[$€£¥]|\b(?:usd|eur|gbp|cad|aud|inr)\b|\b(?:over|under|more than|less than)\s+[$€£¥]?\d/i.test(question) && !/more than\s+(?:one|two|three|four|five|six|seven|eight|nine|ten)\s+investors?/i.test(question)) {
    return null
  }

  const required = new Set<ResearchField>()
  if (/\binvestors?\b/.test(lower)) required.add('funding_investors')
  if (/\b(series\s+[a-j]|round|stage)\b/.test(lower)) required.add('funding_round')
  if (/\b(this week|past\s+\d+|last\s+\d+|recent|recently|when|date|latest)\b/.test(lower)) {
    required.add('funding_date')
  }

  if (required.size === 0) return null

  const vagueRecent = /\b(recent|recently|right now)\b/.test(lower) &&
    !/\b(this week|past\s+\d+\s+(?:day|week|month)s?|last\s+\d+\s+(?:day|week|month)s?|after|since)\b/.test(lower)

  const base: ResearchPlan = {
    entityScope: 'companies',
    requiredFields: [...required],
    outputFields: [...required],
    filters: {},
    clarificationRequired: vagueRecent,
    clarificationQuestions: vagueRecent
      ? [
          {
            id: 'funding_window',
            question: 'What should count as recently funded?',
            options: ['1 month', '3 months', '6 months', '12 months'],
          },
        ]
      : [],
  }

  return preserveExplicitConstraints(question, base)
}

/**
 * A narrowly explicit email request needs no model interpretation. Keeping
 * this deterministic prevents a planner from adding seniority or other paid
 * fields to "just give me their work emails".
 */
function deterministicEmailPlan(question: string): ResearchPlan | null {
  const lower = question.toLowerCase()
  if (!/\b(?:work|business|professional|corporate)\s+email(?: address)?(?:es)?\b/.test(lower)) {
    return null
  }

  const otherResearchIntent =
    /\b(?:fund(?:ing|ed)?|rais(?:e|ed|es|ing)|headcount|employees?|industry|revenue|technolog(?:y|ies)|tech stack|hiring|news|competitors?|pricing|reviews?|phone|mobile)\b/
  if (otherResearchIntent.test(lower)) return null

  const fields: ResearchField[] = ['work_email']
  if (/\b(?:verified|valid|deliverable|status)\b/.test(lower)) fields.push('email_status')

  return {
    entityScope: 'people',
    requiredFields: fields,
    outputFields: fields,
    filters: {},
    clarificationRequired: false,
    clarificationQuestions: [],
  }
}

/**
 * Turns a question into a validated plan.
 *
 * Never throws. A model that is unreachable, misconfigured, or producing
 * nonsense yields a `failed` outcome — research simply does not start, and
 * nothing is charged.
 */
export async function planQuery(options: PlanQueryOptions): Promise<PlannerOutcome> {
  const question = options.question.trim()

  if (!question) return { status: 'failed', reason: 'The question was empty.' }
  if (question.length > 2000) {
    return { status: 'failed', reason: 'That question is too long to plan.' }
  }

  // Refused BEFORE the model sees it. Qualification on protected
  // characteristics is not something to negotiate with a model about.
  if (usesProtectedCharacteristic(question)) {
    return {
      status: 'refused',
      reason:
        'Outlio qualifies on business attributes only — role, company, industry, ' +
        'size, funding, technology, geography, and business activity. It cannot ' +
        'filter people by personal characteristics.',
    }
  }

  const emailPlan = deterministicEmailPlan(question)
  const deterministic = emailPlan ?? deterministicFundingPlan(question)
  const deterministicModel = emailPlan ? 'email-rules-v1' : 'funding-rules-v1'
  if (deterministic) {
    if (deterministic.clarificationRequired) {
      return {
        status: 'clarification_required',
        plan: deterministic,
        questions: deterministic.clarificationQuestions,
        vendor: 'deterministic',
        model: deterministicModel,
      }
    }

    return {
      status: 'planned',
      plan: deterministic,
      vendor: 'deterministic',
      model: deterministicModel,
    }
  }

  const llm = options.llm ?? resolveLlmProvider()
  if (!llm.isConfigured()) {
    return { status: 'failed', reason: 'No language model is configured.' }
  }

  const system = buildSystemPrompt()
  const attempts = Math.max(1, options.maxAttempts ?? 2)
  let lastReason = 'The planner could not produce a usable plan.'

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const user =
      attempt === 0
        ? question
        : // Feed the SHAPE error back, never the model's previous output — that
          // would let a bad completion steer the retry.
          `${question}\n\nYour previous reply was rejected: ${lastReason}\nReturn valid JSON matching the schema.`

    const result = await llm.generateJson({
      system,
      user,
      schema: PLAN_RESPONSE_SCHEMA,
      validate: (candidate) => validatePlan(candidate).ok,
    })

    if (!result.ok) {
      lastReason =
        result.code === 'not_configured'
          ? 'No language model is configured.'
          : 'The planner was unavailable.'
      if (result.code === 'not_configured') break
      continue
    }

    const validation = validatePlan(result.json)
    if (!validation.ok) {
      lastReason = validation.reason
      continue
    }

    const plan = preserveExplicitConstraints(question, validation.plan)

    if (plan.clarificationRequired && plan.clarificationQuestions.length > 0) {
      return {
        status: 'clarification_required',
        plan,
        questions: plan.clarificationQuestions,
        vendor: result.vendor,
        model: result.model,
      }
    }

    /*
     * A model that asks for clarification without providing a question would
     * stall the run forever. Treat it as executable rather than hanging: the
     * fields it chose are still a usable plan.
     */
    return {
      status: 'planned',
      plan: { ...plan, clarificationRequired: false },
      vendor: result.vendor,
      model: result.model,
    }
  }

  return { status: 'failed', reason: lastReason }
}

/**
 * Folds clarification answers back into a plan (spec §7).
 *
 * The answers are recorded in `filters` under their question id, so the
 * qualification engine sees them as ordinary criteria and the run carries a
 * record of what the user actually chose.
 */
export function applyClarifications(
  plan: ResearchPlan,
  answers: Record<string, string>,
): ResearchPlan {
  const answered = Object.entries(answers).filter(([, value]) => value.trim().length > 0)

  return {
    ...plan,
    clarificationRequired: false,
    clarificationQuestions: [],
    filters: { ...plan.filters, ...Object.fromEntries(answered) },
  }
}
