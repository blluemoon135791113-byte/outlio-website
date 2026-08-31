export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]


// ---------------------------------------------------------------------------
// Enums — mirror the Postgres enum types in 0001
// ---------------------------------------------------------------------------

export type UserRole =
  | 'registered_user'
  | 'pending_user'
  | 'approved_user'
  | 'subscriber'
  | 'admin'
  | 'suspended_user'

export type AccessRequestType =
  | 'payment'
  | 'sales_call'
  | 'manual_approval'
  | 'trial'
  | 'invitation'

export type AccessRequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'suspended'

export type JobStatus =
  | 'uploaded'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'partially_completed'
  | 'failed'
  | 'cancelled'

export type FileStatus = 'pending' | 'processing' | 'processed' | 'failed'

export type QueueStatus = 'pending' | 'claimed' | 'done' | 'failed'

export type DedupeMode = 'keep_all' | 'remove_exact' | 'remove_likely' | 'review'

/** Priority order matters — see spec §12.1 and lib/leads/dedupe.ts */
export type DedupeStrategy =
  | 'linkedin_url_canonical'
  | 'salesnav_id'
  | 'name_company'
  | 'name_title_company'
  | 'row_hash'

export type PlanKey = 'trial' | 'starter' | 'professional' | 'agency' | 'custom'

export type SubscriptionStatus = 'active' | 'past_due' | 'cancelled' | 'expired'

export type UsageMetric =
  | 'extractions'
  | 'files'
  | 'records'
  | 'exports'
  | 'storage_bytes'

export type IntegrationConnectionStatus =
  | 'not_connected'
  | 'connecting'
  | 'connected'
  | 'reconnect_required'
  | 'error'

export type LeadExportJobStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'partial'
  | 'failed'

/**
 * Shape of `plans.limits`. `null` means unlimited.
 * Read at runtime — never hardcode a limit in application code.
 */
