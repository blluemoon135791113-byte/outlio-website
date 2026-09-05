import 'server-only'

/**
 * Where a contact's values came from — Phase 3.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  PRODUCTION HOLDS 2,294 EVIDENCE ROWS AND NO CRM USER HAS EVER SEEN ONE. ║
 * ║                                                                           ║
 * ║  Every one carries the provider and URL it came from. The contact page    ║
 * ║  shows a value and offers no way to ask where it came from — which is the ║
 * ║  half of CLAUDE.md rule 4 that was never built. Rule 4's purpose is not   ║
 * ║  merely that we avoid fabricating: it is that a stored value can be       ║
 * ║  CHECKED. A citation nobody can reach does not achieve that.              ║
 * ║                                                                           ║
 * ║  ⚠️ THE JOIN CROSSES THE TENANCY SEAM, AND THE DIRECTION IS LOAD-BEARING. ║
 * ║  `research_evidence` is keyed by `user_id`; `crm_contact_emails` by       ║
 * ║  `workspace_id`. This reads the WORKSPACE-scoped rows first and follows   ║
 * ║  their `evidence_id` — so the workspace boundary is the first filter and  ║
 * ║  never a value inherited from another table's row.                        ║
 * ║                                                                           ║
 * ║  `evidence-bridge.ts:102` established that rule for the write path. This  ║
 * ║  is the same rule for the read path, and inverting it here would be a     ║
 * ║  cross-tenant read that looks like an ordinary join.                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import type { TenantScope } from '@/lib/auth/scope'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * How a value came to be here.
 *
 * ⚠️ `entered` AND `unknown` ARE DIFFERENT ANSWERS (DECISION-11). "Somebody
 * typed this" and "we have lost track of where this came from" are not the same
 * statement, and `crm_contacts.source` already distinguishes them. Collapsing
 * both into "unknown" would be a small lie repeated on every hand-entered row.
 */
export type Provenance =
  | { kind: 'researched'; provider: string; url: string | null; retrievedAt: string; confidence: number }
  | { kind: 'entered'; how: 'manual' | 'csv_import' | 'api' | 'flow' }
  | { kind: 'unknown' }

export type CitedValue<T> = T & { provenance: Provenance }

/**
 * ⚠️ A `source_url` IS ATTACKER-INFLUENCED DATA. It comes from a page we
 * fetched, not from us, and it ends up in an `href`. A `javascript:` or `data:`
 * URL there is stored XSS — the value was written once by a crawl and rendered
 * to every user who opens that contact from then on.
 *
 * Anything that is not http(s) becomes null: the provider and timestamp still
 * display, so the citation is degraded rather than lost.
 */
export function safeSourceUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    // Not a URL at all. A provider that stored a description here is not a
    // reason to render something unclickable and confusing.
    return null
  }
}

/** `crm_contacts.source` → what to tell the reader when there is no citation. */
function enteredHow(source: string | null): Provenance {
  switch (source) {
    case 'manual':
    case 'csv_import':
    case 'api':
    case 'flow':
      return { kind: 'entered', how: source }
    /*
     * ⚠️ `lead_engine` FALLS THROUGH TO `unknown` DELIBERATELY. It means the
     * value arrived from research — so if it has no `evidence_id`, the citation
     * genuinely was lost (bridged before 0113). Calling that "entered" would
     * claim a person typed something a crawler found.
     */
    default:
      return { kind: 'unknown' }
  }
}

type EvidenceRow = {
  id: string
  source_provider: string | null
  source_url: string | null
  retrieved_at: string
  confidence: number | null
}

/**
 * Resolve citations for a set of values on one contact.
 *
 * Returns a map from `evidence_id` to its provenance. Values whose
 * `evidence_id` is null, or whose evidence row has since been pruned, are
 * absent from the map — callers fall back to `enteredHow`.
 */
export async function citationsFor(
  scope: TenantScope,
  evidenceIds: string[],
): Promise<Map<string, Provenance>> {
  const out = new Map<string, Provenance>()
  const ids = [...new Set(evidenceIds.filter(Boolean))]
  if (ids.length === 0) return out

  const { data, error } = await createAdminClient()
    .from('research_evidence')
    .select('id, source_provider, source_url, retrieved_at, confidence')
    /*
     * ⚠️ SCOPED BY `user_id` AS WELL AS BY ID, even though the ids came from
     * rows this workspace owns. The service role bypasses RLS, and an
     * `evidence_id` is ultimately a value in a column — if one were ever
     * mis-set, this filter is what stops it resolving to another user's
     * research. Defence in depth on the seam that most needs it.
     */
    .eq('user_id', scope.userId)
    .in('id', ids)

  if (error) throw new Error(`citationsFor failed: ${error.message}`)

  for (const row of (data ?? []) as EvidenceRow[]) {
    out.set(row.id, {
      kind: 'researched',
      provider: row.source_provider ?? 'unnamed source',
      url: safeSourceUrl(row.source_url),
      retrievedAt: row.retrieved_at,
      confidence: row.confidence ?? 0,
    })
  }

  return out
}

