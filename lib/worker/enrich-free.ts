import 'server-only'

/**
 * Post-extraction enrichment, from FREE sources only.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THIS PASS SPENDS NOTHING, AND MUST NOT BECOME ABLE TO.               ║
 * ║                                                                          ║
 * ║  It runs automatically after every extraction, so anything metered here  ║
 * ║  would bill on every upload with nobody pressing a button. The registry  ║
 * ║  excludes paid providers unless OUTLIO_ALLOW_PAID_PROVIDERS=true, and    ║
 * ║  this pass steps aside entirely when that flag is on.                    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * The pass routes through Outlio's ORDINARY research pipeline — the same
 * two-phase runner the Intelligence console uses — so contact enrichment
 * (scout: website-published emails; social-scout: bio emails + handle
 * inventories) runs with full evidence, provenance, tool-call telemetry, and
 * cache semantics. SMTP mailbox probing stays OFF here: it is an explicit
 * operator opt-in (SCOUT_SMTP_VERIFY) on a runtime that allows port 25, never
 * a default of an automatic background pass.
 *
 * ⚠️ BOUNDED BY TIME, NOT BY COST. Free providers still take seconds per
 * company; a 2,000-lead upload must not hold the worker for hours. The pass
 * enriches at most CEILING leads per job; the rest remain available to the
 * Intelligence console like any other lead.
 */
import {
  claimAndProcessResearchRun,
  createResearchRun,
} from '@/lib/intelligence/run'
import { mergeRunIntoLeads } from '@/lib/intelligence/merge-store'
import { paidProvidersEnabled } from '@/lib/intelligence/providers'
import { createAdminClient } from '@/lib/supabase/admin'

/** Leads enriched in one automatic pass. Free, but not free of time. */
const LEAD_CEILING = 60

export type FreeEnrichOutcome = {
  leadsConsidered: number
  /** Evidence rows persisted by the research run (domains, emails, socials). */
  evidenceWritten: number
  /** Leads whose enrichment column now carries the run's known values. */
  leadsUpdated: number
  /** True when the pass declined to run because paid providers were enabled. */
  skippedForSafety: boolean
}

/**
 * Enriches a finished extraction's leads through the research pipeline.
 *
 * ⚠️ NEVER THROWS. It runs after a successful extraction, and a provider
 * outage must not make a completed extraction look failed.
 */
export async function enrichJobFree(
  jobId: string,
  userId: string,
  explicitLeadIds?: readonly string[],
): Promise<FreeEnrichOutcome> {
  const outcome: FreeEnrichOutcome = {
    leadsConsidered: 0,
    evidenceWritten: 0,
    leadsUpdated: 0,
    skippedForSafety: false,
  }

  /*
   * If someone has switched paid providers on, this automatic pass steps aside.
   * Enabling them is a decision about deliberate, user-initiated research — not
   * a licence for a background job to bill on every upload.
   */
  if (paidProvidersEnabled()) {
    outcome.skippedForSafety = true
    return outcome
  }

  const supabase = createAdminClient()

  const leadIds: string[] = explicitLeadIds ? [...new Set(explicitLeadIds)] : []
  if (!explicitLeadIds) {
    for (let from = 0; ; from += 1_000) {
      const { data, error } = await supabase
        .from('extracted_leads')
        .select('id')
        // Service role bypasses RLS — scoping by user_id is mandatory.
        .eq('user_id', userId)
        .eq('extraction_job_id', jobId)
        .eq('is_duplicate', false)
        .order('created_at', { ascending: false })
        .range(from, from + 999)
      if (error) return outcome
      if (!data?.length) break
      leadIds.push(...data.map((row) => row.id as string))
      if (data.length < 1_000) break
    }
  }

  if (leadIds.length === 0) return outcome
  const scoped = leadIds.slice(0, LEAD_CEILING)
  outcome.leadsConsidered = scoped.length

  const created = await createResearchRun(userId, {
    queryText: `Automatic enrichment for extraction ${jobId}.`,
    scope: { type: 'lead_ids', leadIds: scoped },
    plan: {
      entityScope: 'companies',
      requiredFields: [
        'company_domain',
        'company_linkedin',
        'industry',
        'company_contact_email',
        'company_contact_phone',
        'work_email',
        'email_status',
        'mobile_phone',
        'phone_status',
        'social_profiles',
      ],
      outputFields: [
        'company_name',
        'company_domain',
        'company_linkedin',
        'industry',
        'company_contact_email',
        'company_contact_phone',
        'work_email',
        'email_status',
        'mobile_phone',
        'phone_status',
        'social_profiles',
      ],
    },
  })
  if (!created.ok || created.status !== 'queued') return outcome

  const processed = await claimAndProcessResearchRun(
    created.runId,
    userId,
    'auto-enrich',
  )
  if (!processed) return outcome

  outcome.evidenceWritten = processed.evidenceWritten

  // ⚠️ EVIDENCE IS NOT EXPORTABLE — the enrichment COLUMN is. The console
  // merges deliberately; an automatic pass must merge automatically, or the
  // rebuilt CSV ships without the columns this run just paid time for.
  // mergeRunIntoLeads merges only KNOWN cells and re-scopes by user.
  const merged = await mergeRunIntoLeads(userId, created.runId)
  if (merged.ok) outcome.leadsUpdated = merged.leadsUpdated

  return outcome
}

/**
 * Enriches account rows that do not necessarily have a recommended person.
 * Company contacts are deliberately stored on `companies`; they never become
 * a guessed personal email or phone number.
 */
export async function enrichAccountCompaniesFree(
  jobId: string,
  userId: string,
  companyIds: readonly string[],
): Promise<FreeEnrichOutcome> {
  const outcome: FreeEnrichOutcome = {
    leadsConsidered: 0,
    evidenceWritten: 0,
    leadsUpdated: 0,
    skippedForSafety: false,
  }
  if (paidProvidersEnabled()) {
    outcome.skippedForSafety = true
    return outcome
  }

  const scoped = [...new Set(companyIds)].slice(0, LEAD_CEILING)
  if (scoped.length === 0) return outcome

  const discovery = await createResearchRun(userId, {
    queryText: `Automatic company enrichment for Account List ${jobId}.`,
    scope: { type: 'company_ids', companyIds: scoped },
    plan: {
      entityScope: 'companies',
      requiredFields: [
        'company_domain',
        'company_linkedin',
        'industry',
      ],
      outputFields: [
        'company_name',
        'company_domain',
        'company_linkedin',
        'industry',
      ],
    },
  })
  if (!discovery.ok || discovery.status !== 'queued') return outcome

  const discovered = await claimAndProcessResearchRun(
    discovery.runId,
    userId,
    'auto-account-discovery',
  )
  if (discovered) outcome.evidenceWritten += discovered.evidenceWritten

  /* A separate run reloads company entities after domain discovery. Keeping
     contacts in the first company-profile task would route against the stale,
     domain-less snapshot and every official-site provider would decline. */
  const contacts = await createResearchRun(userId, {
    queryText: `Automatic company contacts for Account List ${jobId}.`,
    scope: { type: 'company_ids', companyIds: scoped },
    plan: {
      entityScope: 'companies',
      requiredFields: ['company_contact_email', 'company_contact_phone'],
      outputFields: ['company_name', 'company_contact_email', 'company_contact_phone'],
    },
  })
  if (!contacts.ok || contacts.status !== 'queued') return outcome
  const contacted = await claimAndProcessResearchRun(
    contacts.runId,
    userId,
    'auto-account-contacts',
  )
  if (contacted) outcome.evidenceWritten += contacted.evidenceWritten
  return outcome
}
