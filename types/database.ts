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
  job_title: string | null
  company_name: string | null
  company_url: string | null
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

export type Database = {
  public: {
    Tables: {
      plans: TableShape<PlanRow>
      profiles: TableShape<ProfileRow>
      access_requests: TableShape<AccessRequestRow>
      subscriptions: TableShape<SubscriptionRow>
      usage_counters: TableShape<UsageCounterRow>
      invitation_codes: TableShape<InvitationCodeRow>
      extraction_jobs: TableShape<ExtractionJobRow>
      uploaded_files: TableShape<UploadedFileRow>
      extracted_leads: TableShape<ExtractedLeadRow>
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
