/**
 * Database types.
 *
 * Hand-written to match supabase/migrations/*.sql exactly, because the
 * migrations have not yet been applied to a live database.
 *
 * ONCE THE MIGRATIONS ARE APPLIED, REGENERATE THIS FILE:
 *
 *     npm run db:types
 *
 * and commit the result. The generated file is authoritative from that point on.
 */

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
  granted_by: string | null
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

export type Database = {
  public: {
    Tables: {
      extension_devices: TableShape<ExtensionDeviceRow>
      extension_pairings: TableShape<ExtensionPairingRow>
      capture_sessions: TableShape<CaptureSessionRow>
      capture_pages: TableShape<CapturePageRow>
      plans: TableShape<PlanRow>
      profiles: TableShape<ProfileRow>
      access_requests: TableShape<AccessRequestRow>
      subscriptions: TableShape<SubscriptionRow>
      usage_counters: TableShape<UsageCounterRow>
      invitation_codes: TableShape<InvitationCodeRow>
      extraction_jobs: TableShape<ExtractionJobRow>
      uploaded_files: TableShape<UploadedFileRow>
      extracted_leads: TableShape<ExtractedLeadRow>
      companies: TableShape<CompanyRow>
      research_runs: TableShape<ResearchRunRow>
      research_evidence: TableShape<ResearchEvidenceRow>
      research_tool_calls: TableShape<ResearchToolCallRow>
      research_job_queue: TableShape<ResearchJobQueueRow>
      integration_connections: TableShape<IntegrationConnectionRow>
      integration_secrets: TableShape<IntegrationSecretRow>
      integration_oauth_transactions: TableShape<IntegrationOAuthTransactionRow>
      export_jobs: TableShape<ExportJobRow>
      export_job_errors: TableShape<ExportJobErrorRow>
      integration_record_links: TableShape<IntegrationRecordLinkRow>
      job_queue: TableShape<JobQueueRow>
      admin_audit_logs: TableShape<AdminAuditLogRow>
      system_events: TableShape<SystemEventRow>
      rate_limits: TableShape<RateLimitRow>
      signup_ip_claims: TableShape<SignupIpClaimRow>
      signup_device_claims: TableShape<SignupDeviceClaimRow>
      signup_identity_claims: TableShape<SignupIdentityClaimRow>
      lead_keys: TableShape<LeadKeyRow>
    }
    Views: Record<string, never>
    Functions: {
      is_admin: {
        Args: Record<string, never>
        Returns: boolean
      }
      enqueue_research_run: {
        Args: { p_run_id: string }
        Returns: undefined
      }
      claim_research_run: {
        Args: { p_run_id: string; p_user_id: string; p_claimed_by: string }
        Returns: Array<{ research_run_id: string; user_id: string; attempts: number }>
      }
      claim_next_research_run: {
        Args: { p_claimed_by: string }
        Returns: Array<{ research_run_id: string; user_id: string; attempts: number }>
      }
      reap_stale_research_runs: {
        Args: { p_timeout_seconds?: number }
        Returns: number
      }
      purge_expired_evidence: {
        Args: { p_older_than_days?: number }
        Returns: number
      }
      link_leads_to_companies: {
        Args: {
          p_user_id: string
          p_leads: Json
        }
        Returns: Array<{
          lead_id: string
          company_id: string
          match_strategy: CompanyMatchStrategy
        }>
      }
      increment_usage: {
        Args: {
          p_user_id: string
          p_metric: UsageMetric
          p_period_start: string
          p_period_end: string
          p_by?: number
        }
        Returns: number
      }
      save_clay_connection: {
        Args: {
          p_user_id: string
          p_encrypted_payload: string
          p_account_label: string
        }
        Returns: string
      }
      save_hubspot_connection: {
        Args: {
          p_user_id: string
          p_encrypted_payload: string
          p_external_account_id: string
          p_external_account_name: string
          p_scopes: string[]
          p_token_expires_at: string
        }
        Returns: string
      }
      save_google_connection: {
        Args: {
          p_user_id: string
          p_encrypted_payload: string
          p_external_account_id: string
          p_external_account_name: string
          p_external_account_email: string
          p_scopes: string[]
          p_token_expires_at: string
        }
        Returns: string
      }
      update_google_tokens: {
        Args: {
          p_user_id: string
          p_connection_id: string
          p_expected_encrypted_payload: string
          p_encrypted_payload: string
          p_scopes: string[]
          p_token_expires_at: string
        }
        Returns: boolean
      }
      save_ghl_connection: {
        Args: {
          p_user_id: string
          p_encrypted_payload: string
          p_location_id: string
          p_location_name: string
        }
        Returns: string
      }
      update_hubspot_tokens: {
        Args: {
          p_user_id: string
          p_connection_id: string
          p_expected_encrypted_payload: string
          p_encrypted_payload: string
          p_scopes: string[]
          p_token_expires_at: string
        }
        Returns: boolean
      }
      save_salesforce_connection: {
        Args: {
          p_user_id: string
          p_encrypted_payload: string
          p_external_account_id: string
          p_external_account_name: string
          p_scopes: string[]
          p_token_expires_at: string
        }
        Returns: string
      }
      update_salesforce_tokens: {
        Args: {
          p_user_id: string
          p_connection_id: string
          p_expected_encrypted_payload: string
          p_encrypted_payload: string
          p_refresh_claim: string
          p_scopes: string[]
          p_token_expires_at: string
        }
        Returns: boolean
      }
      claim_salesforce_token_refresh: {
        Args: {
          p_user_id: string
          p_connection_id: string
          p_expected_encrypted_payload: string
          p_refresh_claim: string
          p_claim_expires_at: string
        }
        Returns: boolean
      }
      release_salesforce_token_refresh: {
        Args: {
          p_user_id: string
          p_connection_id: string
          p_refresh_claim: string
        }
        Returns: boolean
      }
      disconnect_integration: {
        Args: {
          p_user_id: string
          p_provider: string
        }
        Returns: boolean
      }
      consume_rate_limit: {
        Args: {
          p_bucket: string
          p_subject: string
          p_window_start: string
          p_max_attempts: number
          p_block_seconds: number
        }
        Returns: { attempts: number; blocked_until: string | null }[]
      }
      reserve_signup_ip: {
        Args: {
          p_ip_hash: string
          p_token_hash: string
          p_reservation_seconds?: number
        }
        Returns: boolean
      }
      release_signup_ip: {
        Args: { p_ip_hash: string; p_token_hash: string }
        Returns: boolean
      }
      sweep_signup_ip_reservations: {
        Args: Record<string, never>
        Returns: number
      }
      sweep_rate_limits: {
        Args: Record<string, never>
        Returns: number
      }
      bootstrap_admin: {
        Args: { p_email: string }
        Returns: string
      }
      grant_entitlement: {
        Args: {
          p_user_id: string
          p_plan_id: string
          p_duration_days?: number
          p_granted_by?: string
          p_provider?: string
          p_provider_ref?: string
          p_reason?: string
        }
        /** New subscription id. */
        Returns: string
      }
      revoke_entitlement: {
        Args: {
          p_user_id: string
          p_revoked_by?: string
          p_reason?: string
        }
        Returns: undefined
      }
      redeem_invitation_code: {
        Args: { p_code: string; p_user_id: string }
        /** 'ok' | 'invalid' | 'unavailable' | 'already_active' */
        Returns: string
      }
      enqueue_job: {
        Args: { p_job_id: string }
        Returns: undefined
      }
      finalize_upload_job: {
        Args: { p_job_id: string; p_user_id: string }
        /** 'ok' | 'already_finalized' | 'not_found' | 'invalid_state' | 'no_files' | 'insufficient_credits' */
        Returns: string
      }
      set_user_suspension: {
        Args: { p_user_id: string; p_admin_id: string; p_suspend: boolean }
        Returns: undefined
      }
      claim_next_job: {
        Args: { p_claimed_by: string }
        Returns: { job_id: string; user_id: string; attempts: number }[]
      }
      claim_job: {
        Args: { p_job_id: string; p_user_id: string; p_claimed_by: string }
        Returns: { job_id: string; user_id: string; attempts: number }[]
      }
      reap_stale_jobs: {
        Args: { p_timeout_seconds?: number }
        Returns: number
      }
      reap_orphaned_uploads: {
        Args: { p_older_than_minutes?: number }
        Returns: { enqueued: number; failed: number }[]
      }
      consume_credit: {
        Args: {
          p_user_id: string
          p_amount?: number
          p_period_start?: string
          p_period_end?: string
        }
        /** Remaining balance, or -1 when there were not enough credits. */
        Returns: number
      }
      request_subscription_cancellation: {
        Args: { p_user_id: string }
        /** status: 'ok' | 'no_subscription' | 'not_active' | 'already_scheduled' */
        Returns: { status: string; ends_at: string | null }[]
      }
      resume_subscription: {
        Args: { p_user_id: string }
        /** 'ok' | 'no_subscription' | 'not_scheduled' | 'already_ended' */
        Returns: string
      }
      claim_capture_page: {
        Args: {
          p_session_id: string
          p_user_id: string
          p_content_hash: string
          p_source_url: string | null
          p_page_ident: string | null
        }
        /** 'claimed' | 'duplicate' | 'session_closed' | 'not_found' */
        Returns: { status: string; page_id: string | null }[]
      }
      roll_capture_totals: {
        Args: {
          p_page_id: string
          p_user_id: string
          p_job_id: string | null
          p_leads_found: number
          p_leads_kept: number
          p_status: CapturePageStatus
          p_error?: string | null
        }
        Returns: undefined
      }
      revoke_extension_device: {
        Args: { p_device_id: string; p_user_id: string; p_actor_id?: string | null }
        Returns: boolean
      }
      lead_credit_cost: {
        Args: { p_lead_count: number; p_leads_per_credit: number | null }
        /** Credits one extraction of this size costs. Never below 1. */
        Returns: number
      }
      charge_extraction_leads: {
        Args: { p_job_id: string; p_user_id: string; p_lead_count: number }
        /**
         * Charges a parsed run. `status` is
         * 'ok' | 'already_charged' | 'insufficient_credits' | 'not_found'.
         * On 'insufficient_credits' nothing is spent and `required` is the cost.
         */
        Returns: {
          status: string
          charged: number
          required: number
          credits_left: number
        }[]
      }
      credit_balance: {
        Args: { p_user_id: string }
        /** `allowance` already includes `granted` (referral and other bonuses). */
        Returns: { allowance: number; used: number; remaining: number; granted: number }[]
      }
      record_referral: {
        Args: { p_referred_user_id: string; p_code: string }
        /** 'ok' | 'no_code' | 'unknown_code' | 'self_referral' | 'error' */
        Returns: string
      }
      reward_pending_referral: {
        Args: { p_referred_user_id: string; p_amount: number }
        /** 'ok' | 'no_referral' | 'already_rewarded' | 'invalid_amount' */
        Returns: string
      }
      referral_summary: {
        Args: { p_user_id: string }
        Returns: {
          code: string | null
          pending: number
          rewarded: number
          credits_earned: number
        }[]
      }
      expired_export_paths: {
        Args: { p_limit?: number }
        Returns: { job_id: string; user_id: string; export_storage_path: string }[]
      }
      purge_job_leads: {
        Args: { p_job_id: string; p_user_id: string }
        /** Number of lead rows deleted. */
        Returns: number
      }
    }
    Enums: {
      user_role: UserRole
      access_request_type: AccessRequestType
      access_request_status: AccessRequestStatus
      job_status: JobStatus
      file_status: FileStatus
      queue_status: QueueStatus
      dedupe_mode: DedupeMode
      dedupe_strategy: DedupeStrategy
      plan_key: PlanKey
      subscription_status: SubscriptionStatus
    }
    CompositeTypes: Record<string, never>
  }
}
