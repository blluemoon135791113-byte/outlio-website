import 'server-only'

/**
 * Contact enrichment — the only way email and phone ever reach a lead.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THIS SPENDS REAL MONEY, AUTOMATICALLY.                               ║
 * ║                                                                          ║
 * ║  It runs after every extraction, so an account that uploads all day       ║
 * ║  spends all day. Three things bound it, and none of them may be removed  ║
 * ║  without a deliberate decision:                                          ║
 * ║                                                                          ║
 * ║    1. A MONTHLY CAP from `plans.limits.contact_enrichments_per_month`.   ║
 * ║       Read at runtime, never hardcoded (CLAUDE.md).                      ║
 * ║    2. `contact_enriched_at` — a lead is looked up ONCE. Without it a      ║
 * ║       re-run pays again for every lead that had no email the first time. ║
 * ║    3. A per-run ceiling, so one enormous upload cannot drain a month.    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Email and phone are NOT on a Sales Navigator page — a real saved page carries
 * zero addresses and zero `tel:` links. This file is the entire reason those
 * columns are ever non-empty.
 */
import { apolloEmailProvider } from '@/lib/intelligence/providers/apollo'
import { prospeoEmailProvider, prospeoPhoneProvider } from '@/lib/intelligence/providers/prospeo'
import {
  eraseProviderType,
  type AnyIntelligenceProvider,
  type NormalizedEvidence,
  type PersonEntity,
  type ResearchTask,
} from '@/lib/intelligence/types'
import { getPlanById } from '@/lib/limits/plans'
import { createAdminClient } from '@/lib/supabase/admin'

/** Leads looked up in one pass. A single upload must not drain the month. */
const PER_RUN_CEILING = 200

/** Concurrent lookups. Kept low: these are metered third-party APIs. */
const CONCURRENCY = 3

export type EnrichOutcome = {
  attempted: number
  emailsFound: number
  phonesFound: number
  /** Leads skipped because the monthly cap was already reached. */
  skippedForCap: number
}

type LeadRow = {
  id: string
  full_name: string | null
  linkedin_url: string | null
  job_title: string | null
  company_name: string | null
  company_website_url: string | null
  company_id: string | null
}