/**
 * Attach provenance to each value.
 *
 * ⚠️ EVERY VALUE GETS ONE. There is no "no provenance" branch that renders
 * nothing — CLAUDE.md rule 4 requires a missing value to carry an INDICATOR,
 * and an empty cell reads as "not applicable" rather than "we never found
 * this". `unknown` is a statement; a blank is an absence of one.
 */
export function withProvenance<T extends { evidenceId?: string | null }>(
  values: T[],
  citations: Map<string, Provenance>,
  contactSource: string | null,
): CitedValue<T>[] {
  return values.map((value) => {
    const cited = value.evidenceId ? citations.get(value.evidenceId) : undefined
    return { ...value, provenance: cited ?? enteredHow(contactSource) }
  })
}

/**
 * Company fields whose value lives in a COLUMN, not a child row.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ COMPANIES NEED NO CITATION COLUMN, AND THE REASON IS NOT "IT WOULD BE ║
 * ║  INCONVENIENT".                                                          ║
 * ║                                                                           ║
 * ║  DECISION-10 rejected re-deriving a contact's citation because it meant   ║
 * ║  matching on VALUE — fragile, and silently wrong when a value was         ║
 * ║  observed twice. Companies have a structural link instead:                ║
 * ║                                                                           ║
 * ║      crm_companies.source_company_id → companies.id                       ║
 * ║                                    = research_evidence.entity_id          ║
 * ║                                                                           ║
 * ║  Plus `field`, which names the attribute. That is an exact join, not a    ║
 * ║  guess, so the objection does not apply and a migration would add a       ║
 * ║  column duplicating a link that already exists.                           ║
 * ║                                                                           ║
 * ║  ⚠️ BUT THE COLUMN MAY HAVE BEEN EDITED SINCE. A citation is only honest   ║
 * ║  if the value it justifies is the value on screen — so the observed value ║
 * ║  is COMPARED, and a mismatch reports `unknown` rather than crediting a    ║
 * ║  source for something a person later changed.                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
const COMPANY_FIELD_KEYS: Record<string, string> = {
  // `value_json` is keyed per field, not by a generic `value` — the same trap
  // that made a contact fixture silently produce nothing.
  industry: 'industry',
  employee_count: 'count',
  headquarters: 'headquarters',
}

/** The literal a company evidence row observed for its field, or null. */
function companyLiteral(field: string, valueJson: Record<string, unknown>): string | null {
  const key = COMPANY_FIELD_KEYS[field]
  if (!key) return null
  const raw = valueJson[key]
  if (typeof raw === 'string') return raw.trim() || null
  if (typeof raw === 'number') return String(raw)
  return null
}

/**
 * Provenance for each displayed company field.
 *
 * ⚠️ STARTS FROM THE WORKSPACE-SCOPED ROW, like every other read on this seam.
 * `companies` and `research_evidence` are `user_id`-keyed; `crm_companies` is
 * `workspace_id`-keyed. The caller has already proved the company belongs to
 * this workspace, and `user_id` is filtered again below.
 */
export async function companyCitations(
  scope: TenantScope,
  company: {
    sourceCompanyId: string | null
    source: string | null
    values: Record<string, string | number | null>
  },
): Promise<Record<string, Provenance>> {
  const fields = Object.keys(company.values)
  const fallback = enteredHow(company.source)
  const out: Record<string, Provenance> = Object.fromEntries(fields.map((f) => [f, fallback]))

  if (!company.sourceCompanyId) return out

  const { data, error } = await createAdminClient()
    .from('research_evidence')
    .select('field, value_json, source_provider, source_url, retrieved_at, confidence')
    .eq('user_id', scope.userId)
    .eq('entity_type', 'company')
    .eq('entity_id', company.sourceCompanyId)
    .in('field', fields)
    // Newest first: the freshest observation is the one that produced the
    // stored value, matching the bridge's own ordering.
    .order('retrieved_at', { ascending: false })

  if (error) throw new Error(`companyCitations failed: ${error.message}`)

  const seen = new Set<string>()
  for (const row of data ?? []) {
    if (seen.has(row.field)) continue
    seen.add(row.field)

    const observed = companyLiteral(row.field, (row.value_json ?? {}) as Record<string, unknown>)
    const current = company.values[row.field]

    /*
     * ⚠️ ONLY CITE WHAT MATCHES. If the column was edited after import, the
     * evidence explains a value that is no longer there — and crediting a
     * provider for a person's edit is a fabrication about provenance. Rule 4
     * does not distinguish that from fabricating the value itself.
     */
    if (observed === null || current === null || String(current).trim() !== observed) continue

    out[row.field] = {
      kind: 'researched',
      provider: row.source_provider ?? 'unnamed source',
      url: safeSourceUrl(row.source_url),
      retrievedAt: row.retrieved_at,
      confidence: row.confidence ?? 0,
    }
  }

  return out
}
