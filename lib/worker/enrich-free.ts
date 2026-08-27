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

  const leadIds: string[] = []
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
        'work_email',
        'email_status',
        'social_profiles',
      ],
      outputFields: [
        'company_name',
        'company_domain',
        'company_linkedin',
        'industry',
        'work_email',
        'email_status',
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
