/**
 * The research vocabulary.
 *
 * PURE — types, field metadata, and the provider contract. No I/O.
 *
 * Two rules this file exists to enforce:
 *
 *  1. **The agent never names a vendor.** It asks for FIELDS; a field maps to a
 *     tool CATEGORY; a category maps to an ordered list of providers chosen by
 *     configuration. Swapping Crunchbase for Harmonic changes config, not
 *     agent logic (spec §36, §37).
 *
 *  2. **A field knows what kind of entity it belongs to.** Company fields are
 *     researched once per company, never once per employee — that single
 *     distinction is most of the cost control in this product (spec §9).
 */
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export const ENTITY_TYPES = ['company', 'person'] as const
export type EntityType = (typeof ENTITY_TYPES)[number]

/** Everything a provider may be told about a company. */
export type CompanyEntity = {
  type: 'company'
  id: string
  name: string | null
  domain: string | null
  linkedinUrl: string | null
}

/**
 * Everything a provider may be told about a person.
 *
 * Deliberately narrow: professional identifiers only. Nothing here can express
 * a protected characteristic (spec §44).
 */
export type PersonEntity = {
  type: 'person'
  id: string
  fullName: string | null
  linkedinUrl: string | null
  jobTitle: string | null
  companyName: string | null
  companyDomain: string | null
  /**
   * The company this person works at.
   *
   * Carried so a person-level provider can attribute company facts it returns
   * as a side effect — Prospeo answers "find this person's email" with the
   * employer's domain, headcount, funding and tech stack attached. Without an
   * id to file them against, that data would be discarded.
   */
  companyId: string | null
}

export type ResearchEntity = CompanyEntity | PersonEntity

// ---------------------------------------------------------------------------
// Tool categories
// ---------------------------------------------------------------------------

export const TOOL_CATEGORIES = [
  'company_profile',
  'funding',
  'tech_stack',
  'product_activity',
  'web_research',
  'website',
  'reputation',
  'technical_presence',
  'contact_email',
  'contact_phone',
  'contact_verification',
] as const

export type ToolCategory = (typeof TOOL_CATEGORIES)[number]

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

export const RESEARCH_FIELDS = [
  // company_profile
  'company_domain',
  'employee_count',
  'industry',
  'headquarters',
  'company_description',
  'business_model',
  'revenue_estimate',
  // Official company registry facts
  'company_number',
  'company_status',
  'company_type',
  'jurisdiction',
  'incorporation_date',
  'sic_codes',
  'registered_office',
  'accounts_overdue',
  'confirmation_statement_overdue',
  'insolvency_history',
  // funding
  'funding_round',
  'funding_amount',
  'funding_currency',
  'funding_date',
  'funding_investors',
  // tech_stack
  'tech_stack',
  // product_activity
  'product_launches',
  // web_research
  'recent_news',
  'hiring_signals',
  'competitors',
  // website
  'website_signals',
  'pricing_signals',
  // reputation
  'review_presence',
  'review_rating',
  'review_count',
  // technical_presence
  'github_presence',
  // contact
  'work_email',
  'email_status',
  'mobile_phone',
  'phone_status',
] as const

export type ResearchField = (typeof RESEARCH_FIELDS)[number]

export const researchFieldSchema = z.enum(RESEARCH_FIELDS)

type FieldSpec = { category: ToolCategory; entity: EntityType }

/**
 * Field → tool category and entity type.
 *
 * `Record<ResearchField, …>` is load-bearing: adding a field without deciding
 * which tool answers it, and whether it is a company or a person fact, is a
 * compile error rather than a silent routing gap.
 */