/** Pulls a single field out of a provider's normalized evidence. */
function readField(evidence: readonly NormalizedEvidence[], field: string): string | null {
  const found = evidence.find((item) => item.field === field)
  if (!found) return null

  for (const key of ['email', 'phone', 'status', 'value']) {
    const value = (found.value as Record<string, unknown>)[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

/**
 * How many lookups this account may still make this month.
 *
 * Counts `contact_enriched_at` rather than a usage table, so the number can
 * never drift from what actually happened. `null` from the plan means genuinely
 * unlimited; an absent key defaults to a safe cap in `planLimitsSchema`.
 */
async function remainingThisMonth(userId: string): Promise<number> {
  const supabase = createAdminClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('plan_id')
    .eq('id', userId)
    .maybeSingle()

  const plan = profile?.plan_id ? await getPlanById(profile.plan_id) : null
  const cap = plan?.limits.contact_enrichments_per_month ?? 250

  if (cap === null) return Number.POSITIVE_INFINITY

  const since = new Date()
  since.setUTCDate(1)
  since.setUTCHours(0, 0, 0, 0)

  const { count } = await supabase
    .from('extracted_leads')
    .select('id', { count: 'exact', head: true })
    // Service role bypasses RLS — scoping by user_id is mandatory.
    .eq('user_id', userId)
    .gte('contact_enriched_at', since.toISOString())

  return Math.max(0, cap - (count ?? 0))
}

/**
 * Looks up contact details for a job's leads.
 *
 * ⚠️ NEVER THROWS FOR A PROVIDER PROBLEM. This runs after a successful
 * extraction; an enrichment outage must not make a completed extraction look
 * failed. Every lead is marked `contact_enriched_at` whether or not anything was
 * found, because "looked and found nothing" is a fact worth recording — without
 * it the same empty lead is paid for on every subsequent run.
 */
export async function enrichJobContacts(
  jobId: string,
  userId: string,
): Promise<EnrichOutcome> {
  const supabase = createAdminClient()
  const outcome: EnrichOutcome = {
    attempted: 0,
    emailsFound: 0,
    phonesFound: 0,
    skippedForCap: 0,
  }

  const { data } = await supabase
    .from('extracted_leads')
    .select('id, full_name, linkedin_url, job_title, company_name, company_website_url, company_id')
    .eq('user_id', userId)
    .eq('extraction_job_id', jobId)
    .eq('is_duplicate', false)
    // Once only. This is what stops a re-run re-paying for every miss.
    .is('contact_enriched_at', null)
    .limit(PER_RUN_CEILING)

  const leads = (data ?? []) as LeadRow[]
  if (leads.length === 0) return outcome

  const budget = await remainingThisMonth(userId)
  if (budget <= 0) {
    outcome.skippedForCap = leads.length
    return outcome
  }

  const affordable = leads.slice(0, Math.min(leads.length, budget))
  outcome.skippedForCap = leads.length - affordable.length

  /*
   * Type-erased so the three can sit in one list: `IntelligenceProvider<T>` is
   * invariant in T, and Prospeo's and Apollo's outputs differ. `run` pairs
   * execute+normalize behind the erased contract.
   */
  const providers: AnyIntelligenceProvider[] = [
    eraseProviderType(prospeoEmailProvider),
    eraseProviderType(apolloEmailProvider),
    eraseProviderType(prospeoPhoneProvider),
  ]

  const runOne = async (lead: LeadRow) => {
    const entity: PersonEntity = {
      type: 'person',
      id: lead.id,
      fullName: lead.full_name,
      linkedinUrl: lead.linkedin_url,
      jobTitle: lead.job_title,
      companyName: lead.company_name,
      companyDomain: lead.company_website_url,
      companyId: lead.company_id,
    }

    const patch: Record<string, string | null> = {}

    for (const provider of providers) {
      // Stop the moment we have what this lead needs — the waterfall exists to
      // avoid paying a second vendor for an answer already in hand.
      const needsEmail = !patch.work_email
      const needsPhone = !patch.mobile_phone
      if (!needsEmail && !needsPhone) break

      const task: ResearchTask = {
        id: `contact:${lead.id}`,
        category: provider.category,
        entity,
        fields: provider.category === 'contact_phone' ? ['mobile_phone'] : ['work_email'],
      }

      if (!provider.canHandle(task)) continue

      try {
        const evidence = await provider.run(task)

        patch.work_email = patch.work_email ?? readField(evidence, 'work_email')
        patch.email_status = patch.email_status ?? readField(evidence, 'email_status')
        patch.mobile_phone = patch.mobile_phone ?? readField(evidence, 'mobile_phone')
        patch.phone_status = patch.phone_status ?? readField(evidence, 'phone_status')
      } catch {
        // One vendor being down is not a reason to fail the lead, or the run.
      }
    }

    await supabase
      .from('extracted_leads')
      .update({
        work_email: patch.work_email ?? null,
        email_status: patch.email_status ?? null,
        mobile_phone: patch.mobile_phone ?? null,
        phone_status: patch.phone_status ?? null,
        // Stamped either way — see the note above.
        contact_enriched_at: new Date().toISOString(),
      })
      .eq('id', lead.id)
      .eq('user_id', userId)

    outcome.attempted += 1
    if (patch.work_email) outcome.emailsFound += 1
    if (patch.mobile_phone) outcome.phonesFound += 1
  }

  // Small fixed concurrency rather than a burst: these are metered APIs, and
  // the fastest way to get a key throttled is to hit it in parallel.
  for (let index = 0; index < affordable.length; index += CONCURRENCY) {
    await Promise.all(affordable.slice(index, index + CONCURRENCY).map(runOne))
  }

  return outcome
}
