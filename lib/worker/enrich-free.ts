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
 * ║  this file asserts that before it runs rather than trusting it.          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ IT CANNOT PRODUCE EMAIL OR PHONE. Neither is on a Sales Navigator page —
 * a real saved page carries zero addresses and zero `tel:` links — and no free
 * source provides verified work contacts. Guessing one from a name and a domain
 * would be fabricating lead data, which CLAUDE.md rule 4 forbids outright. Those
 * columns stay NULL until a paid provider is deliberately enabled.
 *
 * What it CAN do is fill the company gaps the hover card missed, from the free
 * providers: DNS, Wikidata, GDELT, SEC, Companies House, GitHub, Hacker News.
 */
import { buildLiveRegistry, paidProvidersEnabled } from '@/lib/intelligence/providers'
import type { CompanyEntity, ResearchTask } from '@/lib/intelligence/types'
import { createAdminClient } from '@/lib/supabase/admin'

/** Companies looked at in one pass. Free, but not free of time. */
const PER_RUN_CEILING = 60

/** Concurrent lookups. Free APIs still rate-limit, and GDELT paces at 5s. */
const CONCURRENCY = 2

export type FreeEnrichOutcome = {
  companiesConsidered: number
  domainsFound: number
  industriesFound: number
  /** True when the pass declined to run because paid providers were enabled. */
  skippedForSafety: boolean
}

type CompanyRow = {
  id: string
  name: string | null
  domain: string | null
  industry: string | null
}

/**
 * Fills what free sources can about the companies in a finished job.
 *
 * ⚠️ NEVER THROWS. It runs after a successful extraction, and a provider outage
 * must not make a completed extraction look failed.
 */
export async function enrichJobFree(
  jobId: string,
  userId: string,
): Promise<FreeEnrichOutcome> {
  const outcome: FreeEnrichOutcome = {
    companiesConsidered: 0,
    domainsFound: 0,
    industriesFound: 0,
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

  const { data: leadRows } = await supabase
    .from('extracted_leads')
    .select('company_id')
    // Service role bypasses RLS — scoping by user_id is mandatory.
    .eq('user_id', userId)
    .eq('extraction_job_id', jobId)
    .eq('is_duplicate', false)
    .not('company_id', 'is', null)

  const companyIds = [...new Set((leadRows ?? []).map((row) => row.company_id))].filter(
    (id): id is string => Boolean(id),
  )
  if (companyIds.length === 0) return outcome

  const { data: companyRows } = await supabase
    .from('companies')
    .select('id, name, domain, industry')
    .eq('user_id', userId)
    .in('id', companyIds.slice(0, PER_RUN_CEILING))

  // Only companies that are actually missing something. A complete row costs
  // nothing to skip and a provider call to re-confirm.
  const companies = ((companyRows ?? []) as CompanyRow[]).filter(
    (company) => Boolean(company.name) && (!company.domain || !company.industry),
  )

  outcome.companiesConsidered = companies.length
  if (companies.length === 0) return outcome

  const registry = buildLiveRegistry()

  const runOne = async (company: CompanyRow) => {
    const entity: CompanyEntity = {
      type: 'company',
      id: company.id,
      name: company.name,
      domain: company.domain,
      linkedinUrl: null,
    }

    const wanted: Array<{ field: 'company_domain' | 'industry'; category: 'company_profile' }> = []
    if (!company.domain) wanted.push({ field: 'company_domain', category: 'company_profile' })
    if (!company.industry) wanted.push({ field: 'industry', category: 'company_profile' })

    const patch: { domain?: string; industry?: string } = {}

    for (const { field, category } of wanted) {
      const task: ResearchTask = { id: `free:${company.id}:${field}`, category, entity, fields: [field] }

      for (const provider of registry.forTask(task)) {
        try {
          const evidence = await provider.run(task)
          const found = evidence.find((item) => item.field === field)
          if (!found) continue

          const value = found.value as Record<string, unknown>
          const text =
            typeof value.domain === 'string'
              ? value.domain
              : typeof value.industry === 'string'
                ? value.industry
                : null

          if (text) {
            if (field === 'company_domain') patch.domain = text
            else patch.industry = text
            break
          }
        } catch {
          // A free provider being down is not a reason to fail the run.
        }
      }
    }

    if (Object.keys(patch).length === 0) return

    try {
      await supabase
        .from('companies')
        .update(patch)
        .eq('id', company.id)
        .eq('user_id', userId)

      if (patch.domain) outcome.domainsFound += 1
      if (patch.industry) outcome.industriesFound += 1
    } catch {
      // Another company may already own that domain; a unique-index collision
      // is not a reason to fail an extraction that already succeeded.
    }
  }

  for (let index = 0; index < companies.length; index += CONCURRENCY) {
    await Promise.all(companies.slice(index, index + CONCURRENCY).map(runOne))
  }

  return outcome
}