export const RESEARCH_FIELD_SPEC: Record<ResearchField, FieldSpec> = {
  // Discovered when the captured lead carried no website. Everything that keys
  // on a domain — website intelligence, tech-stack detection — depends on it.
  company_domain: { category: 'company_profile', entity: 'company' },
  employee_count: { category: 'company_profile', entity: 'company' },
  industry: { category: 'company_profile', entity: 'company' },
  headquarters: { category: 'company_profile', entity: 'company' },
  company_description: { category: 'company_profile', entity: 'company' },
  business_model: { category: 'company_profile', entity: 'company' },
  revenue_estimate: { category: 'company_profile', entity: 'company' },
  company_number: { category: 'company_profile', entity: 'company' },
  company_status: { category: 'company_profile', entity: 'company' },
  company_type: { category: 'company_profile', entity: 'company' },
  jurisdiction: { category: 'company_profile', entity: 'company' },
  incorporation_date: { category: 'company_profile', entity: 'company' },
  sic_codes: { category: 'company_profile', entity: 'company' },
  registered_office: { category: 'company_profile', entity: 'company' },
  accounts_overdue: { category: 'company_profile', entity: 'company' },
  confirmation_statement_overdue: { category: 'company_profile', entity: 'company' },
  insolvency_history: { category: 'company_profile', entity: 'company' },

  funding_round: { category: 'funding', entity: 'company' },
  funding_amount: { category: 'funding', entity: 'company' },
  funding_currency: { category: 'funding', entity: 'company' },
  funding_date: { category: 'funding', entity: 'company' },
  funding_investors: { category: 'funding', entity: 'company' },

  tech_stack: { category: 'tech_stack', entity: 'company' },
  product_launches: { category: 'product_activity', entity: 'company' },

  recent_news: { category: 'web_research', entity: 'company' },
  hiring_signals: { category: 'web_research', entity: 'company' },
  competitors: { category: 'web_research', entity: 'company' },

  website_signals: { category: 'website', entity: 'company' },
  pricing_signals: { category: 'website', entity: 'company' },

  review_presence: { category: 'reputation', entity: 'company' },
  review_rating: { category: 'reputation', entity: 'company' },
  review_count: { category: 'reputation', entity: 'company' },

  github_presence: { category: 'technical_presence', entity: 'company' },

  work_email: { category: 'contact_email', entity: 'person' },
  email_status: { category: 'contact_email', entity: 'person' },
  mobile_phone: { category: 'contact_phone', entity: 'person' },
  phone_status: { category: 'contact_phone', entity: 'person' },
}

export function categoryForField(field: ResearchField): ToolCategory {
  return RESEARCH_FIELD_SPEC[field].category
}

export function entityTypeForField(field: ResearchField): EntityType {
  return RESEARCH_FIELD_SPEC[field].entity
}

// ---------------------------------------------------------------------------
// Source confidence (spec §17)
// ---------------------------------------------------------------------------

export const SOURCE_CONFIDENCES = ['high', 'medium', 'low'] as const
export type SourceConfidence = (typeof SOURCE_CONFIDENCES)[number]

/**
 * Ordering used when two sources disagree. Higher wins; recency breaks ties.
 *
 *   high   — official company source, official API, public filing, trusted
 *            structured business database
 *   medium — reputable publication, established directory, verified reviews
 *   low    — unverified secondary source, ambiguous web result
 */
export const SOURCE_CONFIDENCE_RANK: Record<SourceConfidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
}

// ---------------------------------------------------------------------------
// Evidence (spec §16)
// ---------------------------------------------------------------------------

/**
 * One researched fact with its provenance.
 *
 * ⚠️ An LLM statement is NOT evidence. Every row here traces to an API, a
 * public webpage, a trusted provider, or data Outlio already held.
 */
export const normalizedEvidenceSchema = z.object({
  field: researchFieldSchema,
  entityType: z.enum(ENTITY_TYPES),
  entityId: z.string().uuid(),
  /** Always an object so a value can carry units, currency, or a range. */
  value: z.record(z.string(), z.unknown()),
  sourceProvider: z.string().min(1).max(64),
  /**
   * ⚠️ http/https ONLY. A source URL is rendered as a clickable "view source"
   * link, and Zod's `.url()` happily accepts `javascript:alert(1)` — which
   * would make a hostile provider response into stored XSS.
   */
  sourceUrl: z
    .string()
    .max(2048)
    .refine((value) => {
      try {
        const protocol = new URL(value).protocol
        return protocol === 'http:' || protocol === 'https:'
      } catch {
        return false
      }
    }, 'source_url must be an http(s) URL')
    .nullable()
    .default(null),
  sourceConfidence: z.enum(SOURCE_CONFIDENCES),
  confidence: z.number().min(0).max(1),
  retrievedAt: z.string().datetime(),
  /** `null` means the fact does not go stale. */
  expiresAt: z.string().datetime().nullable(),
})