export type PlanLimits = {
  /** Monthly extraction-credit allowance. `null` means unlimited. */
  credits_per_month: number | null
  files_per_extraction: number | null
  /**
   * Leads per credit for one extraction, aggregated across the whole run:
   * cost = ceil(total_leads / this), min 1. `null` means a flat 1 credit per
   * extraction. Charged only once the run is parsed — see migration 0030.
   */
  leads_per_credit: number | null
  extractions_per_day: number | null
  extractions_per_month: number | null
  records_per_extraction: number | null
  records_per_month: number | null
  storage_bytes: number | null
  exports_per_month: number | null
  retention_days: number | null
  /**
   * Contact lookups per month.
   *
   * The only bound on automatic enrichment spend. `null` means genuinely
   * unlimited; ABSENT means a safe default, never unlimited — see
   * `planLimitsSchema`.
   */
  contact_enrichments_per_month: number | null

  /**
   * Platform module entitlements (Ledger D5).
   *
   * ABSENT means the default in `planLimitsSchema`, not `false` — existing plan
   * rows predate these keys and must keep behaving exactly as they do now. A
   * workspace feature flag can additionally switch a module off, never on.
   */
  crm_enabled: boolean
  email_enabled: boolean
  flows_enabled: boolean
  reports_enabled: boolean
  integrations_enabled: boolean
  hubble_enabled: boolean

  /** Seats per workspace, owner included. `null` means unlimited. */
  workspace_member_limit: number | null
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export type PlanRow = {
  id: string
  key: PlanKey
  name: string
  description: string | null
  is_active: boolean
  sort_order: number
  limits: PlanLimits
  created_at: string
  updated_at: string
}

export type ProfileRow = {
  id: string
  email: string | null
  full_name: string | null
  company_name: string | null
  /** E.164, e.g. +447700900123. Required at sign-up; nullable for admin-created users. */
  phone: string | null
  /** Canonical https://www.linkedin.com/in/{slug}. NEVER fetched — see CLAUDE.md rule 1. */
  linkedin_url: string | null
  /** Private Supabase Storage path in the avatars bucket. */
  avatar_path: string | null
  role: UserRole
  plan_id: string | null
  access_expires_at: string | null
  /** This user's own code for inviting others. Allocated for every profile. */
  referral_code: string | null
  suspended_at: string | null
  suspended_reason: string | null
  consent_accepted_at: string | null
  /** Admin kill-switch for the browser extension, independent of billing. */
  extension_enabled: boolean
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export type AccessRequestRow = {
  id: string
  user_id: string
  request_type: AccessRequestType
  status: AccessRequestStatus
  message: string | null
  admin_note: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

export type SubscriptionRow = {
  id: string
  user_id: string
  plan_id: string
  status: SubscriptionStatus
  provider: string
  provider_ref: string | null
  current_period_start: string
  current_period_end: string | null
  cancel_at: string | null
  cancelled_at: string | null
  /** The profile expiry before a cancellation was scheduled, so resume restores it. */
  access_expires_at_before_cancel: string | null
  paddle_customer_id: string | null
  paddle_price_id: string | null
  paddle_product_id: string | null
  fastspring_account_id: string | null
  fastspring_product_path: string | null
  fastspring_event_at: string | null
  scheduled_change_action: string | null
  scheduled_change_at: string | null
  paddle_event_at: string | null
  granted_by: string | null
  created_at: string
  updated_at: string
}

export type FastSpringWebhookEventRow = {
  event_id: string
  event_type: string
  occurred_at: string
  processed_at: string
}

export type FastSpringAccountRow = {
  account_id: string
  user_id: string | null
  email: string | null
  name: string | null
  company: string | null
  country: string | null
  language: string | null
  tags: Json | null
  last_event_at: string
  created_at: string
  updated_at: string
}

export type FastSpringSubscriptionRow = {
  subscription_id: string
  account_id: string
  user_id: string | null
  state: string
  /** FastSpring keeps this true on a canceled subscription until its paid period ends. */
  active: boolean
  product_path: string
  plan_key: string | null
  billing_interval: string | null
  auto_renew: boolean | null
  currency: string | null
  price: number | null
  begin_at: string | null
  next_charge_at: string | null
  canceled_at: string | null
  deactivated_at: string | null
  tags: Json | null
  last_event_at: string
  created_at: string
  updated_at: string
}

export type FastSpringOrderRow = {
  order_id: string
  account_id: string | null
  subscription_id: string | null
  user_id: string | null
  reference: string | null
  live: boolean
  currency: string
  total: number | null
  product_path: string | null
  tags: Json | null
  completed_at: string | null
  last_event_at: string
  created_at: string
  updated_at: string
}

export type UsageCounterRow = {
  id: string
  user_id: string
  metric: UsageMetric
  period_start: string
  period_end: string
  count: number
  created_at: string
  updated_at: string
}

export type InvitationCodeRow = {
  id: string
  code: string
  plan_id: string | null
  max_uses: number
  used_count: number
  expires_at: string | null
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export type ExtractionJobRow = {
  id: string
  user_id: string
  status: JobStatus
  dedupe_mode: DedupeMode
  /** Set for extension captures; NULL for HTML uploads. See migration 0032. */
  capture_session_id: string | null
  /** Credits spent once the lead count was known. NULL until charged. */
  credits_charged: number | null
  file_count: number
  total_bytes: number
  progress_step: string | null
  progress_current: number
  progress_total: number
  leads_parsed: number
  leads_kept: number
  /**
   * What this run ingests. `lead_search` yields people; `account_list` yields
   * companies. Set by the worker from the detected page type — the browser
   * does not know what is inside the file it uploaded. See migration 0066.
   */
  kind: 'lead_search' | 'account_list'
  accounts_parsed: number
  accounts_created: number
  accounts_matched: number
  accounts_unidentified: number
  duplicates_found: number
  duplicates_removed: number
  export_storage_path: string | null
  error_code: string | null
  error_message: string | null
  request_id: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export type UploadedFileRow = {
  id: string
  user_id: string
  extraction_job_id: string
  original_filename: string
  storage_path: string
  byte_size: number
  content_sha256: string
  status: FileStatus
  leads_found: number
  error_code: string | null
  error_message: string | null
  processed_at: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

/** Columns come from docs/SELECTOR_MAP.md §3. All parsed fields are nullable. */
export type ExtractedLeadRow = {
  id: string
  user_id: string
  extraction_job_id: string
  uploaded_file_id: string | null
  full_name: string | null
  linkedin_url: string | null
  sales_navigator_url: string | null
  job_title: string | null
  company_name: string | null
  company_url: string | null
  company_website_url: string | null
  location: string | null
  person_blurb: string | null
  tenure_in_role: string | null
  tenure_in_company: string | null
  source_page: string | null
  source_row_index: number | null
  dedupe_key: string
  dedupe_strategy: DedupeStrategy
  is_duplicate: boolean
  duplicate_of_id: string | null
  raw_data: Json | null
  /** Resolved company identity. NULL until the linking step runs. */
  company_id: string | null
  company_match_strategy: CompanyMatchStrategy | null
  /**
   * Intelligence values the user merged onto this lead, keyed by research
   * field, each carrying its own provenance. `{}` until a merge happens.
   *
   * A cache of a decision — `research_evidence` remains the record of what was
   * found. See migration 0051.
   */
  enrichment: Json

  /** The Sales Navigator list or search the lead came from (migration 0053). */
  source_list: string | null

  /* ---- from a company page the user opened (migration 0054) --------------- */
  company_public_linkedin_url: string | null
  /** EXACT headcount. `company_size` is the hover card's range instead. */
  company_employee_count: number | null
  company_decision_maker_count: number | null
  company_investor_count: number | null
  /** 'search' | 'decision_maker' | 'investor'. */
  lead_source: string | null

  /* ---- also on the saved page (migration 0052) --------------------------- */
  connection_degree: string | null
  is_reachable: boolean | null
  list_count: number | null
  last_activity: string | null
  added_to_list_at: string | null

  /* ---- from the company hover card --------------------------------------- */
  company_industry: string | null
  /** A RANGE as LinkedIn rendered it, e.g. "2-10 employees". */
  company_size: string | null
  company_headquarters: string | null

  /* ---- enrichment only; never on a Sales Navigator page ------------------- */
  work_email: string | null
  email_status: string | null
  mobile_phone: string | null
  phone_status: string | null
  /** NULL means never looked; a timestamp with no email means none exists. */
  contact_enriched_at: string | null

  created_at: string
  updated_at: string
}

/** Identity precedence: domain beats LinkedIn URL beats name (spec §9). */
export type CompanyMatchStrategy = 'domain' | 'linkedin' | 'name'

/**
 * One row per distinct company per user — the unit of company-level research.
 *
 * `industry` / `employee_count` / `headquarters` are projections of the current
 * best value. `research_evidence` holds the provenance and expiry.
 */
export type CompanyRow = {
  id: string
  user_id: string
  name: string | null
  normalized_name: string | null
  domain: string | null
  normalized_domain: string | null
  linkedin_url: string | null
  normalized_linkedin_url: string | null
  industry: string | null
  employee_count: number | null
  headquarters: string | null
  contact_email: string | null
  contact_email_status: string | null
  contact_phone: string | null
  contact_phone_status: string | null
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Research intelligence (0044)
// ---------------------------------------------------------------------------

export type ResearchRunStatus =
  | 'pending'
  | 'planning'
  | 'waiting_for_clarification'
  | 'running'
  | 'partially_complete'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type ResearchEntityType = 'company' | 'person'

export type ResearchSourceConfidence = 'high' | 'medium' | 'low'

/** One user question. The debugging record for a system that spends money. */
export type ResearchRunRow = {
  id: string
  user_id: string
  status: ResearchRunStatus
  query_text: string
  scope: Json
  /** The validated ResearchPlan. External research never runs without one. */
  plan: Json | null
  clarifications: Json
  lead_count: number
  company_count: number
  qualified_count: number
  tools_used: string[]
  external_call_count: number
  cache_hit_count: number
  /** Integer micros. Never a float. */
  estimated_cost_micros: number
  actual_cost_micros: number
  duration_ms: number | null
  /** The ICP this run was scored against. NULL means research only. */
  qualification_profile_id: string | null
  error_code: string | null
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

/** A researched fact with provenance and expiry. No row means unknown. */
export type ResearchEvidenceRow = {
  id: string
  user_id: string
  entity_type: ResearchEntityType
  entity_id: string
  field: string
  value_json: Json
  source_provider: string
  source_url: string | null
  source_confidence: ResearchSourceConfidence
  confidence: number
  retrieved_at: string
  /** NULL means the fact does not go stale. */
  expires_at: string | null
  research_run_id: string | null
  created_at: string
}

/** Service-role only, no policies — same shape as JobQueueRow. */
export type ResearchJobQueueRow = {
  id: string
  research_run_id: string
  status: QueueStatus
  attempts: number
  max_attempts: number
  claimed_at: string | null
  claimed_by: string | null
  next_attempt_at: string
  last_error: string | null
  created_at: string
  updated_at: string
}

/** Per-external-call observability. Never holds secrets or raw responses. */
export type ResearchToolCallRow = {
  id: string
  user_id: string
  research_run_id: string | null
  provider: string
  tool: string
  entity_type: ResearchEntityType | null
  entity_id: string | null
  status: 'success' | 'not_found' | 'error' | 'timeout' | 'skipped'
  latency_ms: number | null
  estimated_cost_micros: number
  error_code: string | null
  created_at: string
}

/** Global cache for reusable public provider indexes (0049). */
export type ProviderCacheRow = {
  provider: string
  cache_key: string
  value_json: Json
  retrieved_at: string
  expires_at: string
  created_at: string
  updated_at: string
}

/** Global provider request pacing state (0049). */
export type ProviderRequestScheduleRow = {
  provider: string
  last_started_at: string | null
  updated_at: string
}

// ---------------------------------------------------------------------------
// Qualification (0046)
// ---------------------------------------------------------------------------

export type QualificationKind = 'required' | 'preferred' | 'excluded'

export type QualificationOperator =
  | 'equals'
  | 'not_equals'
  | 'in'
  | 'not_in'
  | 'between'
  | 'gte'
  | 'lte'
  | 'contains'
  | 'not_contains'
  | 'exists'

export type QualificationProfileRow = {
  id: string
  user_id: string
  name: string
  description: string | null
  /** Score at or above which a lead counts as qualified. Never hardcoded. */
  qualify_at: number
  is_archived: boolean
  created_at: string
  updated_at: string
}

/**
 * `field` is CHECK-constrained to the research vocabulary, so a criterion on a
 * protected characteristic cannot be stored at all (spec §44).
 */
export type QualificationRuleRow = {
  id: string
  user_id: string
  profile_id: string
  field: string
  operator: QualificationOperator
  value: Json | null
  value_path: string | null
  weight: number
  kind: QualificationKind
  sort_order: number
  created_at: string
  updated_at: string
}

export type QualificationResultRow = {
  id: string
  user_id: string
  research_run_id: string | null
  profile_id: string | null
  entity_type: ResearchEntityType
  entity_id: string
  score: number
  qualified: boolean
  disqualified_by: string | null
  unknown_count: number
  breakdown: Json
  created_at: string
}

/** Safe metadata only. Provider credentials are stored in IntegrationSecretRow. */
export type IntegrationConnectionRow = {
  id: string
  user_id: string
  provider: string
  status: IntegrationConnectionStatus
  external_account_id: string | null
  external_account_name: string | null
  external_account_email: string | null
  scopes: string[]
  configuration: Json
  secret_reference: string
  token_expires_at: string | null
  connected_at: string | null
  last_used_at: string | null
  last_tested_at: string | null
  /** Client-safe summary only; raw provider errors must not be stored here. */
  last_error: string | null
  created_at: string
  updated_at: string
}

/** Service-role only. `encrypted_payload` is an AES-256-GCM envelope. */
export type IntegrationSecretRow = {
  id: string
  connection_id: string
  encrypted_payload: string
  created_at: string
  updated_at: string
}

/** Service-role only, short-lived OAuth state and encrypted PKCE verifier. */
export type IntegrationOAuthTransactionRow = {
  id: string
  user_id: string
  provider: string
  state_hash: string
  encrypted_code_verifier: string | null
  redirect_uri: string
  return_to: string
  expires_at: string
  created_at: string
}

export type ExportJobRow = {
  id: string
  user_id: string
  extraction_job_id: string | null
  provider: string
  status: LeadExportJobStatus
  lead_count: number
  successful_count: number
  failed_count: number
  destination_id: string | null
  destination_url: string | null
  options: Json
  error_code: string | null
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export type ExportJobErrorRow = {
  id: string
  export_job_id: string
  user_id: string
  lead_id: string | null
  error_code: string
  error_message: string
  created_at: string
}

export type IntegrationRecordLinkRow = {
  id: string
  user_id: string
  connection_id: string
  lead_id: string
  provider_record_id: string
  created_at: string
  updated_at: string
}

export type JobQueueRow = {
  id: string
  job_id: string
  status: QueueStatus
  attempts: number
  max_attempts: number
  claimed_at: string | null
  claimed_by: string | null
  next_attempt_at: string
  last_error: string | null
  created_at: string
  updated_at: string
}

export type AdminAuditLogRow = {
  id: string
  admin_id: string | null
  action: string
  target_type: string | null
  target_id: string | null
  target_user_id: string | null
  before_state: Json | null
  after_state: Json | null
  reason: string | null
  request_id: string | null
  ip_address: string | null
  created_at: string
}

export type SystemEventRow = {
  id: string
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  event: string
  error_code: string | null
  message: string | null
  context: Json | null
  user_id: string | null
  job_id: string | null
  file_id: string | null
  request_id: string | null
  duration_ms: number | null
  created_at: string
}

/**
 * Dedupe identity retained AFTER lead rows are purged.
 * Contains no personal data — just an opaque key.
 */
export type LeadKeyRow = {
  id: string
  user_id: string
  dedupe_key: string
  first_seen: string
  last_seen: string
  seen_count: number
}

export type RateLimitRow = {
  id: string
  bucket: string
  subject: string
  window_start: string
  attempts: number
  blocked_until: string | null
  created_at: string
  updated_at: string
}

/** Raw network addresses are never stored; both hashes are lowercase hex. */
export type SignupIpClaimRow = {
  ip_hash: string
  token_hash: string | null
  user_id: string | null
  reserved_until: string
  claimed_at: string | null
  created_at: string
  updated_at: string
}

/** Pseudonymous first-party device claim; the raw cookie value is not stored. */
export type SignupDeviceClaimRow = {
  device_hash: string
  user_id: string
  claimed_at: string
}

export type SignupIdentityKind = 'email' | 'phone' | 'linkedin'

/** HMAC of a normalized signup identity; no raw identity value is stored. */
export type SignupIdentityClaimRow = {
  identity_hash: string
  identity_kind: SignupIdentityKind
  user_id: string
  claimed_at: string
}

// ---------------------------------------------------------------------------
// Supabase client generic
// ---------------------------------------------------------------------------

/**
 * `Relationships` is required by postgrest-js's `GenericTable`. We declare it
 * empty because we do not use PostgREST's embedded-resource syntax; joins are
 * written explicitly. `npm run db:types` will populate it properly once the
 * migrations are applied.
 */
type TableShape<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

/* ---------------------------------------------------------------------------
 * Browser extension (migration 0032)
 * ------------------------------------------------------------------------- */

export type CaptureSessionStatus = 'active' | 'completed' | 'abandoned'

export type CapturePageStatus =
  | 'received'
  | 'queued'
  | 'processed'
  | 'duplicate'
  | 'failed'

export type ExtensionDeviceRow = {
  id: string
  user_id: string
  label: string
  browser: string | null
  platform: string | null
  /** Keyed hash. The token itself is returned once and never stored. */
  refresh_token_hash: string
  /** Id of the currently valid access token; nulled on revoke. */
  access_token_jti: string | null
  enabled: boolean
  created_at: string
  last_active_at: string | null
  revoked_at: string | null
  revoked_by: string | null
}

export type ExtensionPairingRow = {
  id: string
  user_id: string
  code_hash: string
  state: string
  label: string | null
  browser: string | null
  platform: string | null
  expires_at: string
  consumed_at: string | null
  created_at: string
}

export type CaptureSessionRow = {
  id: string
  user_id: string
  device_id: string | null
  status: CaptureSessionStatus
  source: string
  browser: string | null
  dedupe_mode: DedupeMode
  started_at: string
  completed_at: string | null
  pages_processed: number
  leads_found: number
  leads_imported: number
  duplicates_skipped: number
  created_at: string
}

export type CapturePageRow = {
  id: string
  capture_session_id: string
  user_id: string
  extraction_job_id: string | null
  source_url: string | null
  page_identifier: string | null
  status: CapturePageStatus
  leads_found: number
  /** SHA-256 of the captured HTML. The duplicate authority. */
  content_hash: string
  error: string | null
  created_at: string
  processed_at: string | null
}

/* ---------------------------------------------------------------------------
 * Ask Hubble (migration 0055)
 *
 * The open-ended research layer. `research_evidence` still owns field-shaped
 * facts; these own the pages Hubble read, the passages it retrieved, and the
 * answers it gave.
 * ------------------------------------------------------------------------- */

export type HubblePageRow = {
  id: string
  user_id: string
  /** Keyed by company so leads at the same company share one cache. */
  company_id: string | null
  url: string
  host: string
  title: string | null
  /** Extracted text only. Raw HTML is deliberately never stored. */
  content: string
  content_chars: number
  structured: Record<string, unknown>
  fetch_method: 'fetch' | 'browser'
  http_status: number | null
  fetched_at: string
  expires_at: string | null
  created_at: string
}

export type HubbleChunkRow = {
  id: string
  user_id: string
  page_id: string
  company_id: string | null
  ordinal: number
  content: string
  /** NULL when no embedding provider was configured — lexical retrieval then. */
  embedding: number[] | null
  embed_model: string | null
  created_at: string
}

export type HubbleAnswerRow = {
  id: string
  user_id: string
  lead_id: string | null
  company_id: string | null
  question: string
  /** Normalised question, for cache lookup. */
  question_key: string
  answer: string
  status: 'verified' | 'corroborated' | 'estimated' | 'unknown'
  confidence: number
  sources: unknown
  usage: Record<string, unknown>
  research_run_id: string | null
  created_at: string
  expires_at: string | null
}

/* ---------------------------------------------------------------------------
 * Typed company facts (migration 0056)
 *
 * A kind plus a value, rather than a column per possible fact. A company holds
 * only the links and signals it actually has — not eleven columns of which
 * nine are NULL.
 * ------------------------------------------------------------------------- */

export type CompanyLinkRow = {
  id: string
  user_id: string
  company_id: string
  /** See LINK_KINDS in lib/companies/links.ts. */
  kind: string
  url: string
  host: string
  source: 'company_page' | 'website' | 'provider' | 'derived'
  source_url: string | null
  observed_at: string
  created_at: string
}

export type CompanySignalRow = {
  id: string
  user_id: string
  company_id: string
  kind: string
  /** ⚠️ One of these is set, never both. Numbers stay numeric so SQL can sum. */
  value_number: number | null
  value_text: string | null
  unit: string | null
  source: 'company_page' | 'account_list' | 'website' | 'provider' | 'derived'
  source_url: string | null
  /** History is kept, not overwritten: two observations are a trend. */
  observed_at: string
  created_at: string
}

// ===========================================================================
// ⚠️ HAND-WRITTEN ABOVE THE GENERATED TYPES. DO NOT OVERWRITE THIS FILE.
//
// `supabase gen types typescript --linked > types/database.ts` replaces the
// WHOLE file and silently deletes everything in this block — roughly two dozen
// aliases (`ProfileRow`, `ExtractionJobRow`, `PlanLimits`, `JobStatus`, …)
// that the app imports directly. That is exactly how this section was lost
// once already: forty type errors, none of which name the real cause.
//
// To regenerate safely, write the generated output somewhere else and splice
// it in below this banner, keeping everything above it.
// ===========================================================================

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      access_requests: {
        Row: {
          admin_note: string | null
          created_at: string
          id: string
          message: string | null
          request_type: Database["public"]["Enums"]["access_request_type"]
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["access_request_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          created_at?: string
          id?: string
          message?: string | null
          request_type: Database["public"]["Enums"]["access_request_type"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["access_request_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          created_at?: string
          id?: string
          message?: string | null
          request_type?: Database["public"]["Enums"]["access_request_type"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["access_request_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      account_list_entries: {
        Row: {
          alert: string | null
          company_id: string
          company_name_snapshot: string
          company_sales_navigator_url: string
          connection_paths: string | null
          created_at: string
          extraction_job_id: string
          id: string
          industry_snapshot: string | null
          recommended_contact_connection: string | null
          recommended_contact_job_title: string | null
          recommended_contact_member_id: string | null
          recommended_contact_name: string | null
          recommended_contact_sales_nav_url: string | null
          recommended_lead_id: string | null
          source_list: string | null
          source_row_index: number
          updated_at: string
          user_id: string
        }
        Insert: {
          alert?: string | null
          company_id: string
          company_name_snapshot: string
          company_sales_navigator_url: string
          connection_paths?: string | null
          created_at?: string
          extraction_job_id: string
          id?: string
          industry_snapshot?: string | null
          recommended_contact_connection?: string | null
          recommended_contact_job_title?: string | null
          recommended_contact_member_id?: string | null
          recommended_contact_name?: string | null
          recommended_contact_sales_nav_url?: string | null
          recommended_lead_id?: string | null
          source_list?: string | null
          source_row_index: number
          updated_at?: string
          user_id: string
        }
        Update: {
          alert?: string | null
          company_id?: string
          company_name_snapshot?: string
          company_sales_navigator_url?: string
          connection_paths?: string | null
          created_at?: string
          extraction_job_id?: string
          id?: string
          industry_snapshot?: string | null
          recommended_contact_connection?: string | null
          recommended_contact_job_title?: string | null
          recommended_contact_member_id?: string | null
          recommended_contact_name?: string | null
          recommended_contact_sales_nav_url?: string | null
          recommended_lead_id?: string | null
          source_list?: string | null
          source_row_index?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_list_entries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_list_entries_extraction_job_id_fkey"
            columns: ["extraction_job_id"]
            isOneToOne: false
            referencedRelation: "extraction_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_list_entries_recommended_lead_id_fkey"
            columns: ["recommended_lead_id"]
            isOneToOne: false
            referencedRelation: "extracted_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_audit_logs: {
        Row: {
          action: string
          admin_id: string | null
          after_state: Json | null
          before_state: Json | null
          created_at: string
          id: string
          ip_address: unknown
          reason: string | null
          request_id: string | null
          target_id: string | null
          target_type: string | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          admin_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          id?: string
          ip_address?: unknown
          reason?: string | null
          request_id?: string | null
          target_id?: string | null
          target_type?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          admin_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          id?: string
          ip_address?: unknown
          reason?: string | null
          request_id?: string | null
          target_id?: string | null
          target_type?: string | null
          target_user_id?: string | null
        }
        Relationships: []
      }
      capture_pages: {
        Row: {
          capture_session_id: string
          content_hash: string
          created_at: string
          error: string | null
          extraction_job_id: string | null
          id: string
          leads_found: number
          page_identifier: string | null
          processed_at: string | null
          source_url: string | null
          status: Database["public"]["Enums"]["capture_page_status"]
          user_id: string
        }
        Insert: {
          capture_session_id: string
          content_hash: string
          created_at?: string
          error?: string | null
          extraction_job_id?: string | null
          id?: string
          leads_found?: number
          page_identifier?: string | null
          processed_at?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["capture_page_status"]
          user_id: string
        }
        Update: {
          capture_session_id?: string
          content_hash?: string
          created_at?: string
          error?: string | null
          extraction_job_id?: string | null
          id?: string
          leads_found?: number
          page_identifier?: string | null
          processed_at?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["capture_page_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "capture_pages_capture_session_id_fkey"
            columns: ["capture_session_id"]
            isOneToOne: false
            referencedRelation: "capture_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capture_pages_extraction_job_id_fkey"
            columns: ["extraction_job_id"]
            isOneToOne: false
            referencedRelation: "extraction_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      capture_sessions: {
        Row: {
          browser: string | null
          completed_at: string | null
          created_at: string
          dedupe_mode: Database["public"]["Enums"]["dedupe_mode"]
          device_id: string | null
          duplicates_skipped: number
          id: string
          leads_found: number
          leads_imported: number
          pages_processed: number
          source: string
          started_at: string
          status: Database["public"]["Enums"]["capture_session_status"]
          user_id: string
        }
        Insert: {
          browser?: string | null
          completed_at?: string | null
          created_at?: string
          dedupe_mode?: Database["public"]["Enums"]["dedupe_mode"]
          device_id?: string | null
          duplicates_skipped?: number
          id?: string
          leads_found?: number
          leads_imported?: number
          pages_processed?: number
          source?: string
          started_at?: string
          status?: Database["public"]["Enums"]["capture_session_status"]
          user_id: string
        }
        Update: {
          browser?: string | null
          completed_at?: string | null
          created_at?: string
          dedupe_mode?: Database["public"]["Enums"]["dedupe_mode"]
          device_id?: string | null
          duplicates_skipped?: number
          id?: string
          leads_found?: number
          leads_imported?: number
          pages_processed?: number
          source?: string
          started_at?: string
          status?: Database["public"]["Enums"]["capture_session_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "capture_sessions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "extension_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          contact_email: string | null
          contact_email_status: string | null
          contact_phone: string | null
          contact_phone_status: string | null
          created_at: string
          decision_maker_count: number | null
          domain: string | null
          employee_count: number | null
          employee_count_exact: number | null
          headquarters: string | null
          id: string
          industry: string | null
          investor_count: number | null
          linkedin_url: string | null
          name: string | null
          normalized_domain: string | null
          normalized_linkedin_url: string | null
          normalized_name: string | null
          page_observed_at: string | null
          public_linkedin_url: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          contact_email?: string | null
          contact_email_status?: string | null
          contact_phone?: string | null
          contact_phone_status?: string | null
          created_at?: string
          decision_maker_count?: number | null
          domain?: string | null
          employee_count?: number | null
          employee_count_exact?: number | null
          headquarters?: string | null
          id?: string
          industry?: string | null
          investor_count?: number | null
          linkedin_url?: string | null
          name?: string | null
          normalized_domain?: string | null
          normalized_linkedin_url?: string | null
          normalized_name?: string | null
          page_observed_at?: string | null
          public_linkedin_url?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          contact_email?: string | null
          contact_email_status?: string | null
          contact_phone?: string | null
          contact_phone_status?: string | null
          created_at?: string
          decision_maker_count?: number | null
          domain?: string | null
          employee_count?: number | null
          employee_count_exact?: number | null
          headquarters?: string | null
          id?: string
          industry?: string | null
          investor_count?: number | null
          linkedin_url?: string | null
          name?: string | null
          normalized_domain?: string | null
          normalized_linkedin_url?: string | null
          normalized_name?: string | null
          page_observed_at?: string | null
          public_linkedin_url?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      company_links: {
        Row: {
          company_id: string
          created_at: string
          host: string
          id: string
          kind: string
          observed_at: string
          source: string
          source_url: string | null
          url: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          host: string
          id?: string
          kind: string
          observed_at?: string
          source: string
          source_url?: string | null
          url: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          host?: string
          id?: string
          kind?: string
          observed_at?: string
          source?: string
          source_url?: string | null
          url?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_links_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_signals: {
        Row: {
          company_id: string
          created_at: string
          id: string
          kind: string
          observed_at: string
          source: string
          source_url: string | null
          unit: string | null
          user_id: string
          value_number: number | null
          value_text: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          kind: string
          observed_at?: string
          source: string
          source_url?: string | null
          unit?: string | null
          user_id: string
          value_number?: number | null
          value_text?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          kind?: string
          observed_at?: string
          source?: string
          source_url?: string | null
          unit?: string | null
          user_id?: string
          value_number?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_signals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_grants: {
        Row: {
          amount: number
          created_at: string
          fastspring_event_id: string | null
          id: string
          period_start: string
          reason: string
          referral_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          fastspring_event_id?: string | null
          id?: string
          period_start: string
          reason: string
          referral_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          fastspring_event_id?: string | null
          id?: string
          period_start?: string
          reason?: string
          referral_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_grants_referral_id_fkey"
            columns: ["referral_id"]
            isOneToOne: false
            referencedRelation: "referrals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_grants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_activities: {
        Row: {
          activity_type: Database["public"]["Enums"]["crm_activity_type"]
          actor_user_id: string | null
          channel: Database["public"]["Enums"]["crm_activity_channel"]
          company_id: string | null
          contact_id: string | null
          created_at: string
          id: string
          metadata: Json
          occurred_at: string
          owner_user_id_at_event: string | null
          refs: Json
          team_id_at_event: string | null
          workspace_id: string
        }
        Insert: {
          activity_type: Database["public"]["Enums"]["crm_activity_type"]
          actor_user_id?: string | null
          channel: Database["public"]["Enums"]["crm_activity_channel"]
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          owner_user_id_at_event?: string | null
          refs?: Json
          team_id_at_event?: string | null
          workspace_id: string
        }
        Update: {
          activity_type?: Database["public"]["Enums"]["crm_activity_type"]
          actor_user_id?: string | null
          channel?: Database["public"]["Enums"]["crm_activity_channel"]
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          owner_user_id_at_event?: string | null
          refs?: Json
          team_id_at_event?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_activities_company_fk"
            columns: ["company_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "crm_activities_contact_fk"
            columns: ["contact_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "crm_activities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_audit_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          after_state: Json | null
          before_state: Json | null
          created_at: string
          id: string
          reason: string | null
          target_id: string | null
          target_type: string
          workspace_id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          id?: string
          reason?: string | null
          target_id?: string | null
          target_type: string
          workspace_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          id?: string
          reason?: string | null
          target_id?: string | null
          target_type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_audit_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_batch_members: {
        Row: {
          batch_id: string
          contact_id: string
          created_at: string
          created_contact: boolean
          source_lead_id: string | null
          workspace_id: string
        }
        Insert: {
          batch_id: string
          contact_id: string
          created_at?: string
          created_contact?: boolean
          source_lead_id?: string | null
          workspace_id: string
        }
        Update: {
          batch_id?: string
          contact_id?: string
          created_at?: string
          created_contact?: boolean
          source_lead_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_batch_members_batch_fk"
            columns: ["batch_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "crm_lead_batches"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "crm_batch_members_contact_fk"
            columns: ["contact_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "crm_batch_members_source_lead_id_fkey"
            columns: ["source_lead_id"]
            isOneToOne: false
            referencedRelation: "extracted_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_batch_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_collision_settings: {
        Row: {
          active_within_days: number
          company_mode: Database["public"]["Enums"]["crm_collision_mode"]
          contact_mode: Database["public"]["Enums"]["crm_collision_mode"]
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          active_within_days?: number
          company_mode?: Database["public"]["Enums"]["crm_collision_mode"]
          contact_mode?: Database["public"]["Enums"]["crm_collision_mode"]
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          active_within_days?: number
          company_mode?: Database["public"]["Enums"]["crm_collision_mode"]
          contact_mode?: Database["public"]["Enums"]["crm_collision_mode"]
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_collision_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_companies: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          domain: string | null
          employee_count: number | null
          headquarters: string | null
          id: string
          industry: string | null
          linkedin_url: string | null
          name: string | null
          normalized_domain: string | null
          normalized_linkedin_url: string | null
          normalized_name: string | null
          owner_user_id: string | null
          source: Database["public"]["Enums"]["crm_record_source"]
          source_company_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          domain?: string | null
          employee_count?: number | null
          headquarters?: string | null
          id?: string
          industry?: string | null
          linkedin_url?: string | null
          name?: string | null
          normalized_domain?: string | null
          normalized_linkedin_url?: string | null
          normalized_name?: string | null
          owner_user_id?: string | null
          source?: Database["public"]["Enums"]["crm_record_source"]
          source_company_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          domain?: string | null
          employee_count?: number | null
          headquarters?: string | null
          id?: string
          industry?: string | null
          linkedin_url?: string | null
          name?: string | null
          normalized_domain?: string | null
          normalized_linkedin_url?: string | null
          normalized_name?: string | null
          owner_user_id?: string | null
          source?: Database["public"]["Enums"]["crm_record_source"]
          source_company_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_companies_source_company_id_fkey"
            columns: ["source_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_companies_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_contact_company_relationships: {
        Row: {
          company_id: string
          contact_id: string
          created_at: string
          deleted_at: string | null
          ended_at: string | null
          id: string
          is_current: boolean
          is_primary: boolean
          started_at: string | null
          title: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          company_id: string
          contact_id: string
          created_at?: string
          deleted_at?: string | null
          ended_at?: string | null
          id?: string
          is_current?: boolean
          is_primary?: boolean
          started_at?: string | null
          title?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          company_id?: string
          contact_id?: string
          created_at?: string
          deleted_at?: string | null
          ended_at?: string | null
          id?: string
          is_current?: boolean
          is_primary?: boolean
          started_at?: string | null
          title?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_ccr_company_fk"
            columns: ["company_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "crm_ccr_contact_fk"
            columns: ["contact_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "crm_contact_company_relationships_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_contact_emails: {
        Row: {
          address: string
          contact_id: string
          created_at: string
          deleted_at: string | null
          id: string
          identity_key: string
          is_primary: boolean
          source: Database["public"]["Enums"]["crm_record_source"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          address: string
          contact_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          identity_key: string
          is_primary?: boolean
          source?: Database["public"]["Enums"]["crm_record_source"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          address?: string
          contact_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          identity_key?: string
          is_primary?: boolean
          source?: Database["public"]["Enums"]["crm_record_source"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_contact_emails_contact_fk"
            columns: ["contact_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "crm_contact_emails_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_contact_phones: {
        Row: {
          contact_id: string
          created_at: string
          deleted_at: string | null
          e164: string | null
          id: string
          is_primary: boolean
          kind: string | null
          raw: string
          source: Database["public"]["Enums"]["crm_record_source"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          deleted_at?: string | null
          e164?: string | null
          id?: string
          is_primary?: boolean
          kind?: string | null
          raw: string
          source?: Database["public"]["Enums"]["crm_record_source"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          deleted_at?: string | null
          e164?: string | null
          id?: string
          is_primary?: boolean
          kind?: string | null
          raw?: string
          source?: Database["public"]["Enums"]["crm_record_source"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_contact_phones_contact_fk"
            columns: ["contact_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "crm_contact_phones_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_contact_tags: {
        Row: {
          contact_id: string
          created_at: string
          created_by: string | null
          tag_id: string
          workspace_id: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          created_by?: string | null
          tag_id: string
          workspace_id: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          created_by?: string | null
          tag_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_contact_tags_contact_fk"
            columns: ["contact_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "crm_contact_tags_tag_fk"
            columns: ["tag_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "crm_tags"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "crm_contact_tags_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_contacts: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          first_name: string | null
          full_name: string | null
          headline: string | null
          id: string
          job_title: string | null
          last_name: string | null
          linkedin_identity_key: string | null
          linkedin_url: string | null
          location: string | null
          merged_into_id: string | null
          owner_user_id: string | null
          primary_company_id: string | null
          source: Database["public"]["Enums"]["crm_record_source"]
          source_lead_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          first_name?: string | null
          full_name?: string | null
          headline?: string | null
          id?: string
          job_title?: string | null
          last_name?: string | null
          linkedin_identity_key?: string | null
          linkedin_url?: string | null
          location?: string | null
          merged_into_id?: string | null
          owner_user_id?: string | null
          primary_company_id?: string | null
          source?: Database["public"]["Enums"]["crm_record_source"]
          source_lead_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          first_name?: string | null
          full_name?: string | null
          headline?: string | null
          id?: string
          job_title?: string | null
          last_name?: string | null
          linkedin_identity_key?: string | null
          linkedin_url?: string | null
          location?: string | null
          merged_into_id?: string | null
          owner_user_id?: string | null
          primary_company_id?: string | null
          source?: Database["public"]["Enums"]["crm_record_source"]
          source_lead_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_contacts_merged_into_id_fkey"
            columns: ["merged_into_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contacts_primary_company_fk"
            columns: ["primary_company_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "crm_contacts_source_lead_id_fkey"
            columns: ["source_lead_id"]
            isOneToOne: false
            referencedRelation: "extracted_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_custom_field_definitions: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          entity: Database["public"]["Enums"]["crm_custom_field_entity"]
          field_type: Database["public"]["Enums"]["crm_custom_field_type"]
          id: string
          is_required: boolean
          key: string
          label: string
          options: Json
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          entity: Database["public"]["Enums"]["crm_custom_field_entity"]
          field_type: Database["public"]["Enums"]["crm_custom_field_type"]
          id?: string
          is_required?: boolean
          key: string
          label: string
          options?: Json
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          entity?: Database["public"]["Enums"]["crm_custom_field_entity"]
          field_type?: Database["public"]["Enums"]["crm_custom_field_type"]
          id?: string
          is_required?: boolean
          key?: string
          label?: string
          options?: Json
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_custom_field_definitions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_custom_field_values: {
        Row: {
          created_at: string
          definition_id: string
          entity: Database["public"]["Enums"]["crm_custom_field_entity"]
          id: string
          record_id: string
          updated_at: string
          value: Json | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          definition_id: string
          entity: Database["public"]["Enums"]["crm_custom_field_entity"]
          id?: string
          record_id: string
          updated_at?: string
          value?: Json | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          definition_id?: string
          entity?: Database["public"]["Enums"]["crm_custom_field_entity"]
          id?: string
          record_id?: string
          updated_at?: string
          value?: Json | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_cfv_definition_fk"
            columns: ["definition_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "crm_custom_field_definitions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "crm_custom_field_values_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_duplicate_candidates: {
        Row: {
          confidence: string
          detected_at: string
          entity: Database["public"]["Enums"]["crm_custom_field_entity"]
          id: string
          record_a_id: string
          record_b_id: string
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          score: number
          signals: Json
          status: string
          summary: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          confidence: string
          detected_at?: string
          entity: Database["public"]["Enums"]["crm_custom_field_entity"]
          id?: string
          record_a_id: string
          record_b_id: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          score: number
          signals?: Json
          status?: string
          summary: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          confidence?: string
          detected_at?: string
          entity?: Database["public"]["Enums"]["crm_custom_field_entity"]
          id?: string
          record_a_id?: string
          record_b_id?: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          score?: number
          signals?: Json
          status?: string
          summary?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_duplicate_candidates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_import_jobs: {
        Row: {
          batch_id: string | null
          content_hash: string
          created_at: string
          created_by: string | null
          errors: Json
          filename: string
          id: string
          mapping: Json
          rows_imported: number
          rows_skipped: number
          rows_total: number
          status: string
          undone_at: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          batch_id?: string | null
          content_hash: string
          created_at?: string
          created_by?: string | null
          errors?: Json
          filename: string
          id?: string
          mapping?: Json
          rows_imported?: number
          rows_skipped?: number
          rows_total?: number
          status?: string
          undone_at?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          batch_id?: string | null
          content_hash?: string
          created_at?: string
          created_by?: string | null
          errors?: Json
          filename?: string
          id?: string
          mapping?: Json
          rows_imported?: number
          rows_skipped?: number
          rows_total?: number
          status?: string
          undone_at?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_import_jobs_batch_fk"
            columns: ["batch_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "crm_lead_batches"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "crm_import_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_lead_batches: {
        Row: {
          contacts_created: number
          contacts_matched: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          name: string
          rows_seen: number
          rows_skipped: number
          source: Database["public"]["Enums"]["crm_record_source"]
          source_extraction_job_id: string | null
          source_import_job_id: string | null
          undone_at: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          contacts_created?: number
          contacts_matched?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name: string
          rows_seen?: number
          rows_skipped?: number
          source: Database["public"]["Enums"]["crm_record_source"]
          source_extraction_job_id?: string | null
          source_import_job_id?: string | null
          undone_at?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          contacts_created?: number
          contacts_matched?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name?: string
          rows_seen?: number
          rows_skipped?: number
          source?: Database["public"]["Enums"]["crm_record_source"]
          source_extraction_job_id?: string | null
          source_import_job_id?: string | null
          undone_at?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_lead_batches_source_extraction_job_id_fkey"
            columns: ["source_extraction_job_id"]
            isOneToOne: false
            referencedRelation: "extraction_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_batches_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_list_members: {
        Row: {
          contact_id: string
          created_at: string
          created_by: string | null
          list_id: string
          workspace_id: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          created_by?: string | null
          list_id: string
          workspace_id: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          created_by?: string | null
          list_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_list_members_contact_fk"
            columns: ["contact_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "crm_list_members_list_fk"
            columns: ["list_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "crm_lists"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "crm_list_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_lists: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          id: string
          name: string
          normalized_name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          name: string
          normalized_name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          name?: string
          normalized_name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_lists_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_merge_events: {
        Row: {
          created_at: string
          entity: Database["public"]["Enums"]["crm_custom_field_entity"]
          id: string
          merged_id: string
          performed_by: string | null
          snapshot: Json
          surviving_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          entity: Database["public"]["Enums"]["crm_custom_field_entity"]
          id?: string
          merged_id: string
          performed_by?: string | null
          snapshot?: Json
          surviving_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          entity?: Database["public"]["Enums"]["crm_custom_field_entity"]
          id?: string
          merged_id?: string
          performed_by?: string | null
          snapshot?: Json
          surviving_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_merge_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_note_mentions: {
        Row: {
          created_at: string
          mentioned_user_id: string
          note_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          mentioned_user_id: string
          note_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          mentioned_user_id?: string
          note_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_note_mentions_note_fk"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "crm_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_note_mentions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_notes: {
        Row: {
          body: string
          company_id: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          body: string
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          body?: string
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_notes_company_fk"
            columns: ["company_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "crm_notes_contact_fk"
            columns: ["contact_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "crm_notes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_notification_preferences: {
        Row: {
          in_app: boolean
          kind: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          in_app?: boolean
          kind: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          in_app?: boolean
          kind?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_notification_preferences_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          kind: string
          read_at: string | null
          refs: Json
          title: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind: string
          read_at?: string | null
          refs?: Json
          title: string
          user_id: string
          workspace_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          read_at?: string | null
          refs?: Json
          title?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_notifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_opportunities: {
        Row: {
          closed_at: string | null
          company_id: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          expected_close_date: string | null
          id: string
          lost_reason: string | null
          owner_user_id: string | null
          pipeline_id: string
          probability: number
          stage_id: string
          status: Database["public"]["Enums"]["crm_opportunity_status"]
          title: string
          updated_at: string
          value_amount: number | null
          version: number
          workspace_id: string
        }
        Insert: {
          closed_at?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          deleted_at?: string | null
          expected_close_date?: string | null
          id?: string
          lost_reason?: string | null
          owner_user_id?: string | null
          pipeline_id: string
          probability?: number
          stage_id: string
          status?: Database["public"]["Enums"]["crm_opportunity_status"]
          title: string
          updated_at?: string
          value_amount?: number | null
          version?: number
          workspace_id: string
        }
        Update: {
          closed_at?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          deleted_at?: string | null
          expected_close_date?: string | null
          id?: string
          lost_reason?: string | null
          owner_user_id?: string | null
          pipeline_id?: string
          probability?: number
          stage_id?: string
          status?: Database["public"]["Enums"]["crm_opportunity_status"]
          title?: string
          updated_at?: string
          value_amount?: number | null
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_opportunities_company_fk"
            columns: ["company_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "crm_opportunities_contact_fk"
            columns: ["contact_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "crm_opportunities_pipeline_fk"
            columns: ["pipeline_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "crm_pipelines"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "crm_opportunities_stage_fk"
            columns: ["stage_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "crm_pipeline_stages"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "crm_opportunities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_opportunity_stage_history: {
        Row: {
          actor_user_id: string | null
          from_stage_id: string | null
          id: string
          occurred_at: string
          opportunity_id: string
          owner_user_id_at_event: string | null
          seconds_in_previous_stage: number | null
          to_stage_id: string
          workspace_id: string
        }
        Insert: {
          actor_user_id?: string | null
          from_stage_id?: string | null
          id?: string
          occurred_at?: string
          opportunity_id: string
          owner_user_id_at_event?: string | null
          seconds_in_previous_stage?: number | null
          to_stage_id: string
          workspace_id: string
        }
        Update: {
          actor_user_id?: string | null
          from_stage_id?: string | null
          id?: string
          occurred_at?: string
          opportunity_id?: string
          owner_user_id_at_event?: string | null
          seconds_in_previous_stage?: number | null
          to_stage_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_opportunity_stage_history_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_osh_opportunity_fk"
            columns: ["opportunity_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "crm_opportunities"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      crm_pipeline_stages: {
        Row: {
          archived_at: string | null
          created_at: string
          default_probability: number
          id: string
          kind: Database["public"]["Enums"]["crm_stage_kind"]
          name: string
          pipeline_id: string
          sort_order: number
          stale_after_days: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          default_probability?: number
          id?: string
          kind?: Database["public"]["Enums"]["crm_stage_kind"]
          name: string
          pipeline_id: string
          sort_order: number
          stale_after_days?: number | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          default_probability?: number
          id?: string
          kind?: Database["public"]["Enums"]["crm_stage_kind"]
          name?: string
          pipeline_id?: string
          sort_order?: number
          stale_after_days?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_pipeline_stages_pipeline_fk"
            columns: ["pipeline_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "crm_pipelines"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "crm_pipeline_stages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_pipelines: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_default: boolean
          name: string
          sort_order: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          name: string
          sort_order?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_pipelines_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_reassignment_requests: {
        Row: {
          contact_id: string
          created_at: string
          current_owner_user_id: string | null
          id: string
          note: string | null
          requested_by: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["crm_reassignment_status"]
          workspace_id: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          current_owner_user_id?: string | null
          id?: string
          note?: string | null
          requested_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["crm_reassignment_status"]
          workspace_id: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          current_owner_user_id?: string | null
          id?: string
          note?: string | null
          requested_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["crm_reassignment_status"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_reassignment_contact_fk"
            columns: ["contact_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "crm_reassignment_requests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_reporting_daily: {
        Row: {
          amount_value: number
          basis: string
          computed_at: string
          count_value: number
          day: string
          id: string
          metric: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          amount_value?: number
          basis: string
          computed_at?: string
          count_value?: number
          day: string
          id?: string
          metric: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          amount_value?: number
          basis?: string
          computed_at?: string
          count_value?: number
          day?: string
          id?: string
          metric?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_reporting_daily_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_reporting_runs: {
        Row: {
          discrepancies: number | null
          error: string | null
          finished_at: string | null
          from_day: string
          id: string
          rows_written: number
          started_at: string
          to_day: string
          workspace_id: string
        }
        Insert: {
          discrepancies?: number | null
          error?: string | null
          finished_at?: string | null
          from_day: string
          id?: string
          rows_written?: number
          started_at?: string
          to_day: string
          workspace_id: string
        }
        Update: {
          discrepancies?: number | null
          error?: string | null
          finished_at?: string | null
          from_day?: string
          id?: string
          rows_written?: number
          started_at?: string
          to_day?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_reporting_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_saved_views: {
        Row: {
          created_at: string
          definition: Json
          deleted_at: string | null
          entity: Database["public"]["Enums"]["crm_custom_field_entity"]
          id: string
          is_shared: boolean
          name: string
          owner_user_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          definition?: Json
          deleted_at?: string | null
          entity: Database["public"]["Enums"]["crm_custom_field_entity"]
          id?: string
          is_shared?: boolean
          name: string
          owner_user_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          definition?: Json
          deleted_at?: string | null
          entity?: Database["public"]["Enums"]["crm_custom_field_entity"]
          id?: string
          is_shared?: boolean
          name?: string
          owner_user_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_saved_views_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_tags: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          name: string
          normalized_name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name: string
          normalized_name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name?: string
          normalized_name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_tags_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_tasks: {
        Row: {
          assigned_to_user_id: string | null
          body: string | null
          company_id: string | null
          completed_at: string | null
          completed_by: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          due_at: string | null
          id: string
          status: Database["public"]["Enums"]["crm_task_status"]
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          assigned_to_user_id?: string | null
          body?: string | null
          company_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          due_at?: string | null
          id?: string
          status?: Database["public"]["Enums"]["crm_task_status"]
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          assigned_to_user_id?: string | null
          body?: string | null
          company_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          due_at?: string | null
          id?: string
          status?: Database["public"]["Enums"]["crm_task_status"]
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_tasks_company_fk"
            columns: ["company_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "crm_tasks_contact_fk"
            columns: ["contact_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "crm_tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      email_account_secrets: {
        Row: {
          account_id: string
          created_at: string
          encrypted_payload: string
          id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          encrypted_payload: string
          id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          encrypted_payload?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_account_secrets_account_id_id_fkey"
            columns: ["account_id", "id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id", "secret_reference"]
          },
        ]
      }
      email_accounts: {
        Row: {
          configuration: Json
          connected_at: string | null
          created_at: string
          daily_send_limit: number | null
          deleted_at: string | null
          display_name: string
          from_domain: string
          from_email: string
          from_name: string | null
          health_checked_at: string | null
          health_score: number | null
          hourly_send_limit: number | null
          id: string
          last_error: string | null
          last_send_at: string | null
          last_sync_at: string | null
          min_delay_seconds: number
          owner_user_id: string
          provider: Database["public"]["Enums"]["email_provider"]
          ramp_daily_increment: number
          ramp_enabled: boolean
          ramp_initial_daily: number
          ramp_started_on: string | null
          ramp_target_daily: number
          reply_to_email: string | null
          scope: Database["public"]["Enums"]["email_account_scope"]
          secret_reference: string
          send_days: number[]
          send_window_end: string
          send_window_start: string
          status: Database["public"]["Enums"]["email_account_status"]
          timezone: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          configuration?: Json
          connected_at?: string | null
          created_at?: string
          daily_send_limit?: number | null
          deleted_at?: string | null
          display_name: string
          from_domain: string
          from_email: string
          from_name?: string | null
          health_checked_at?: string | null
          health_score?: number | null
          hourly_send_limit?: number | null
          id?: string
          last_error?: string | null
          last_send_at?: string | null
          last_sync_at?: string | null
          min_delay_seconds?: number
          owner_user_id: string
          provider: Database["public"]["Enums"]["email_provider"]
          ramp_daily_increment?: number
          ramp_enabled?: boolean
          ramp_initial_daily?: number
          ramp_started_on?: string | null
          ramp_target_daily?: number
          reply_to_email?: string | null
          scope?: Database["public"]["Enums"]["email_account_scope"]
          secret_reference?: string
          send_days?: number[]
          send_window_end?: string
          send_window_start?: string
          status?: Database["public"]["Enums"]["email_account_status"]
          timezone?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          configuration?: Json
          connected_at?: string | null
          created_at?: string
          daily_send_limit?: number | null
          deleted_at?: string | null
          display_name?: string
          from_domain?: string
          from_email?: string
          from_name?: string | null
          health_checked_at?: string | null
          health_score?: number | null
          hourly_send_limit?: number | null
          id?: string
          last_error?: string | null
          last_send_at?: string | null
          last_sync_at?: string | null
          min_delay_seconds?: number
          owner_user_id?: string
          provider?: Database["public"]["Enums"]["email_provider"]
          ramp_daily_increment?: number
          ramp_enabled?: boolean
          ramp_initial_daily?: number
          ramp_started_on?: string | null
          ramp_target_daily?: number
          reply_to_email?: string | null
          scope?: Database["public"]["Enums"]["email_account_scope"]
          secret_reference?: string
          send_days?: number[]
          send_window_end?: string
          send_window_start?: string
          status?: Database["public"]["Enums"]["email_account_status"]
          timezone?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaigns: {
        Row: {
          account_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          name: string
          scheduled_at: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["email_campaign_status"]
          timezone: string | null
          type: Database["public"]["Enums"]["email_campaign_type"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          account_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name: string
          scheduled_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["email_campaign_status"]
          timezone?: string | null
          type: Database["public"]["Enums"]["email_campaign_type"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          account_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name?: string
          scheduled_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["email_campaign_status"]
          timezone?: string | null
          type?: Database["public"]["Enums"]["email_campaign_type"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_campaigns_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaigns_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      email_domain_checks: {
        Row: {
          checked_at: string
          created_at: string
          dkim_detail: string | null
          dkim_selector: string | null
          dkim_status: Database["public"]["Enums"]["email_check_status"]
          dmarc_detail: string | null
          dmarc_policy: string | null
          dmarc_record: string | null
          dmarc_status: Database["public"]["Enums"]["email_check_status"]
          domain: string
          id: string
          spf_detail: string | null
          spf_record: string | null
          spf_status: Database["public"]["Enums"]["email_check_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          checked_at?: string
          created_at?: string
          dkim_detail?: string | null
          dkim_selector?: string | null
          dkim_status?: Database["public"]["Enums"]["email_check_status"]
          dmarc_detail?: string | null
          dmarc_policy?: string | null
          dmarc_record?: string | null
          dmarc_status?: Database["public"]["Enums"]["email_check_status"]
          domain: string
          id?: string
          spf_detail?: string | null
          spf_record?: string | null
          spf_status?: Database["public"]["Enums"]["email_check_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          checked_at?: string
          created_at?: string
          dkim_detail?: string | null
          dkim_selector?: string | null
          dkim_status?: Database["public"]["Enums"]["email_check_status"]
          dmarc_detail?: string | null
          dmarc_policy?: string | null
          dmarc_record?: string | null
          dmarc_status?: Database["public"]["Enums"]["email_check_status"]
          domain?: string
          id?: string
          spf_detail?: string | null
          spf_record?: string | null
          spf_status?: Database["public"]["Enums"]["email_check_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_domain_checks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      email_enrollments: {
        Row: {
          campaign_id: string
          completed_at: string | null
          contact_id: string
          created_at: string
          current_step: number
          id: string
          last_sent_at: string | null
          next_action_at: string | null
          replied_at: string | null
          started_at: string
          status: Database["public"]["Enums"]["email_enrollment_status"]
          stop_reason: Database["public"]["Enums"]["email_stop_reason"] | null
          stopped_at: string | null
          to_email: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          campaign_id: string
          completed_at?: string | null
          contact_id: string
          created_at?: string
          current_step?: number
          id?: string
          last_sent_at?: string | null
          next_action_at?: string | null
          replied_at?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["email_enrollment_status"]
          stop_reason?: Database["public"]["Enums"]["email_stop_reason"] | null
          stopped_at?: string | null
          to_email: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          campaign_id?: string
          completed_at?: string | null
          contact_id?: string
          created_at?: string
          current_step?: number
          id?: string
          last_sent_at?: string | null
          next_action_at?: string | null
          replied_at?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["email_enrollment_status"]
          stop_reason?: Database["public"]["Enums"]["email_stop_reason"] | null
          stopped_at?: string | null
          to_email?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_enrollments_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_enrollments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_enrollments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      email_events: {
        Row: {
          campaign_id: string | null
          contact_id: string | null
          created_at: string
          email: string
          enrollment_id: string | null
          id: string
          message_id: string | null
          metadata: Json
          occurred_at: string
          provider_event_id: string | null
          type: Database["public"]["Enums"]["email_event_type"]
          workspace_id: string
        }
        Insert: {
          campaign_id?: string | null
          contact_id?: string | null
          created_at?: string
          email: string
          enrollment_id?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json
          occurred_at?: string
          provider_event_id?: string | null
          type: Database["public"]["Enums"]["email_event_type"]
          workspace_id: string
        }
        Update: {
          campaign_id?: string | null
          contact_id?: string | null
          created_at?: string
          email?: string
          enrollment_id?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json
          occurred_at?: string
          provider_event_id?: string | null
          type?: Database["public"]["Enums"]["email_event_type"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_events_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "email_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_events_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "email_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      email_messages: {
        Row: {
          account_id: string
          attempts: number
          body_html: string | null
          body_text: string
          campaign_id: string | null
          claim_expires_at: string | null
          claimed_at: string | null
          claimed_by: string | null
          contact_id: string | null
          created_at: string
          enrollment_id: string | null
          error_code: string | null
          error_message: string | null
          id: string
          idempotency_key: string
          max_attempts: number
          provider_message_id: string | null
          scheduled_at: string
          sent_at: string | null
          sequence_id: string | null
          status: Database["public"]["Enums"]["email_message_status"]
          step_index: number | null
          subject: string
          suppression_reason:
            | Database["public"]["Enums"]["email_suppression_reason"]
            | null
          template_id: string | null
          thread_id: string | null
          to_email: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          account_id: string
          attempts?: number
          body_html?: string | null
          body_text: string
          campaign_id?: string | null
          claim_expires_at?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          contact_id?: string | null
          created_at?: string
          enrollment_id?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          idempotency_key: string
          max_attempts?: number
          provider_message_id?: string | null
          scheduled_at?: string
          sent_at?: string | null
          sequence_id?: string | null
          status?: Database["public"]["Enums"]["email_message_status"]
          step_index?: number | null
          subject: string
          suppression_reason?:
            | Database["public"]["Enums"]["email_suppression_reason"]
            | null
          template_id?: string | null
          thread_id?: string | null
          to_email: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          account_id?: string
          attempts?: number
          body_html?: string | null
          body_text?: string
          campaign_id?: string | null
          claim_expires_at?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          contact_id?: string | null
          created_at?: string
          enrollment_id?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          idempotency_key?: string
          max_attempts?: number
          provider_message_id?: string | null
          scheduled_at?: string
          sent_at?: string | null
          sequence_id?: string | null
          status?: Database["public"]["Enums"]["email_message_status"]
          step_index?: number | null
          subject?: string
          suppression_reason?:
            | Database["public"]["Enums"]["email_suppression_reason"]
            | null
          template_id?: string | null
          thread_id?: string | null
          to_email?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_messages_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "email_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      email_readiness_checks: {
        Row: {
          account_id: string
          bounce_rate: number | null
          checked_at: string
          checks: Json
          complaint_rate: number | null
          daily_limit: number | null
          id: string
          score: number
          sent_24h: number
          sent_7d: number
          state: Database["public"]["Enums"]["email_account_status"]
          workspace_id: string
        }
        Insert: {
          account_id: string
          bounce_rate?: number | null
          checked_at?: string
          checks?: Json
          complaint_rate?: number | null
          daily_limit?: number | null
          id?: string
          score: number
          sent_24h?: number
          sent_7d?: number
          state: Database["public"]["Enums"]["email_account_status"]
          workspace_id: string
        }
        Update: {
          account_id?: string
          bounce_rate?: number | null
          checked_at?: string
          checks?: Json
          complaint_rate?: number | null
          daily_limit?: number | null
          id?: string
          score?: number
          sent_24h?: number
          sent_7d?: number
          state?: Database["public"]["Enums"]["email_account_status"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_readiness_checks_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_readiness_checks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sequence_steps: {
        Row: {
          body_html: string | null
          body_text: string
          campaign_id: string
          created_at: string
          id: string
          step_index: number
          stop_on_reply: boolean | null
          subject: string
          template_id: string | null
          updated_at: string
          wait_hours: number
          workspace_id: string
        }
        Insert: {
          body_html?: string | null
          body_text: string
          campaign_id: string
          created_at?: string
          id?: string
          step_index: number
          stop_on_reply?: boolean | null
          subject: string
          template_id?: string | null
          updated_at?: string
          wait_hours?: number
          workspace_id: string
        }
        Update: {
          body_html?: string | null
          body_text?: string
          campaign_id?: string
          created_at?: string
          id?: string
          step_index?: number
          stop_on_reply?: boolean | null
          subject?: string
          template_id?: string | null
          updated_at?: string
          wait_hours?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_sequence_steps_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sequence_steps_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sequence_steps_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      email_suppressions: {
        Row: {
          contact_id: string | null
          created_at: string
          created_by: string | null
          email: string
          id: string
          reason: Database["public"]["Enums"]["email_suppression_reason"]
          source: string | null
          workspace_id: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          email: string
          id?: string
          reason: Database["public"]["Enums"]["email_suppression_reason"]
          source?: string | null
          workspace_id: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          email?: string
          id?: string
          reason?: Database["public"]["Enums"]["email_suppression_reason"]
          source?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_suppressions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_suppressions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          body_html: string | null
          body_text: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          name: string
          subject: string
          updated_at: string
          variables: string[]
          workspace_id: string
        }
        Insert: {
          body_html?: string | null
          body_text: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name: string
          subject: string
          updated_at?: string
          variables?: string[]
          workspace_id: string
        }
        Update: {
          body_html?: string | null
          body_text?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name?: string
          subject?: string
          updated_at?: string
          variables?: string[]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      email_webhook_deliveries: {
        Row: {
          delivery_key: string
          event_count: number
          id: string
          processed_at: string | null
          provider: Database["public"]["Enums"]["email_provider"]
          received_at: string
          workspace_id: string | null
        }
        Insert: {
          delivery_key: string
          event_count?: number
          id?: string
          processed_at?: string | null
          provider: Database["public"]["Enums"]["email_provider"]
          received_at?: string
          workspace_id?: string | null
        }
        Update: {
          delivery_key?: string
          event_count?: number
          id?: string
          processed_at?: string | null
          provider?: Database["public"]["Enums"]["email_provider"]
          received_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_webhook_deliveries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      export_destinations: {
        Row: {
          access_token: string | null
          account_label: string | null
          connected_at: string | null
          created_at: string
          folder_id: string | null
          folder_name: string | null
          id: string
          is_default: boolean
          kind: Database["public"]["Enums"]["export_destination_kind"]
          last_error: string | null
          refresh_token: string | null
          scopes: string | null
          token_expires_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          account_label?: string | null
          connected_at?: string | null
          created_at?: string
          folder_id?: string | null
          folder_name?: string | null
          id?: string
          is_default?: boolean
          kind: Database["public"]["Enums"]["export_destination_kind"]
          last_error?: string | null
          refresh_token?: string | null
          scopes?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          account_label?: string | null
          connected_at?: string | null
          created_at?: string
          folder_id?: string | null
          folder_name?: string | null
          id?: string
          is_default?: boolean
          kind?: Database["public"]["Enums"]["export_destination_kind"]
          last_error?: string | null
          refresh_token?: string | null
          scopes?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      export_job_errors: {
        Row: {
          account_list_entry_id: string | null
          created_at: string
          error_code: string
          error_message: string
          export_job_id: string
          id: string
          lead_id: string | null
          user_id: string
        }
        Insert: {
          account_list_entry_id?: string | null
          created_at?: string
          error_code: string
          error_message: string
          export_job_id: string
          id?: string
          lead_id?: string | null
          user_id: string
        }
        Update: {
          account_list_entry_id?: string | null
          created_at?: string
          error_code?: string
          error_message?: string
          export_job_id?: string
          id?: string
          lead_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "export_job_errors_account_list_entry_id_fkey"
            columns: ["account_list_entry_id"]
            isOneToOne: false
            referencedRelation: "account_list_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "export_job_errors_export_job_id_user_id_fkey"
            columns: ["export_job_id", "user_id"]
            isOneToOne: false
            referencedRelation: "export_jobs"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "export_job_errors_lead_id_user_id_fkey"
            columns: ["lead_id", "user_id"]
            isOneToOne: false
            referencedRelation: "extracted_leads"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      export_jobs: {
        Row: {
          account_count: number
          completed_at: string | null
          created_at: string
          destination_id: string | null
          destination_url: string | null
          error_code: string | null
          error_message: string | null
          extraction_job_id: string | null
          failed_count: number
          id: string
          lead_count: number
          options: Json
          provider: string
          record_type: string
          started_at: string | null
          status: string
          successful_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          account_count?: number
          completed_at?: string | null
          created_at?: string
          destination_id?: string | null
          destination_url?: string | null
          error_code?: string | null
          error_message?: string | null
          extraction_job_id?: string | null
          failed_count?: number
          id?: string
          lead_count?: number
          options?: Json
          provider: string
          record_type?: string
          started_at?: string | null
          status?: string
          successful_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          account_count?: number
          completed_at?: string | null
          created_at?: string
          destination_id?: string | null
          destination_url?: string | null
          error_code?: string | null
          error_message?: string | null
          extraction_job_id?: string | null
          failed_count?: number
          id?: string
          lead_count?: number
          options?: Json
          provider?: string
          record_type?: string
          started_at?: string | null
          status?: string
          successful_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "export_jobs_extraction_job_id_fkey"
            columns: ["extraction_job_id"]
            isOneToOne: false
            referencedRelation: "extraction_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      extension_devices: {
        Row: {
          access_token_jti: string | null
          browser: string | null
          created_at: string
          enabled: boolean
          id: string
          label: string
          last_active_at: string | null
          platform: string | null
          refresh_token_hash: string
          revoked_at: string | null
          revoked_by: string | null
          user_id: string
        }
        Insert: {
          access_token_jti?: string | null
          browser?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          label: string
          last_active_at?: string | null
          platform?: string | null
          refresh_token_hash: string
          revoked_at?: string | null
          revoked_by?: string | null
          user_id: string
        }
        Update: {
          access_token_jti?: string | null
          browser?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          label?: string
          last_active_at?: string | null
          platform?: string | null
          refresh_token_hash?: string
          revoked_at?: string | null
          revoked_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      extension_pairings: {
        Row: {
          browser: string | null
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          label: string | null
          platform: string | null
          state: string
          user_id: string
        }
        Insert: {
          browser?: string | null
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          label?: string | null
          platform?: string | null
          state: string
          user_id: string
        }
        Update: {
          browser?: string | null
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          label?: string | null
          platform?: string | null
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      extracted_leads: {
        Row: {
          added_to_list_at: string | null
          company_decision_maker_count: number | null
          company_employee_count: number | null
          company_headquarters: string | null
          company_id: string | null
          company_industry: string | null
          company_investor_count: number | null
          company_match_strategy: string | null
          company_name: string | null
          company_public_linkedin_url: string | null
          company_size: string | null
          company_url: string | null
          company_website_url: string | null
          connection_degree: string | null
          contact_enriched_at: string | null
          created_at: string
          dedupe_key: string
          dedupe_strategy: Database["public"]["Enums"]["dedupe_strategy"]
          duplicate_of_id: string | null
          email_status: string | null
          enrichment: Json
          extraction_job_id: string
          full_name: string | null
          id: string
          is_duplicate: boolean
          is_reachable: boolean | null
          job_title: string | null
          last_activity: string | null
          lead_source: string | null
          linkedin_url: string | null
          list_count: number | null
          location: string | null
          mobile_phone: string | null
          person_blurb: string | null
          phone_status: string | null
          raw_data: Json | null
          sales_navigator_url: string | null
          source_list: string | null
          source_page: string | null
          source_row_index: number | null
          tenure_in_company: string | null
          tenure_in_role: string | null
          updated_at: string
          uploaded_file_id: string | null
          user_id: string
          work_email: string | null
        }
        Insert: {
          added_to_list_at?: string | null
          company_decision_maker_count?: number | null
          company_employee_count?: number | null
          company_headquarters?: string | null
          company_id?: string | null
          company_industry?: string | null
          company_investor_count?: number | null
          company_match_strategy?: string | null
          company_name?: string | null
          company_public_linkedin_url?: string | null
          company_size?: string | null
          company_url?: string | null
          company_website_url?: string | null
          connection_degree?: string | null
          contact_enriched_at?: string | null
          created_at?: string
          dedupe_key: string
          dedupe_strategy: Database["public"]["Enums"]["dedupe_strategy"]
          duplicate_of_id?: string | null
          email_status?: string | null
          enrichment?: Json
          extraction_job_id: string
          full_name?: string | null
          id?: string
          is_duplicate?: boolean
          is_reachable?: boolean | null
          job_title?: string | null
          last_activity?: string | null
          lead_source?: string | null
          linkedin_url?: string | null
          list_count?: number | null
          location?: string | null
          mobile_phone?: string | null
          person_blurb?: string | null
          phone_status?: string | null
          raw_data?: Json | null
          sales_navigator_url?: string | null
          source_list?: string | null
          source_page?: string | null
          source_row_index?: number | null
          tenure_in_company?: string | null
          tenure_in_role?: string | null
          updated_at?: string
          uploaded_file_id?: string | null
          user_id: string
          work_email?: string | null
        }
        Update: {
          added_to_list_at?: string | null
          company_decision_maker_count?: number | null
          company_employee_count?: number | null
          company_headquarters?: string | null
          company_id?: string | null
          company_industry?: string | null
          company_investor_count?: number | null
          company_match_strategy?: string | null
          company_name?: string | null
          company_public_linkedin_url?: string | null
          company_size?: string | null
          company_url?: string | null
          company_website_url?: string | null
          connection_degree?: string | null
          contact_enriched_at?: string | null
          created_at?: string
          dedupe_key?: string
          dedupe_strategy?: Database["public"]["Enums"]["dedupe_strategy"]
          duplicate_of_id?: string | null
          email_status?: string | null
          enrichment?: Json
          extraction_job_id?: string
          full_name?: string | null
          id?: string
          is_duplicate?: boolean
          is_reachable?: boolean | null
          job_title?: string | null
          last_activity?: string | null
          lead_source?: string | null
          linkedin_url?: string | null
          list_count?: number | null
          location?: string | null
          mobile_phone?: string | null
          person_blurb?: string | null
          phone_status?: string | null
          raw_data?: Json | null
          sales_navigator_url?: string | null
          source_list?: string | null
          source_page?: string | null
          source_row_index?: number | null
          tenure_in_company?: string | null
          tenure_in_role?: string | null
          updated_at?: string
          uploaded_file_id?: string | null
          user_id?: string
          work_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "extracted_leads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extracted_leads_duplicate_of_id_fkey"
            columns: ["duplicate_of_id"]
            isOneToOne: false
            referencedRelation: "extracted_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extracted_leads_extraction_job_id_fkey"
            columns: ["extraction_job_id"]
            isOneToOne: false
            referencedRelation: "extraction_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extracted_leads_uploaded_file_id_fkey"
            columns: ["uploaded_file_id"]
            isOneToOne: false
            referencedRelation: "uploaded_files"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_jobs: {
        Row: {
          accounts_created: number
          accounts_matched: number
          accounts_parsed: number
          accounts_unidentified: number
          capture_session_id: string | null
          completed_at: string | null
          created_at: string
          credits_charged: number | null
          dedupe_mode: Database["public"]["Enums"]["dedupe_mode"]
          delivered_at: string | null
          delivery_error: string | null
          destination_kind: Database["public"]["Enums"]["export_destination_kind"]
          duplicates_found: number
          duplicates_removed: number
          error_code: string | null
          error_message: string | null
          export_storage_path: string | null
          file_count: number
          id: string
          kind: string
          leads_kept: number
          leads_parsed: number
          progress_current: number
          progress_step: string | null
          progress_total: number
          request_id: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          total_bytes: number
          trashed_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          accounts_created?: number
          accounts_matched?: number
          accounts_parsed?: number
          accounts_unidentified?: number
          capture_session_id?: string | null
          completed_at?: string | null
          created_at?: string
          credits_charged?: number | null
          dedupe_mode?: Database["public"]["Enums"]["dedupe_mode"]
          delivered_at?: string | null
          delivery_error?: string | null
          destination_kind?: Database["public"]["Enums"]["export_destination_kind"]
          duplicates_found?: number
          duplicates_removed?: number
          error_code?: string | null
          error_message?: string | null
          export_storage_path?: string | null
          file_count?: number
          id?: string
          kind?: string
          leads_kept?: number
          leads_parsed?: number
          progress_current?: number
          progress_step?: string | null
          progress_total?: number
          request_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          total_bytes?: number
          trashed_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          accounts_created?: number
          accounts_matched?: number
          accounts_parsed?: number
          accounts_unidentified?: number
          capture_session_id?: string | null
          completed_at?: string | null
          created_at?: string
          credits_charged?: number | null
          dedupe_mode?: Database["public"]["Enums"]["dedupe_mode"]
          delivered_at?: string | null
          delivery_error?: string | null
          destination_kind?: Database["public"]["Enums"]["export_destination_kind"]
          duplicates_found?: number
          duplicates_removed?: number
          error_code?: string | null
          error_message?: string | null
          export_storage_path?: string | null
          file_count?: number
          id?: string
          kind?: string
          leads_kept?: number
          leads_parsed?: number
          progress_current?: number
          progress_step?: string | null
          progress_total?: number
          request_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          total_bytes?: number
          trashed_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "extraction_jobs_capture_session_id_fkey"
            columns: ["capture_session_id"]
            isOneToOne: false
            referencedRelation: "capture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      fastspring_accounts: {
        Row: {
          account_id: string
          company: string | null
          country: string | null
          created_at: string
          email: string | null
          language: string | null
          last_event_at: string
          name: string | null
          tags: Json | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          account_id: string
          company?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          language?: string | null
          last_event_at: string
          name?: string | null
          tags?: Json | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          account_id?: string
          company?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          language?: string | null
          last_event_at?: string
          name?: string | null
          tags?: Json | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      fastspring_charges: {
        Row: {
          account_id: string | null
          charge_id: string | null
          created_at: string
          credits_allocated: number
          currency: string | null
          decline_reason: string | null
          event_id: string
          event_type: string
          occurred_at: string
          plan_key: string | null
          product_path: string | null
          status: string
          subscription_id: string | null
          total: number | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          account_id?: string | null
          charge_id?: string | null
          created_at?: string
          credits_allocated?: number
          currency?: string | null
          decline_reason?: string | null
          event_id: string
          event_type: string
          occurred_at: string
          plan_key?: string | null
          product_path?: string | null
          status: string
          subscription_id?: string | null
          total?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          account_id?: string | null
          charge_id?: string | null
          created_at?: string
          credits_allocated?: number
          currency?: string | null
          decline_reason?: string | null
          event_id?: string
          event_type?: string
          occurred_at?: string
          plan_key?: string | null
          product_path?: string | null
          status?: string
          subscription_id?: string | null
          total?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      fastspring_orders: {
        Row: {
          account_id: string | null
          completed_at: string | null
          created_at: string
          currency: string
          last_event_at: string
          live: boolean
          order_id: string
          product_path: string | null
          reference: string | null
          subscription_id: string | null
          tags: Json | null
          total: number | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          account_id?: string | null
          completed_at?: string | null
          created_at?: string
          currency: string
          last_event_at: string
          live?: boolean
          order_id: string
          product_path?: string | null
          reference?: string | null
          subscription_id?: string | null
          tags?: Json | null
          total?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          account_id?: string | null
          completed_at?: string | null
          created_at?: string
          currency?: string
          last_event_at?: string
          live?: boolean
          order_id?: string
          product_path?: string | null
          reference?: string | null
          subscription_id?: string | null
          tags?: Json | null
          total?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fastspring_orders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "fastspring_accounts"
            referencedColumns: ["account_id"]
          },
        ]
      }
      fastspring_subscriptions: {
        Row: {
          account_id: string
          active: boolean
          auto_renew: boolean | null
          begin_at: string | null
          billing_interval: string | null
          canceled_at: string | null
          created_at: string
          currency: string | null
          deactivated_at: string | null
          last_event_at: string
          next_charge_at: string | null
          plan_key: string | null
          price: number | null
          product_path: string
          state: string
          subscription_id: string
          tags: Json | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          account_id: string
          active: boolean
          auto_renew?: boolean | null
          begin_at?: string | null
          billing_interval?: string | null
          canceled_at?: string | null
          created_at?: string
          currency?: string | null
          deactivated_at?: string | null
          last_event_at: string
          next_charge_at?: string | null
          plan_key?: string | null
          price?: number | null
          product_path: string
          state: string
          subscription_id: string
          tags?: Json | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          account_id?: string
          active?: boolean
          auto_renew?: boolean | null
          begin_at?: string | null
          billing_interval?: string | null
          canceled_at?: string | null
          created_at?: string
          currency?: string | null
          deactivated_at?: string | null
          last_event_at?: string
          next_charge_at?: string | null
          plan_key?: string | null
          price?: number | null
          product_path?: string
          state?: string
          subscription_id?: string
          tags?: Json | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fastspring_subscriptions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "fastspring_accounts"
            referencedColumns: ["account_id"]
          },
        ]
      }
      fastspring_webhook_events: {
        Row: {
          event_id: string
          event_type: string
          occurred_at: string
          processed_at: string
        }
        Insert: {
          event_id: string
          event_type: string
          occurred_at: string
          processed_at?: string
        }
        Update: {
          event_id?: string
          event_type?: string
          occurred_at?: string
          processed_at?: string
        }
        Relationships: []
      }
      flow_runs: {
        Row: {
          chain_depth: number
          contact_id: string | null
          created_at: string
          current_step: string | null
          finished_at: string | null
          flow_id: string
          halt_reason: string | null
          id: string
          idempotency_key: string | null
          parent_run_id: string | null
          resume_at: string | null
          started_at: string
          status: Database["public"]["Enums"]["flow_run_status"]
          trigger_type: string
          updated_at: string
          version_id: string
          workspace_id: string
        }
        Insert: {
          chain_depth?: number
          contact_id?: string | null
          created_at?: string
          current_step?: string | null
          finished_at?: string | null
          flow_id: string
          halt_reason?: string | null
          id?: string
          idempotency_key?: string | null
          parent_run_id?: string | null
          resume_at?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["flow_run_status"]
          trigger_type: string
          updated_at?: string
          version_id: string
          workspace_id: string
        }
        Update: {
          chain_depth?: number
          contact_id?: string | null
          created_at?: string
          current_step?: string | null
          finished_at?: string | null
          flow_id?: string
          halt_reason?: string | null
          id?: string
          idempotency_key?: string | null
          parent_run_id?: string | null
          resume_at?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["flow_run_status"]
          trigger_type?: string
          updated_at?: string
          version_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_runs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_runs_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_runs_parent_run_id_fkey"
            columns: ["parent_run_id"]
            isOneToOne: false
            referencedRelation: "flow_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_runs_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "flow_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_step_runs: {
        Row: {
          attempt: number
          created_at: string
          credits_used: number
          duration_ms: number | null
          error_code: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          input: Json
          output: Json
          run_id: string
          started_at: string
          status: Database["public"]["Enums"]["flow_step_status"]
          step_id: string
          step_type: string
          workspace_id: string
        }
        Insert: {
          attempt?: number
          created_at?: string
          credits_used?: number
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          input?: Json
          output?: Json
          run_id: string
          started_at?: string
          status?: Database["public"]["Enums"]["flow_step_status"]
          step_id: string
          step_type: string
          workspace_id: string
        }
        Update: {
          attempt?: number
          created_at?: string
          credits_used?: number
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          input?: Json
          output?: Json
          run_id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["flow_step_status"]
          step_id?: string
          step_type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_step_runs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "flow_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_step_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_versions: {
        Row: {
          created_at: string
          created_by: string | null
          definition: Json
          flow_id: string
          id: string
          published_at: string | null
          version: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          definition: Json
          flow_id: string
          id?: string
          published_at?: string | null
          version: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          definition?: Json
          flow_id?: string
          id?: string
          published_at?: string | null
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_versions_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      flows: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          id: string
          max_chain_depth: number
          max_runs_per_contact_per_day: number
          name: string
          published_version_id: string | null
          status: Database["public"]["Enums"]["flow_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          max_chain_depth?: number
          max_runs_per_contact_per_day?: number
          name: string
          published_version_id?: string | null
          status?: Database["public"]["Enums"]["flow_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          max_chain_depth?: number
          max_runs_per_contact_per_day?: number
          name?: string
          published_version_id?: string | null
          status?: Database["public"]["Enums"]["flow_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flows_published_version_fk"
            columns: ["published_version_id"]
            isOneToOne: false
            referencedRelation: "flow_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flows_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      hubble_answers: {
        Row: {
          answer: string
          company_id: string | null
          confidence: number
          created_at: string
          expires_at: string | null
          id: string
          lead_id: string | null
          question: string
          question_key: string
          research_run_id: string | null
          sources: Json
          status: string
          usage: Json
          user_id: string
        }
        Insert: {
          answer: string
          company_id?: string | null
          confidence?: number
          created_at?: string
          expires_at?: string | null
          id?: string
          lead_id?: string | null
          question: string
          question_key: string
          research_run_id?: string | null
          sources?: Json
          status?: string
          usage?: Json
          user_id: string
        }
        Update: {
          answer?: string
          company_id?: string | null
          confidence?: number
          created_at?: string
          expires_at?: string | null
          id?: string
          lead_id?: string | null
          question?: string
          question_key?: string
          research_run_id?: string | null
          sources?: Json
          status?: string
          usage?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hubble_answers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hubble_answers_research_run_id_fkey"
            columns: ["research_run_id"]
            isOneToOne: false
            referencedRelation: "research_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      hubble_calls: {
        Row: {
          created_at: string
          credits_quoted: number
          credits_spent: number
          duration_ms: number | null
          error_code: string | null
          error_message: string | null
          flow_run_id: string | null
          id: string
          outcome: string
          source: string | null
          task: string
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          credits_quoted?: number
          credits_spent?: number
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          flow_run_id?: string | null
          id?: string
          outcome: string
          source?: string | null
          task: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          credits_quoted?: number
          credits_spent?: number
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          flow_run_id?: string | null
          id?: string
          outcome?: string
          source?: string | null
          task?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hubble_calls_flow_run_id_fkey"
            columns: ["flow_run_id"]
            isOneToOne: false
            referencedRelation: "flow_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hubble_calls_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      hubble_chunks: {
        Row: {
          company_id: string | null
          content: string
          created_at: string
          embed_model: string | null
          embedding: number[] | null
          id: string
          ordinal: number
          page_id: string
          user_id: string
        }
        Insert: {
          company_id?: string | null
          content: string
          created_at?: string
          embed_model?: string | null
          embedding?: number[] | null
          id?: string
          ordinal: number
          page_id: string
          user_id: string
        }
        Update: {
          company_id?: string | null
          content?: string
          created_at?: string
          embed_model?: string | null
          embedding?: number[] | null
          id?: string
          ordinal?: number
          page_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hubble_chunks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hubble_chunks_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "hubble_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      hubble_pages: {
        Row: {
          company_id: string | null
          content: string
          content_chars: number
          created_at: string
          expires_at: string | null
          fetch_method: string
          fetched_at: string
          host: string
          http_status: number | null
          id: string
          structured: Json
          title: string | null
          url: string
          user_id: string
        }
        Insert: {
          company_id?: string | null
          content: string
          content_chars: number
          created_at?: string
          expires_at?: string | null
          fetch_method?: string
          fetched_at?: string
          host: string
          http_status?: number | null
          id?: string
          structured?: Json
          title?: string | null
          url: string
          user_id: string
        }
        Update: {
          company_id?: string | null
          content?: string
          content_chars?: number
          created_at?: string
          expires_at?: string | null
          fetch_method?: string
          fetched_at?: string
          host?: string
          http_status?: number | null
          id?: string
          structured?: Json
          title?: string | null
          url?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hubble_pages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_connections: {
        Row: {
          configuration: Json
          connected_at: string | null
          created_at: string
          external_account_email: string | null
          external_account_id: string | null
          external_account_name: string | null
          id: string
          last_error: string | null
          last_tested_at: string | null
          last_used_at: string | null
          provider: string
          scopes: string[]
          secret_reference: string
          status: string
          token_expires_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          configuration?: Json
          connected_at?: string | null
          created_at?: string
          external_account_email?: string | null
          external_account_id?: string | null
          external_account_name?: string | null
          id?: string
          last_error?: string | null
          last_tested_at?: string | null
          last_used_at?: string | null
          provider: string
          scopes?: string[]
          secret_reference?: string
          status?: string
          token_expires_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          configuration?: Json
          connected_at?: string | null
          created_at?: string
          external_account_email?: string | null
          external_account_id?: string | null
          external_account_name?: string | null
          id?: string
          last_error?: string | null
          last_tested_at?: string | null
          last_used_at?: string | null
          provider?: string
          scopes?: string[]
          secret_reference?: string
          status?: string
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      integration_oauth_transactions: {
        Row: {
          created_at: string
          encrypted_code_verifier: string | null
          expires_at: string
          id: string
          provider: string
          redirect_uri: string
          return_to: string
          state_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          encrypted_code_verifier?: string | null
          expires_at: string
          id?: string
          provider: string
          redirect_uri: string
          return_to?: string
          state_hash: string
          user_id: string
        }
        Update: {
          created_at?: string
          encrypted_code_verifier?: string | null
          expires_at?: string
          id?: string
          provider?: string
          redirect_uri?: string
          return_to?: string
          state_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      integration_record_links: {
        Row: {
          account_list_entry_id: string | null
          connection_id: string
          created_at: string
          id: string
          lead_id: string | null
          provider_record_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_list_entry_id?: string | null
          connection_id: string
          created_at?: string
          id?: string
          lead_id?: string | null
          provider_record_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_list_entry_id?: string | null
          connection_id?: string
          created_at?: string
          id?: string
          lead_id?: string | null
          provider_record_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_record_links_account_list_entry_id_fkey"
            columns: ["account_list_entry_id"]
            isOneToOne: false
            referencedRelation: "account_list_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_record_links_connection_id_user_id_fkey"
            columns: ["connection_id", "user_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "integration_record_links_lead_id_user_id_fkey"
            columns: ["lead_id", "user_id"]
            isOneToOne: false
            referencedRelation: "extracted_leads"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      integration_secrets: {
        Row: {
          connection_id: string
          created_at: string
          encrypted_payload: string
          id: string
          updated_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          encrypted_payload: string
          id: string
          updated_at?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          encrypted_payload?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_secrets_connection_id_id_fkey"
            columns: ["connection_id", "id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["id", "secret_reference"]
          },
        ]
      }
      invitation_codes: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          is_active: boolean
          max_uses: number
          plan_id: string | null
          updated_at: string
          used_count: number
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number
          plan_id?: string | null
          updated_at?: string
          used_count?: number
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number
          plan_id?: string | null
          updated_at?: string
          used_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "invitation_codes_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      job_queue: {
        Row: {
          attempts: number
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          id: string
          job_id: string
          last_error: string | null
          max_attempts: number
          next_attempt_at: string
          status: Database["public"]["Enums"]["queue_status"]
          updated_at: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          id?: string
          job_id: string
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          status?: Database["public"]["Enums"]["queue_status"]
          updated_at?: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          id?: string
          job_id?: string
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          status?: Database["public"]["Enums"]["queue_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_queue_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "extraction_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_keys: {
        Row: {
          dedupe_key: string
          first_seen: string
          id: string
          last_seen: string
          seen_count: number
          user_id: string
        }
        Insert: {
          dedupe_key: string
          first_seen?: string
          id?: string
          last_seen?: string
          seen_count?: number
          user_id: string
        }
        Update: {
          dedupe_key?: string
          first_seen?: string
          id?: string
          last_seen?: string
          seen_count?: number
          user_id?: string
        }
        Relationships: []
      }
      meeting_bookings: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          contact_id: string | null
          created_at: string
          ends_at: string | null
          id: string
          invitee_email: string
          invitee_name: string | null
          join_url: string | null
          originally_scheduled_at: string
          owner_user_id: string | null
          provider: string
          provider_event_id: string
          reschedule_count: number
          scheduled_at: string
          status: Database["public"]["Enums"]["meeting_status"]
          title: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          contact_id?: string | null
          created_at?: string
          ends_at?: string | null
          id?: string
          invitee_email: string
          invitee_name?: string | null
          join_url?: string | null
          originally_scheduled_at: string
          owner_user_id?: string | null
          provider: string
          provider_event_id: string
          reschedule_count?: number
          scheduled_at: string
          status?: Database["public"]["Enums"]["meeting_status"]
          title?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          contact_id?: string | null
          created_at?: string
          ends_at?: string | null
          id?: string
          invitee_email?: string
          invitee_name?: string | null
          join_url?: string | null
          originally_scheduled_at?: string
          owner_user_id?: string | null
          provider?: string
          provider_event_id?: string
          reschedule_count?: number
          scheduled_at?: string
          status?: Database["public"]["Enums"]["meeting_status"]
          title?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_bookings_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_bookings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_events: {
        Row: {
          booking_id: string | null
          created_at: string
          id: string
          metadata: Json
          new_scheduled_at: string | null
          occurred_at: string
          previous_scheduled_at: string | null
          provider: string
          provider_delivery_id: string | null
          type: Database["public"]["Enums"]["meeting_event_type"]
          workspace_id: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          new_scheduled_at?: string | null
          occurred_at?: string
          previous_scheduled_at?: string | null
          provider: string
          provider_delivery_id?: string | null
          type: Database["public"]["Enums"]["meeting_event_type"]
          workspace_id: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          new_scheduled_at?: string | null
          occurred_at?: string
          previous_scheduled_at?: string | null
          provider?: string
          provider_delivery_id?: string | null
          type?: Database["public"]["Enums"]["meeting_event_type"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "meeting_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_unmatched_invitees: {
        Row: {
          booking_id: string
          created_at: string
          id: string
          invitee_email: string
          invitee_name: string | null
          resolved_at: string | null
          resolved_by: string | null
          resolved_contact_id: string | null
          workspace_id: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          id?: string
          invitee_email: string
          invitee_name?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_contact_id?: string | null
          workspace_id: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          id?: string
          invitee_email?: string
          invitee_name?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_contact_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_unmatched_invitees_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "meeting_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_unmatched_invitees_resolved_contact_id_fkey"
            columns: ["resolved_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_unmatched_invitees_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      paddle_customers: {
        Row: {
          created_at: string
          custom_data: Json | null
          customer_id: string
          email: string | null
          last_event_at: string
          marketing_consent: boolean
          name: string | null
          paddle_created_at: string | null
          paddle_updated_at: string | null
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          custom_data?: Json | null
          customer_id: string
          email?: string | null
          last_event_at: string
          marketing_consent?: boolean
          name?: string | null
          paddle_created_at?: string | null
          paddle_updated_at?: string | null
          status: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          custom_data?: Json | null
          customer_id?: string
          email?: string | null
          last_event_at?: string
          marketing_consent?: boolean
          name?: string | null
          paddle_created_at?: string | null
          paddle_updated_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      paddle_subscriptions: {
        Row: {
          canceled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          custom_data: Json | null
          customer_id: string
          last_event_at: string
          paused_at: string | null
          plan_key: string | null
          price_id: string
          product_id: string
          scheduled_change_action: string | null
          scheduled_change_at: string | null
          status: string
          subscription_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          custom_data?: Json | null
          customer_id: string
          last_event_at: string
          paused_at?: string | null
          plan_key?: string | null
          price_id: string
          product_id: string
          scheduled_change_action?: string | null
          scheduled_change_at?: string | null
          status: string
          subscription_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          custom_data?: Json | null
          customer_id?: string
          last_event_at?: string
          paused_at?: string | null
          plan_key?: string | null
          price_id?: string
          product_id?: string
          scheduled_change_action?: string | null
          scheduled_change_at?: string | null
          status?: string
          subscription_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "paddle_subscriptions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "paddle_customers"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      paddle_transactions: {
        Row: {
          billed_at: string | null
          created_at: string
          currency_code: string
          custom_data: Json | null
          customer_id: string | null
          last_event_at: string
          price_id: string | null
          product_id: string | null
          status: string
          subscription_id: string | null
          total: string | null
          transaction_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          billed_at?: string | null
          created_at?: string
          currency_code: string
          custom_data?: Json | null
          customer_id?: string | null
          last_event_at: string
          price_id?: string | null
          product_id?: string | null
          status: string
          subscription_id?: string | null
          total?: string | null
          transaction_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          billed_at?: string | null
          created_at?: string
          currency_code?: string
          custom_data?: Json | null
          customer_id?: string | null
          last_event_at?: string
          price_id?: string | null
          product_id?: string | null
          status?: string
          subscription_id?: string | null
          total?: string | null
          transaction_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "paddle_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "paddle_customers"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      paddle_webhook_events: {
        Row: {
          event_id: string
          event_type: string
          occurred_at: string
          processed_at: string
        }
        Insert: {
          event_id: string
          event_type: string
          occurred_at: string
          processed_at?: string
        }
        Update: {
          event_id?: string
          event_type?: string
          occurred_at?: string
          processed_at?: string
        }
        Relationships: []
      }
      plans: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          key: Database["public"]["Enums"]["plan_key"]
          limits: Json
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          key: Database["public"]["Enums"]["plan_key"]
          limits?: Json
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          key?: Database["public"]["Enums"]["plan_key"]
          limits?: Json
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          access_expires_at: string | null
          avatar_path: string | null
          company_name: string | null
          consent_accepted_at: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          extension_enabled: boolean
          full_name: string | null
          id: string
          linkedin_url: string | null
          phone: string | null
          plan_id: string | null
          referral_code: string | null
          role: Database["public"]["Enums"]["user_role"]
          suspended_at: string | null
          suspended_reason: string | null
          updated_at: string
        }
        Insert: {
          access_expires_at?: string | null
          avatar_path?: string | null
          company_name?: string | null
          consent_accepted_at?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          extension_enabled?: boolean
          full_name?: string | null
          id: string
          linkedin_url?: string | null
          phone?: string | null
          plan_id?: string | null
          referral_code?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          suspended_at?: string | null
          suspended_reason?: string | null
          updated_at?: string
        }
        Update: {
          access_expires_at?: string | null
          avatar_path?: string | null
          company_name?: string | null
          consent_accepted_at?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          extension_enabled?: boolean
          full_name?: string | null
          id?: string
          linkedin_url?: string | null
          phone?: string | null
          plan_id?: string | null
          referral_code?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          suspended_at?: string | null
          suspended_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_cache: {
        Row: {
          cache_key: string
          created_at: string
          expires_at: string
          provider: string
          retrieved_at: string
          updated_at: string
          value_json: Json
        }
        Insert: {
          cache_key: string
          created_at?: string
          expires_at: string
          provider: string
          retrieved_at: string
          updated_at?: string
          value_json: Json
        }
        Update: {
          cache_key?: string
          created_at?: string
          expires_at?: string
          provider?: string
          retrieved_at?: string
          updated_at?: string
          value_json?: Json
        }
        Relationships: []
      }
      provider_request_schedules: {
        Row: {
          last_started_at: string | null
          provider: string
          updated_at: string
        }
        Insert: {
          last_started_at?: string | null
          provider: string
          updated_at?: string
        }
        Update: {
          last_started_at?: string | null
          provider?: string
          updated_at?: string
        }
        Relationships: []
      }
      qualification_profiles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_archived: boolean
          name: string
          qualify_at: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_archived?: boolean
          name: string
          qualify_at?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_archived?: boolean
          name?: string
          qualify_at?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      qualification_results: {
        Row: {
          breakdown: Json
          created_at: string
          disqualified_by: string | null
          entity_id: string
          entity_type: string
          id: string
          profile_id: string | null
          qualified: boolean
          research_run_id: string | null
          score: number
          unknown_count: number
          user_id: string
        }
        Insert: {
          breakdown?: Json
          created_at?: string
          disqualified_by?: string | null
          entity_id: string
          entity_type: string
          id?: string
          profile_id?: string | null
          qualified: boolean
          research_run_id?: string | null
          score: number
          unknown_count?: number
          user_id: string
        }
        Update: {
          breakdown?: Json
          created_at?: string
          disqualified_by?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          profile_id?: string | null
          qualified?: boolean
          research_run_id?: string | null
          score?: number
          unknown_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qualification_results_profile_id_user_id_fkey"
            columns: ["profile_id", "user_id"]
            isOneToOne: false
            referencedRelation: "qualification_profiles"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "qualification_results_research_run_id_fkey"
            columns: ["research_run_id"]
            isOneToOne: false
            referencedRelation: "research_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      qualification_rules: {
        Row: {
          created_at: string
          field: string
          id: string
          kind: string
          operator: string
          profile_id: string
          sort_order: number
          updated_at: string
          user_id: string
          value: Json | null
          value_path: string | null
          weight: number
        }
        Insert: {
          created_at?: string
          field: string
          id?: string
          kind?: string
          operator: string
          profile_id: string
          sort_order?: number
          updated_at?: string
          user_id: string
          value?: Json | null
          value_path?: string | null
          weight?: number
        }
        Update: {
          created_at?: string
          field?: string
          id?: string
          kind?: string
          operator?: string
          profile_id?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
          value?: Json | null
          value_path?: string | null
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "qualification_rules_profile_id_user_id_fkey"
            columns: ["profile_id", "user_id"]
            isOneToOne: false
            referencedRelation: "qualification_profiles"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          attempts: number
          blocked_until: string | null
          bucket: string
          created_at: string
          id: string
          subject: string
          updated_at: string
          window_start: string
        }
        Insert: {
          attempts?: number
          blocked_until?: string | null
          bucket: string
          created_at?: string
          id?: string
          subject: string
          updated_at?: string
          window_start: string
        }
        Update: {
          attempts?: number
          blocked_until?: string | null
          bucket?: string
          created_at?: string
          id?: string
          subject?: string
          updated_at?: string
          window_start?: string
        }
        Relationships: []
      }
      referrals: {
        Row: {
          code: string
          created_at: string
          id: string
          referred_user_id: string
          referrer_id: string
          rewarded_at: string | null
          status: Database["public"]["Enums"]["referral_status"]
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          referred_user_id: string
          referrer_id: string
          rewarded_at?: string | null
          status?: Database["public"]["Enums"]["referral_status"]
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          referred_user_id?: string
          referrer_id?: string
          rewarded_at?: string | null
          status?: Database["public"]["Enums"]["referral_status"]
        }
        Relationships: [
          {
            foreignKeyName: "referrals_referred_user_id_fkey"
            columns: ["referred_user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      research_evidence: {
        Row: {
          confidence: number
          created_at: string
          entity_id: string
          entity_type: string
          expires_at: string | null
          field: string
          id: string
          research_run_id: string | null
          retrieved_at: string
          source_confidence: string
          source_provider: string
          source_url: string | null
          user_id: string
          value_json: Json
        }
        Insert: {
          confidence?: number
          created_at?: string
          entity_id: string
          entity_type: string
          expires_at?: string | null
          field: string
          id?: string
          research_run_id?: string | null
          retrieved_at?: string
          source_confidence: string
          source_provider: string
          source_url?: string | null
          user_id: string
          value_json: Json
        }
        Update: {
          confidence?: number
          created_at?: string
          entity_id?: string
          entity_type?: string
          expires_at?: string | null
          field?: string
          id?: string
          research_run_id?: string | null
          retrieved_at?: string
          source_confidence?: string
          source_provider?: string
          source_url?: string | null
          user_id?: string
          value_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "research_evidence_research_run_id_fkey"
            columns: ["research_run_id"]
            isOneToOne: false
            referencedRelation: "research_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      research_job_queue: {
        Row: {
          attempts: number
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          id: string
          last_error: string | null
          max_attempts: number
          next_attempt_at: string
          research_run_id: string
          status: Database["public"]["Enums"]["queue_status"]
          updated_at: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          research_run_id: string
          status?: Database["public"]["Enums"]["queue_status"]
          updated_at?: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          research_run_id?: string
          status?: Database["public"]["Enums"]["queue_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_job_queue_research_run_id_fkey"
            columns: ["research_run_id"]
            isOneToOne: true
            referencedRelation: "research_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      research_runs: {
        Row: {
          actual_cost_micros: number
          cache_hit_count: number
          clarifications: Json
          company_count: number
          completed_at: string | null
          created_at: string
          duration_ms: number | null
          error_code: string | null
          error_message: string | null
          estimated_cost_micros: number
          evidence_gaps: Json
          external_call_count: number
          id: string
          idempotency_key: string | null
          lead_count: number
          plan: Json | null
          progress_current: number
          progress_stage: string
          progress_total: number
          qualification_profile_id: string | null
          qualified_count: number
          query_text: string
          scope: Json
          started_at: string | null
          status: string
          tools_used: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          actual_cost_micros?: number
          cache_hit_count?: number
          clarifications?: Json
          company_count?: number
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          estimated_cost_micros?: number
          evidence_gaps?: Json
          external_call_count?: number
          id?: string
          idempotency_key?: string | null
          lead_count?: number
          plan?: Json | null
          progress_current?: number
          progress_stage?: string
          progress_total?: number
          qualification_profile_id?: string | null
          qualified_count?: number
          query_text: string
          scope?: Json
          started_at?: string | null
          status?: string
          tools_used?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          actual_cost_micros?: number
          cache_hit_count?: number
          clarifications?: Json
          company_count?: number
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          estimated_cost_micros?: number
          evidence_gaps?: Json
          external_call_count?: number
          id?: string
          idempotency_key?: string | null
          lead_count?: number
          plan?: Json | null
          progress_current?: number
          progress_stage?: string
          progress_total?: number
          qualification_profile_id?: string | null
          qualified_count?: number
          query_text?: string
          scope?: Json
          started_at?: string | null
          status?: string
          tools_used?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_runs_qualification_profile_fk"
            columns: ["qualification_profile_id"]
            isOneToOne: false
            referencedRelation: "qualification_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      research_tool_calls: {
        Row: {
          created_at: string
          entity_id: string | null
          entity_type: string | null
          error_code: string | null
          estimated_cost_micros: number
          id: string
          latency_ms: number | null
          provider: string
          research_run_id: string | null
          status: string
          tool: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          error_code?: string | null
          estimated_cost_micros?: number
          id?: string
          latency_ms?: number | null
          provider: string
          research_run_id?: string | null
          status: string
          tool: string
          user_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          error_code?: string | null
          estimated_cost_micros?: number
          id?: string
          latency_ms?: number | null
          provider?: string
          research_run_id?: string | null
          status?: string
          tool?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_tool_calls_research_run_id_fkey"
            columns: ["research_run_id"]
            isOneToOne: false
            referencedRelation: "research_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      signup_device_claims: {
        Row: {
          claimed_at: string
          device_hash: string
          user_id: string
        }
        Insert: {
          claimed_at?: string
          device_hash: string
          user_id: string
        }
        Update: {
          claimed_at?: string
          device_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      signup_identity_claims: {
        Row: {
          claimed_at: string
          identity_hash: string
          identity_kind: string
          user_id: string
        }
        Insert: {
          claimed_at?: string
          identity_hash: string
          identity_kind: string
          user_id: string
        }
        Update: {
          claimed_at?: string
          identity_hash?: string
          identity_kind?: string
          user_id?: string
        }
        Relationships: []
      }
      signup_ip_claims: {
        Row: {
          claimed_at: string | null
          created_at: string
          ip_hash: string
          reserved_until: string
          token_hash: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          claimed_at?: string | null
          created_at?: string
          ip_hash: string
          reserved_until: string
          token_hash?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          claimed_at?: string | null
          created_at?: string
          ip_hash?: string
          reserved_until?: string
          token_hash?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          access_expires_at_before_cancel: string | null
          cancel_at: string | null
          cancelled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string
          fastspring_account_id: string | null
          fastspring_event_at: string | null
          fastspring_product_path: string | null
          granted_by: string | null
          id: string
          paddle_customer_id: string | null
          paddle_event_at: string | null
          paddle_price_id: string | null
          paddle_product_id: string | null
          plan_id: string
          provider: string
          provider_ref: string | null
          scheduled_change_action: string | null
          scheduled_change_at: string | null
          status: Database["public"]["Enums"]["subscription_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          access_expires_at_before_cancel?: string | null
          cancel_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string
          fastspring_account_id?: string | null
          fastspring_event_at?: string | null
          fastspring_product_path?: string | null
          granted_by?: string | null
          id?: string
          paddle_customer_id?: string | null
          paddle_event_at?: string | null
          paddle_price_id?: string | null
          paddle_product_id?: string | null
          plan_id: string
          provider?: string
          provider_ref?: string | null
          scheduled_change_action?: string | null
          scheduled_change_at?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          access_expires_at_before_cancel?: string | null
          cancel_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string
          fastspring_account_id?: string | null
          fastspring_event_at?: string | null
          fastspring_product_path?: string | null
          granted_by?: string | null
          id?: string
          paddle_customer_id?: string | null
          paddle_event_at?: string | null
          paddle_price_id?: string | null
          paddle_product_id?: string | null
          plan_id?: string
          provider?: string
          provider_ref?: string | null
          scheduled_change_action?: string | null
          scheduled_change_at?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      system_events: {
        Row: {
          context: Json | null
          created_at: string
          duration_ms: number | null
          error_code: string | null
          event: string
          file_id: string | null
          id: string
          job_id: string | null
          level: string
          message: string | null
          request_id: string | null
          user_id: string | null
        }
        Insert: {
          context?: Json | null
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          event: string
          file_id?: string | null
          id?: string
          job_id?: string | null
          level?: string
          message?: string | null
          request_id?: string | null
          user_id?: string | null
        }
        Update: {
          context?: Json | null
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          event?: string
          file_id?: string | null
          id?: string
          job_id?: string | null
          level?: string
          message?: string | null
          request_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "system_events_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "uploaded_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "extraction_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      uploaded_files: {
        Row: {
          byte_size: number
          content_sha256: string
          created_at: string
          deleted_at: string | null
          error_code: string | null
          error_message: string | null
          extraction_job_id: string
          id: string
          leads_found: number
          original_filename: string
          processed_at: string | null
          status: Database["public"]["Enums"]["file_status"]
          storage_path: string
          updated_at: string
          user_id: string
        }
        Insert: {
          byte_size: number
          content_sha256: string
          created_at?: string
          deleted_at?: string | null
          error_code?: string | null
          error_message?: string | null
          extraction_job_id: string
          id?: string
          leads_found?: number
          original_filename: string
          processed_at?: string | null
          status?: Database["public"]["Enums"]["file_status"]
          storage_path: string
          updated_at?: string
          user_id: string
        }
        Update: {
          byte_size?: number
          content_sha256?: string
          created_at?: string
          deleted_at?: string | null
          error_code?: string | null
          error_message?: string | null
          extraction_job_id?: string
          id?: string
          leads_found?: number
          original_filename?: string
          processed_at?: string | null
          status?: Database["public"]["Enums"]["file_status"]
          storage_path?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "uploaded_files_extraction_job_id_fkey"
            columns: ["extraction_job_id"]
            isOneToOne: false
            referencedRelation: "extraction_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_counters: {
        Row: {
          count: number
          created_at: string
          id: string
          metric: string
          period_end: string
          period_start: string
          updated_at: string
          user_id: string
        }
        Insert: {
          count?: number
          created_at?: string
          id?: string
          metric: string
          period_end: string
          period_start: string
          updated_at?: string
          user_id: string
        }
        Update: {
          count?: number
          created_at?: string
          id?: string
          metric?: string
          period_end?: string
          period_start?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      web_research_cache: {
        Row: {
          cache_key: string
          expires_at: string
          namespace: string
          value: Json
        }
        Insert: {
          cache_key: string
          expires_at: string
          namespace: string
          value: Json
        }
        Update: {
          cache_key?: string
          expires_at?: string
          namespace?: string
          value?: Json
        }
        Relationships: []
      }
      web_research_jobs: {
        Row: {
          created_at: string
          error: Json | null
          id: string
          output: Json | null
          request: Json
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: Json | null
          id: string
          output?: Json | null
          request: Json
          status: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: Json | null
          id?: string
          output?: Json | null
          request?: Json
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      web_research_lead_results: {
        Row: {
          job_id: string
          lead_id: string
          output: Json
          researched_at: string
          tenant_id: string
        }
        Insert: {
          job_id: string
          lead_id: string
          output: Json
          researched_at?: string
          tenant_id: string
        }
        Update: {
          job_id?: string
          lead_id?: string
          output?: Json
          researched_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "web_research_lead_results_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "web_research_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_feature_flags: {
        Row: {
          enabled: boolean
          flag: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          enabled?: boolean
          flag: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          enabled?: boolean
          flag?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_feature_flags_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          revoked_at: string | null
          role: Database["public"]["Enums"]["workspace_role"]
          token_hash: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by?: string | null
          revoked_at?: string | null
          role: Database["public"]["Enums"]["workspace_role"]
          token_hash: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["workspace_role"]
          token_hash?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invitations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_memberships: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["workspace_role"]
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["workspace_role"]
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["workspace_role"]
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_memberships_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          member_limit_override: number | null
          name: string
          owner_user_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          member_limit_override?: number | null
          name: string
          owner_user_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          member_limit_override?: number | null
          name?: string
          owner_user_id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      await_provider_request_slot: {
        Args: { p_min_interval_ms: number; p_provider: string }
        Returns: string
      }
      bootstrap_admin: { Args: { p_email: string }; Returns: string }
      campaign_event_totals: {
        Args: { p_campaign_id: string }
        Returns: {
          auto_replied: number
          bounced: number
          complaints: number
          delivered: number
          failed: number
          replied: number
          sent: number
          unsubscribed: number
        }[]
      }
      charge_extraction_leads: {
        Args: { p_job_id: string; p_lead_count: number; p_user_id: string }
        Returns: {
          charged: number
          credits_left: number
          required: number
          status: string
        }[]
      }
      claim_capture_page: {
        Args: {
          p_content_hash: string
          p_page_ident: string
          p_session_id: string
          p_source_url: string
          p_user_id: string
        }
        Returns: {
          page_id: string
          status: string
        }[]
      }
      claim_email_messages: {
        Args: {
          p_claim_seconds?: number
          p_claimed_by: string
          p_limit?: number
        }
        Returns: {
          account_id: string
          attempts: number
          body_html: string
          body_text: string
          idempotency_key: string
          message_id: string
          subject: string
          thread_id: string
          to_email: string
          workspace_id: string
        }[]
      }
      claim_job: {
        Args: { p_claimed_by: string; p_job_id: string; p_user_id: string }
        Returns: {
          attempts: number
          job_id: string
          user_id: string
        }[]
      }
      claim_next_job: {
        Args: { p_claimed_by: string }
        Returns: {
          attempts: number
          job_id: string
          user_id: string
        }[]
      }
      claim_next_research_run: {
        Args: { p_claimed_by: string }
        Returns: {
          attempts: number
          research_run_id: string
          user_id: string
        }[]
      }
      claim_research_run: {
        Args: { p_claimed_by: string; p_run_id: string; p_user_id: string }
        Returns: {
          attempts: number
          research_run_id: string
          user_id: string
        }[]
      }
      claim_salesforce_token_refresh: {
        Args: {
          p_claim_expires_at: string
          p_connection_id: string
          p_expected_encrypted_payload: string
          p_refresh_claim: string
          p_user_id: string
        }
        Returns: boolean
      }
      consume_credit: {
        Args: {
          p_amount?: number
          p_period_end?: string
          p_period_start?: string
          p_user_id: string
        }
        Returns: number
      }
      consume_rate_limit: {
        Args: {
          p_block_seconds: number
          p_bucket: string
          p_max_attempts: number
          p_subject: string
          p_window_start: string
        }
        Returns: {
          attempts: number
          blocked_until: string
        }[]
      }
      credit_balance: {
        Args: { p_user_id: string }
        Returns: {
          allowance: number
          granted: number
          remaining: number
          used: number
        }[]
      }
      crm_batch_funnel: {
        Args: { p_batch_id: string; p_workspace_id: string }
        Returns: {
          assigned: number
          call_booked: number
          canonical: number
          engaged: number
          extracted: number
          opportunities: number
          qualified: number
          replied: number
          with_email: number
          won_deals: number
          won_revenue: number
        }[]
      }
      crm_erase_contact: {
        Args: {
          p_actor_id?: string
          p_contact_id: string
          p_reason?: string
          p_workspace_id: string
        }
        Returns: Json
      }
      crm_forecast_by_period: {
        Args: { p_owner_user_id?: string; p_workspace_id: string }
        Returns: {
          open_deals: number
          open_value: number
          period: string
          weighted_value: number
        }[]
      }
      crm_ingest_contacts: {
        Args: { p_batch_id: string; p_contacts: Json; p_workspace_id: string }
        Returns: {
          contact_id: string
          created: boolean
          matched_by: string
          ref: string
        }[]
      }
      crm_merge_contacts: {
        Args: {
          p_actor_id?: string
          p_merged_id: string
          p_survivor_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      crm_move_opportunity_stage: {
        Args: {
          p_actor_id?: string
          p_expected_version: number
          p_lost_reason?: string
          p_opportunity_id: string
          p_to_stage_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      crm_pipeline_totals: {
        Args: { p_owner_user_id?: string; p_workspace_id: string }
        Returns: {
          open_deals: number
          open_value: number
          weighted_value: number
          won_deals: number
          won_value: number
        }[]
      }
      crm_reconcile_reporting: {
        Args: { p_from_day: string; p_to_day: string; p_workspace_id: string }
        Returns: {
          aggregate_value: number
          day: string
          metric: string
          raw_value: number
        }[]
      }
      crm_record_collision_override: {
        Args: {
          p_actor_id: string
          p_contact_id: string
          p_reason?: string
          p_workspace_id: string
        }
        Returns: string
      }
      crm_rollup_activity_metrics: {
        Args: { p_from_day: string; p_to_day: string; p_workspace_id: string }
        Returns: number
      }
      crm_undo_batch: {
        Args: { p_batch_id: string; p_workspace_id: string }
        Returns: {
          contacts_deleted: number
          memberships_removed: number
        }[]
      }
      crm_win_rates: {
        Args: { p_from_day: string; p_to_day: string; p_workspace_id: string }
        Returns: {
          lost_deals: number
          owner_user_id: string
          win_rate: number
          won_deals: number
          won_value: number
        }[]
      }
      disconnect_integration: {
        Args: { p_provider: string; p_user_id: string }
        Returns: boolean
      }
      email_account_volume: {
        Args: { p_account_id: string; p_since: string }
        Returns: {
          bounced: number
          complained: number
          failed: number
          sent: number
        }[]
      }
      email_batch_funnel: {
        Args: { p_batch_id: string; p_workspace_id: string }
        Returns: {
          bounced: number
          contacts: number
          delivered: number
          enrolled: number
          replied: number
          sent: number
          unsubscribed: number
          with_email: number
        }[]
      }
      email_campaign_report: {
        Args: { p_campaign_id: string }
        Returns: {
          auto_replied: number
          bounce_rate: number
          bounced: number
          complaints: number
          delivered: number
          eligible: number
          recipients: number
          replied: number
          reply_rate: number
          sent: number
          still_active: number
          stopped_replied: number
          stopped_unsub: number
          unsubscribed: number
        }[]
      }
      email_contact_timeline: {
        Args: { p_contact_id: string; p_limit?: number; p_workspace_id: string }
        Returns: {
          campaign_id: string
          detail: string
          kind: string
          message_id: string
          occurred_at: string
          subject: string
        }[]
      }
      email_domain_health: {
        Args: { p_workspace_id: string }
        Returns: {
          average_score: number
          blocked: number
          domain: string
          mailboxes: number
          ready: number
          worst_score: number
          worst_state: Database["public"]["Enums"]["email_account_status"]
        }[]
      }
      email_mailbox_report: {
        Args: { p_from_day: string; p_to_day: string; p_workspace_id: string }
        Returns: {
          account_id: string
          bounce_rate: number
          bounced: number
          delivered: number
          display_name: string
          failed: number
          from_domain: string
          from_email: string
          health_score: number
          last_healthy_send: string
          needs_verification: number
          queued: number
          replied: number
          sent: number
          status: Database["public"]["Enums"]["email_account_status"]
        }[]
      }
      email_sent_today: {
        Args: { p_account_id: string; p_timezone?: string }
        Returns: number
      }
      enqueue_job: { Args: { p_job_id: string }; Returns: undefined }
      enqueue_research_run: { Args: { p_run_id: string }; Returns: undefined }
      expired_export_paths: {
        Args: { p_limit?: number }
        Returns: {
          export_storage_path: string
          job_id: string
          user_id: string
        }[]
      }
      fastspring_subscription_grants_access: {
        Args: { p_active: boolean; p_state: string }
        Returns: boolean
      }
      finalize_upload_job: {
        Args: { p_job_id: string; p_user_id: string }
        Returns: string
      }
      flow_check_loop_protection: {
        Args: { p_chain_depth: number; p_contact_id: string; p_flow_id: string }
        Returns: string
      }
      flow_claim_step: {
        Args: {
          p_input?: Json
          p_run_id: string
          p_step_id: string
          p_step_type: string
          p_workspace_id: string
        }
        Returns: boolean
      }
      flow_publish: {
        Args: {
          p_created_by?: string
          p_definition: Json
          p_flow_id: string
          p_workspace_id: string
        }
        Returns: string
      }
      generate_referral_code: { Args: never; Returns: string }
      grant_entitlement: {
        Args: {
          p_duration_days?: number
          p_granted_by?: string
          p_plan_id: string
          p_provider?: string
          p_provider_ref?: string
          p_reason?: string
          p_user_id: string
        }
        Returns: string
      }
      grant_fastspring_period_credits: {
        Args: { p_event_id: string; p_plan_key: string; p_user_id: string }
        Returns: number
      }
      granted_credits: {
        Args: { p_period_start: string; p_user_id: string }
        Returns: number
      }
      hubble_refund_credits: {
        Args: { p_amount: number; p_period_start?: string; p_user_id: string }
        Returns: number
      }
      hubble_spend_credits: {
        Args: {
          p_amount?: number
          p_period_end?: string
          p_period_start?: string
          p_user_id: string
        }
        Returns: {
          allowance: number
          outcome: Database["public"]["Enums"]["credit_spend_outcome"]
          remaining: number
          used: number
        }[]
      }
      increment_usage: {
        Args: {
          p_by?: number
          p_metric: string
          p_period_end: string
          p_period_start: string
          p_user_id: string
        }
        Returns: number
      }
      is_admin: { Args: never; Returns: boolean }
      is_workspace_member: {
        Args: { p_workspace_id: string }
        Returns: boolean
      }
      lead_credit_cost: {
        Args: { p_lead_count: number; p_leads_per_credit: number }
        Returns: number
      }
      link_leads_to_companies: {
        Args: { p_leads: Json; p_user_id: string }
        Returns: {
          company_id: string
          lead_id: string
          match_strategy: string
        }[]
      }
      merge_lead_enrichment: {
        Args: { p_enrichment: Json; p_lead_ids: string[]; p_user_id: string }
        Returns: number
      }
      paddle_subscription_grants_access: {
        Args: { p_status: string }
        Returns: boolean
      }
      purge_expired_evidence: {
        Args: { p_older_than_days?: number }
        Returns: number
      }
      purge_job_leads: {
        Args: { p_job_id: string; p_user_id: string }
        Returns: number
      }
      reap_expired_email_claims: { Args: never; Returns: number }
      reap_orphaned_uploads: {
        Args: { p_older_than_minutes?: number }
        Returns: {
          enqueued: number
          failed: number
        }[]
      }
      reap_stale_jobs: { Args: { p_timeout_seconds?: number }; Returns: number }
      reap_stale_research_runs: {
        Args: { p_timeout_seconds?: number }
        Returns: number
      }
      reconcile_fastspring_entitlement: {
        Args: { p_subscription_id: string }
        Returns: undefined
      }
      reconcile_paddle_entitlement: {
        Args: { p_subscription_id: string }
        Returns: undefined
      }
      record_email_event: {
        Args: {
          p_campaign_id?: string
          p_contact_id?: string
          p_email: string
          p_enrollment_id?: string
          p_message_id?: string
          p_metadata?: Json
          p_occurred_at?: string
          p_provider_event_id?: string
          p_type: Database["public"]["Enums"]["email_event_type"]
          p_workspace_id: string
        }
        Returns: boolean
      }
      record_meeting_event: {
        Args: {
          p_cancel_reason?: string
          p_contact_id?: string
          p_delivery_id?: string
          p_ends_at?: string
          p_invitee_email: string
          p_invitee_name?: string
          p_join_url?: string
          p_metadata?: Json
          p_owner_user_id?: string
          p_provider: string
          p_provider_event_id: string
          p_scheduled_at: string
          p_title?: string
          p_type: Database["public"]["Enums"]["meeting_event_type"]
          p_workspace_id: string
        }
        Returns: {
          booking_id: string
          is_new: boolean
          was_matched: boolean
        }[]
      }
      record_referral: {
        Args: { p_code: string; p_referred_user_id: string }
        Returns: string
      }
      redeem_invitation_code: {
        Args: { p_code: string; p_user_id: string }
        Returns: string
      }
      redeem_workspace_invitation: {
        Args: {
          p_member_limit?: number
          p_token_hash: string
          p_user_id: string
        }
        Returns: string
      }
      referral_summary: {
        Args: { p_user_id: string }
        Returns: {
          code: string
          credits_earned: number
          pending: number
          rewarded: number
        }[]
      }
      release_salesforce_token_refresh: {
        Args: {
          p_connection_id: string
          p_refresh_claim: string
          p_user_id: string
        }
        Returns: boolean
      }
      release_signup_ip: {
        Args: { p_ip_hash: string; p_token_hash: string }
        Returns: boolean
      }
      request_subscription_cancellation: {
        Args: { p_user_id: string }
        Returns: {
          ends_at: string
          status: string
        }[]
      }
      reserve_signup_ip: {
        Args: {
          p_ip_hash: string
          p_reservation_seconds?: number
          p_token_hash: string
        }
        Returns: boolean
      }
      resolve_fastspring_user: {
        Args: { p_account_id: string; p_email?: string; p_tags: Json }
        Returns: string
      }
      resolve_paddle_user: {
        Args: { p_custom_data: Json; p_customer_id: string; p_email?: string }
        Returns: string
      }
      resume_subscription: { Args: { p_user_id: string }; Returns: string }
      revoke_entitlement: {
        Args: { p_reason?: string; p_revoked_by?: string; p_user_id: string }
        Returns: undefined
      }
      revoke_extension_device: {
        Args: { p_actor_id?: string; p_device_id: string; p_user_id: string }
        Returns: boolean
      }
      reward_pending_referral: {
        Args: { p_amount: number; p_referred_user_id: string }
        Returns: string
      }
      roll_capture_totals: {
        Args: {
          p_error?: string
          p_job_id: string
          p_leads_found: number
          p_leads_kept: number
          p_page_id: string
          p_status: Database["public"]["Enums"]["capture_page_status"]
          p_user_id: string
        }
        Returns: undefined
      }
      save_clay_connection: {
        Args: {
          p_account_label: string
          p_encrypted_payload: string
          p_user_id: string
        }
        Returns: string
      }
      save_ghl_connection: {
        Args: {
          p_encrypted_payload: string
          p_location_id: string
          p_location_name: string
          p_user_id: string
        }
        Returns: string
      }
      save_google_connection: {
        Args: {
          p_encrypted_payload: string
          p_external_account_email: string
          p_external_account_id: string
          p_external_account_name: string
          p_scopes: string[]
          p_token_expires_at: string
          p_user_id: string
        }
        Returns: string
      }
      save_hubspot_connection: {
        Args: {
          p_encrypted_payload: string
          p_external_account_id: string
          p_external_account_name: string
          p_scopes: string[]
          p_token_expires_at: string
          p_user_id: string
        }
        Returns: string
      }
      save_salesforce_connection: {
        Args: {
          p_encrypted_payload: string
          p_external_account_id: string
          p_external_account_name: string
          p_scopes: string[]
          p_token_expires_at: string
          p_user_id: string
        }
        Returns: string
      }
      set_user_suspension: {
        Args: { p_admin_id: string; p_suspend: boolean; p_user_id: string }
        Returns: undefined
      }
      stop_enrollments_for_email: {
        Args: {
          p_campaign_id?: string
          p_email: string
          p_reason: Database["public"]["Enums"]["email_stop_reason"]
          p_workspace_id: string
        }
        Returns: number
      }
      sweep_rate_limits: { Args: never; Returns: number }
      sweep_signup_ip_reservations: { Args: never; Returns: number }
      sync_fastspring_account: {
        Args: {
          p_account_id: string
          p_company: string
          p_country: string
          p_email: string
          p_event_id: string
          p_event_type: string
          p_language: string
          p_name: string
          p_occurred_at: string
          p_tags: Json
        }
        Returns: boolean
      }
      sync_fastspring_charge: {
        Args: {
          p_account_id: string
          p_charge_id: string
          p_currency: string
          p_decline_reason: string
          p_email: string
          p_event_id: string
          p_event_type: string
          p_occurred_at: string
          p_plan_key: string
          p_product_path: string
          p_status: string
          p_subscription_id: string
          p_tags: Json
          p_total: number
        }
        Returns: Json
      }
      sync_fastspring_order: {
        Args: {
          p_account_id: string
          p_completed_at: string
          p_currency: string
          p_email: string
          p_event_id: string
          p_event_type: string
          p_live: boolean
          p_occurred_at: string
          p_order_id: string
          p_plan_key: string
          p_product_path: string
          p_reference: string
          p_subscription_id: string
          p_tags: Json
          p_total: number
        }
        Returns: Json
      }
      sync_fastspring_subscription: {
        Args: {
          p_account_id: string
          p_active: boolean
          p_auto_renew: boolean
          p_begin_at: string
          p_billing_interval: string
          p_canceled_at: string
          p_currency: string
          p_deactivated_at: string
          p_email: string
          p_event_id: string
          p_event_type: string
          p_next_charge_at: string
          p_occurred_at: string
          p_plan_key: string
          p_price: number
          p_product_path: string
          p_state: string
          p_subscription_id: string
          p_tags: Json
        }
        Returns: boolean
      }
      sync_paddle_customer: {
        Args: {
          p_custom_data: Json
          p_customer_id: string
          p_email: string
          p_event_id: string
          p_event_type: string
          p_marketing_consent: boolean
          p_name: string
          p_occurred_at: string
          p_paddle_created_at: string
          p_paddle_updated_at: string
          p_status: string
        }
        Returns: boolean
      }
      sync_paddle_subscription: {
        Args: {
          p_canceled_at: string
          p_current_period_end: string
          p_current_period_start: string
          p_custom_data: Json
          p_customer_id: string
          p_event_id: string
          p_event_type: string
          p_occurred_at: string
          p_paused_at: string
          p_plan_key: string
          p_price_id: string
          p_product_id: string
          p_scheduled_change_action: string
          p_scheduled_change_at: string
          p_status: string
          p_subscription_id: string
        }
        Returns: boolean
      }
      sync_paddle_transaction: {
        Args: {
          p_billed_at: string
          p_currency_code: string
          p_custom_data: Json
          p_customer_id: string
          p_event_id: string
          p_event_type: string
          p_occurred_at: string
          p_price_id: string
          p_product_id: string
          p_status: string
          p_subscription_id: string
          p_total: string
          p_transaction_id: string
        }
        Returns: boolean
      }
      update_google_tokens: {
        Args: {
          p_connection_id: string
          p_encrypted_payload: string
          p_expected_encrypted_payload: string
          p_scopes: string[]
          p_token_expires_at: string
          p_user_id: string
        }
        Returns: boolean
      }
      update_hubspot_tokens: {
        Args: {
          p_connection_id: string
          p_encrypted_payload: string
          p_expected_encrypted_payload: string
          p_scopes: string[]
          p_token_expires_at: string
          p_user_id: string
        }
        Returns: boolean
      }
      update_salesforce_tokens: {
        Args: {
          p_connection_id: string
          p_encrypted_payload: string
          p_expected_encrypted_payload: string
          p_refresh_claim: string
          p_scopes: string[]
          p_token_expires_at: string
          p_user_id: string
        }
        Returns: boolean
      }
      upsert_companies: {
        Args: { p_companies: Json; p_user_id: string }
        Returns: {
          company_id: string
          created: boolean
          match_strategy: string
        }[]
      }
      workspace_role_of: {
        Args: { p_workspace_id: string }
        Returns: Database["public"]["Enums"]["workspace_role"]
      }
    }
    Enums: {
      access_request_status:
        | "pending"
        | "approved"
        | "rejected"
        | "expired"
        | "suspended"
      access_request_type:
        | "payment"
        | "sales_call"
        | "manual_approval"
        | "trial"
        | "invitation"
      capture_page_status:
        | "received"
        | "queued"
        | "processed"
        | "duplicate"
        | "failed"
      capture_session_status: "active" | "completed" | "abandoned"
      credit_spend_outcome: "spent" | "unlimited" | "exhausted"
      crm_activity_channel:
        | "linkedin"
        | "email"
        | "phone"
        | "meeting"
        | "manual"
        | "system"
      crm_activity_type:
        | "ENGAGEMENT"
        | "OPENER_SENT"
        | "PERSONALIZED_DM"
        | "REPLY_RECEIVED"
        | "FOLLOW_UP"
        | "EMAIL_SENT"
        | "EMAIL_REPLIED"
        | "EMAIL_BOUNCED"
        | "EMAIL_UNSUBSCRIBED"
        | "CALL_BOOKED"
        | "CALL_HELD"
        | "CALL_NO_SHOW"
        | "CONTACT_CREATED"
        | "OWNER_ASSIGNED"
        | "TASK_COMPLETED"
        | "NOTE_ADDED"
        | "STAGE_CHANGED"
        | "OPPORTUNITY_WON"
        | "OPPORTUNITY_LOST"
        | "QUALIFIED"
        | "MERGED"
        | "COLLISION_OVERRIDE"
      crm_collision_mode: "off" | "warn" | "require_approval"
      crm_custom_field_entity: "contact" | "company" | "opportunity"
      crm_custom_field_type:
        | "text"
        | "number"
        | "boolean"
        | "date"
        | "url"
        | "email"
        | "select"
        | "multi_select"
      crm_opportunity_status: "open" | "won" | "lost"
      crm_reassignment_status: "pending" | "approved" | "declined" | "withdrawn"
      crm_record_source:
        | "lead_engine"
        | "csv_import"
        | "manual"
        | "api"
        | "flow"
      crm_stage_kind: "open" | "won" | "lost"
      crm_task_status: "open" | "completed" | "cancelled"
      dedupe_mode: "keep_all" | "remove_exact" | "remove_likely" | "review"
      dedupe_strategy:
        | "linkedin_url_canonical"
        | "salesnav_id"
        | "name_company"
        | "name_title_company"
        | "row_hash"
      email_account_scope: "personal" | "workspace"
      email_account_status:
        | "not_configured"
        | "authentication_required"
        | "ramping"
        | "ready"
        | "warning"
        | "throttled"
        | "paused"
        | "disconnected"
        | "error"
      email_campaign_status:
        | "draft"
        | "scheduled"
        | "running"
        | "paused"
        | "stopped"
        | "completed"
      email_campaign_type:
        | "sales_sequence"
        | "marketing_broadcast"
        | "flow_driven"
        | "manual"
      email_check_status:
        | "pass"
        | "warn"
        | "fail"
        | "unknown"
        | "not_applicable"
      email_enrollment_status: "active" | "paused" | "completed" | "stopped"
      email_event_type:
        | "queued"
        | "sent"
        | "delivered"
        | "replied"
        | "auto_replied"
        | "bounced"
        | "failed"
        | "unsubscribed"
        | "complaint"
        | "opened"
        | "clicked"
      email_message_status:
        | "queued"
        | "sending"
        | "sent"
        | "failed"
        | "cancelled"
        | "needs_verification"
        | "suppressed"
      email_provider: "gmail" | "microsoft" | "smtp"
      email_stop_reason:
        | "replied"
        | "unsubscribed"
        | "bounced"
        | "complained"
        | "suppressed"
        | "manual"
        | "campaign_stopped"
        | "goal_met"
      email_suppression_reason:
        | "unsubscribed"
        | "hard_bounce"
        | "complaint"
        | "manual"
        | "invalid_address"
      export_destination_kind: "device" | "google_drive" | "onedrive"
      file_status: "pending" | "processing" | "processed" | "failed"
      flow_run_status:
        | "running"
        | "waiting"
        | "completed"
        | "failed"
        | "halted"
        | "cancelled"
      flow_status: "draft" | "published" | "paused" | "archived"
      flow_step_status:
        | "pending"
        | "running"
        | "succeeded"
        | "failed"
        | "skipped"
      job_status:
        | "uploaded"
        | "queued"
        | "processing"
        | "completed"
        | "partially_completed"
        | "failed"
        | "cancelled"
      meeting_event_type:
        | "booked"
        | "cancelled"
        | "rescheduled"
        | "no_show"
        | "completed"
      meeting_status: "scheduled" | "cancelled" | "completed" | "no_show"
      plan_key: "trial" | "starter" | "professional" | "agency" | "custom"
      queue_status: "pending" | "claimed" | "done" | "failed"
      referral_status: "pending" | "rewarded" | "void"
      subscription_status: "active" | "past_due" | "cancelled" | "expired"
      user_role:
        | "registered_user"
        | "pending_user"
        | "approved_user"
        | "subscriber"
        | "admin"
        | "suspended_user"
      workspace_role: "owner" | "admin" | "manager" | "setter" | "viewer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      access_request_status: [
        "pending",
        "approved",
        "rejected",
        "expired",
        "suspended",
      ],
      access_request_type: [
        "payment",
        "sales_call",
        "manual_approval",
        "trial",
        "invitation",
      ],
      capture_page_status: [
        "received",
        "queued",
        "processed",
        "duplicate",
        "failed",
      ],
      capture_session_status: ["active", "completed", "abandoned"],
      credit_spend_outcome: ["spent", "unlimited", "exhausted"],
      crm_activity_channel: [
        "linkedin",
        "email",
        "phone",
        "meeting",
        "manual",
        "system",
      ],
      crm_activity_type: [
        "ENGAGEMENT",
        "OPENER_SENT",
        "PERSONALIZED_DM",
        "REPLY_RECEIVED",
        "FOLLOW_UP",
        "EMAIL_SENT",
        "EMAIL_REPLIED",
        "EMAIL_BOUNCED",
        "EMAIL_UNSUBSCRIBED",
        "CALL_BOOKED",
        "CALL_HELD",
        "CALL_NO_SHOW",
        "CONTACT_CREATED",
        "OWNER_ASSIGNED",
        "TASK_COMPLETED",
        "NOTE_ADDED",
        "STAGE_CHANGED",
        "OPPORTUNITY_WON",
        "OPPORTUNITY_LOST",
        "QUALIFIED",
        "MERGED",
        "COLLISION_OVERRIDE",
      ],
      crm_collision_mode: ["off", "warn", "require_approval"],
      crm_custom_field_entity: ["contact", "company", "opportunity"],
      crm_custom_field_type: [
        "text",
        "number",
        "boolean",
        "date",
        "url",
        "email",
        "select",
        "multi_select",
      ],
      crm_opportunity_status: ["open", "won", "lost"],
      crm_reassignment_status: ["pending", "approved", "declined", "withdrawn"],
      crm_record_source: ["lead_engine", "csv_import", "manual", "api", "flow"],
      crm_stage_kind: ["open", "won", "lost"],
      crm_task_status: ["open", "completed", "cancelled"],
      dedupe_mode: ["keep_all", "remove_exact", "remove_likely", "review"],
      dedupe_strategy: [
        "linkedin_url_canonical",
        "salesnav_id",
        "name_company",
        "name_title_company",
        "row_hash",
      ],
      email_account_scope: ["personal", "workspace"],
      email_account_status: [
        "not_configured",
        "authentication_required",
        "ramping",
        "ready",
        "warning",
        "throttled",
        "paused",
        "disconnected",
        "error",
      ],
      email_campaign_status: [
        "draft",
        "scheduled",
        "running",
        "paused",
        "stopped",
        "completed",
      ],
      email_campaign_type: [
        "sales_sequence",
        "marketing_broadcast",
        "flow_driven",
        "manual",
      ],
      email_check_status: ["pass", "warn", "fail", "unknown", "not_applicable"],
      email_enrollment_status: ["active", "paused", "completed", "stopped"],
      email_event_type: [
        "queued",
        "sent",
        "delivered",
        "replied",
        "auto_replied",
        "bounced",
        "failed",
        "unsubscribed",
        "complaint",
        "opened",
        "clicked",
      ],
      email_message_status: [
        "queued",
        "sending",
        "sent",
        "failed",
        "cancelled",
        "needs_verification",
        "suppressed",
      ],
      email_provider: ["gmail", "microsoft", "smtp"],
      email_stop_reason: [
        "replied",
        "unsubscribed",
        "bounced",
        "complained",
        "suppressed",
        "manual",
        "campaign_stopped",
        "goal_met",
      ],
      email_suppression_reason: [
        "unsubscribed",
        "hard_bounce",
        "complaint",
        "manual",
        "invalid_address",
      ],
      export_destination_kind: ["device", "google_drive", "onedrive"],
      file_status: ["pending", "processing", "processed", "failed"],
      flow_run_status: [
        "running",
        "waiting",
        "completed",
        "failed",
        "halted",
        "cancelled",
      ],
      flow_status: ["draft", "published", "paused", "archived"],
      flow_step_status: [
        "pending",
        "running",
        "succeeded",
        "failed",
        "skipped",
      ],
      job_status: [
        "uploaded",
        "queued",
        "processing",
        "completed",
        "partially_completed",
        "failed",
        "cancelled",
      ],
      meeting_event_type: [
        "booked",
        "cancelled",
        "rescheduled",
        "no_show",
        "completed",
      ],
      meeting_status: ["scheduled", "cancelled", "completed", "no_show"],
      plan_key: ["trial", "starter", "professional", "agency", "custom"],
      queue_status: ["pending", "claimed", "done", "failed"],
      referral_status: ["pending", "rewarded", "void"],
      subscription_status: ["active", "past_due", "cancelled", "expired"],
      user_role: [
        "registered_user",
        "pending_user",
        "approved_user",
        "subscriber",
        "admin",
        "suspended_user",
      ],
      workspace_role: ["owner", "admin", "manager", "setter", "viewer"],
    },
  },
} as const
