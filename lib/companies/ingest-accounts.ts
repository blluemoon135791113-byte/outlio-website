import 'server-only'

/**
 * Ingesting a saved Sales Navigator account list.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS IS A COMPANY-VOLUME FEATURE, NOT LEAD EXTRACTION.                  ║
 * ║                                                                          ║
 * ║  A lead page yields PEOPLE who happen to have employers, and companies   ║
 * ║  appear as a side effect of linking. An account list yields COMPANIES    ║
 * ║  directly, with no person attached — so it does not belong in the lead   ║
 * ║  pipeline, which dedupes by person and exports person rows.              ║
 * ║                                                                          ║
 * ║  It writes to the same `companies` table on purpose. A company found     ║
 * ║  through an account list and the same company found through a lead's     ║
 * ║  employer must be ONE row, or every later count is wrong.                ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import { resolveCompanyIdentity } from '@/lib/companies/normalize'
import type { ParsedAccount } from '@/lib/companies/parse-account-list'
import { createAdminClient } from '@/lib/supabase/admin'

/** Matches `LINK_BATCH_SIZE` in the repository: writes go in a POST body. */
const INGEST_BATCH_SIZE = 500

export type AccountIngestPayload = {
  name: string | null
  normalized_name: string | null
  domain: string | null
  normalized_domain: string | null
  linkedin_url: string | null
  normalized_linkedin_url: string | null
  industry: string | null
}

export type AccountIngestResult = {
  /** Companies created by this ingest. */
  created: number
  /** Rows that resolved to a company already held. */
  matched: number
  /**
   * Rows carrying nothing that identifies a company.
   *
   * ⚠️ REPORTED, NOT SILENTLY DROPPED. "25 rows in, 18 companies out" needs
   * the missing seven accounted for, or the user assumes data loss.
   */
  unidentified: number
}

/**
 * Turns parsed accounts into upsert payloads.
 *
 * PURE, and exported so the mapping is testable without a database — the part
 * most likely to be wrong is identity resolution, not the RPC call.
 *
 * ⚠️ THE SALES NAVIGATOR URL IS PASSED THROUGH UNCHANGED. DO NOT "CONVERT" IT.
 *
 * An earlier version ran it through `publicCompanyUrl()`, turning
 * `/sales/company/38150452` into `/company/38150452` on the theory that the
 * public form is the shared identity. That was wrong, and
 * `normalizeCompanyLinkedInUrl` says why in its own header: a NUMERIC Sales
 * Navigator id cannot be turned into a public SLUG (`/company/acme`) without
 * asking linkedin.com, which rule 1 forbids. The two are deliberately kept as
 * distinct identities that converge when a capture carrying both arrives.
 *
 * So the "conversion" did not unify anything — it invented a THIRD form
 * matching neither the `/sales/company/<id>` rows the lead pipeline writes nor
 * real `/company/<slug>` captures. Measured on live data: it produced a
 * duplicate of a company already held.
 *
 * Passing the URL through lets the normalizer emit
 * `linkedin.com/sales/company/<id>`, which matches what the lead pipeline
 * already stores for the same company.
 */
export function toIngestPayload(accounts: readonly ParsedAccount[]): {
  payload: AccountIngestPayload[]
  unidentified: number
} {
  const payload: AccountIngestPayload[] = []
  let unidentified = 0

  for (const account of accounts) {
    const identity = resolveCompanyIdentity({
      companyName: account.companyName,
      companyLinkedInUrl: account.salesNavUrl,
    })

    if (!identity) {
      unidentified += 1
      continue
    }

    payload.push({
      name: identity.name,
      normalized_name: identity.normalizedName,
      domain: identity.domain,
      normalized_domain: identity.normalizedDomain,
      linkedin_url: identity.linkedinUrl,
      normalized_linkedin_url: identity.normalizedLinkedInUrl,
      industry: account.industry,
    })
  }

  return { payload, unidentified }
}

/** Truncates upstream error text so an HTML error page never reaches a log. */
function concise(message: string): string {
  const first = message.split('\n')[0]?.trim() ?? ''
  const stripped = first.startsWith('<') ? 'upstream returned HTML' : first
  return stripped.length > 160 ? `${stripped.slice(0, 160)}…` : stripped
}

/**
 * Upserts every account in a parsed list.
 *
 * Safe to re-run: the RPC finds the existing company rather than creating a
 * second one. That matters because `after()` retries and the stale-claim
 * reaper can re-run a claim — re-ingesting a list must report "0 created,
 * 25 matched", not duplicate the list.
 */
export async function ingestAccounts(
  userId: string,
  accounts: readonly ParsedAccount[],
): Promise<AccountIngestResult> {
  if (!userId) throw new Error('ingestAccounts: userId is required')

  const { payload, unidentified } = toIngestPayload(accounts)
  if (payload.length === 0) return { created: 0, matched: 0, unidentified }

  const supabase = createAdminClient()
  let created = 0
  let matched = 0

  for (let index = 0; index < payload.length; index += INGEST_BATCH_SIZE) {
    const { data, error } = await supabase.rpc('upsert_companies', {
      p_user_id: userId,
      p_companies: payload.slice(index, index + INGEST_BATCH_SIZE),
    })

    if (error) throw new Error(`ingestAccounts failed: ${concise(error.message)}`)

    for (const row of (data ?? []) as Array<{ created: boolean }>) {
      if (row.created) created += 1
      else matched += 1
    }
  }

  return { created, matched, unidentified }
}