export type NormalizedEvidence = z.infer<typeof normalizedEvidenceSchema>

/** Evidence as it comes back out of the database. */
export type EvidenceRecord = NormalizedEvidence & {
  id: string
  researchRunId: string | null
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/**
 * One unit of external research: everything one provider category is being
 * asked for about one entity.
 *
 * Fields are batched into a single task rather than one task per field, because
 * providers answer several fields per call and paying twice for one response is
 * exactly what this system exists to avoid.
 */
export type ResearchTask = {
  /** Stable within a run: `${category}:${entityType}:${entityId}`. */
  id: string
  category: ToolCategory
  entity: ResearchEntity
  fields: ResearchField[]
}

export type TaskOutcome =
  | { status: 'success'; evidence: NormalizedEvidence[] }
  /** The provider answered and had nothing. Distinct from a failure. */
  | { status: 'not_found' }
  | { status: 'error'; code: string }
  | { status: 'timeout' }
  | { status: 'skipped'; reason: string }

/**
 * Result of one attempt against one provider. Recorded whatever the outcome —
 * a provider that fails often is a fact worth knowing (spec §48).
 */
export type ToolCallRecord = {
  provider: string
  tool: ToolCategory
  entityType: EntityType
  entityId: string
  status: 'success' | 'not_found' | 'error' | 'timeout' | 'skipped'
  latencyMs: number
  estimatedCostMicros: number
  errorCode: string | null
}

// ---------------------------------------------------------------------------
// The provider contract (spec §36)
// ---------------------------------------------------------------------------

/**
 * Every external data source implements this and nothing more.
 *
 * The agent depends on this interface, never on a vendor. That is what makes a
 * provider replaceable infrastructure rather than a load-bearing dependency —
 * and what will let these be exposed over MCP later without rewriting anything.
 */
export interface IntelligenceProvider<TOutput = unknown> {
  readonly name: string
  readonly category: ToolCategory

  /** False means "not my job" — the router moves to the next provider. */
  canHandle(task: ResearchTask): boolean

  /** Integer micros. Quoted before spending, so a job can be priced upfront. */
  estimateCost(task: ResearchTask): Promise<number>

  execute(task: ResearchTask): Promise<TOutput>

  /**
   * Provider shape → evidence. Anything that cannot be expressed as evidence
   * with a source must be dropped here, not smuggled through as a bare value.
   */
  normalize(output: TOutput, task: ResearchTask): NormalizedEvidence[]
}

/**
 * A provider with its output type sealed away.
 *
 * `IntelligenceProvider<T>` is invariant in `T` — the type appears both as a
 * return (`execute`) and as a parameter (`normalize`) — so a registry cannot
 * hold providers with different output shapes without either `any` or a lie.
 * Pairing the two calls behind `run` keeps `T` private to the adapter that
 * authored it, and keeps the four-method contract above intact.
 */
export type AnyIntelligenceProvider = {
  readonly name: string
  readonly category: ToolCategory
  canHandle(task: ResearchTask): boolean
  estimateCost(task: ResearchTask): Promise<number>
  run(task: ResearchTask): Promise<NormalizedEvidence[]>
}

/** Seals a provider's output type so it can be registered alongside others. */
export function eraseProviderType<T>(
  provider: IntelligenceProvider<T>,
): AnyIntelligenceProvider {
  return {
    name: provider.name,
    category: provider.category,
    canHandle: (task) => provider.canHandle(task),
    estimateCost: (task) => provider.estimateCost(task),
    run: async (task) => provider.normalize(await provider.execute(task), task),
  }
}
