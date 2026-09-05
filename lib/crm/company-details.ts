import 'server-only'

/**
 * The researched detail a company page had nowhere to put.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  952 OF 1,000 SAMPLED EVIDENCE ROWS ARE COMPANY-LEVEL. Phase 3 surfaced   ║
 * ║  three of their fields — industry, employee_count, headquarters — because ║
 * ║  those are the only ones with a column on `crm_companies`. Funding, tech  ║
 * ║  stack, news, socials, revenue and hiring signals had no home at all.     ║
 * ║                                                                           ║
 * ║  ⚠️ EVERY FIELD HAS ITS OWN `value_json` SHAPE. There is no generic        ║
 * ║  `value` key — `{"round":"Pre seed"}`, `{"detected":[…]}`,                ║
 * ║  `{"articles":[…]}`, `{"profiles":[…]}`. A generic reader returns null    ║
 * ║  for all of them and the section renders empty while the data sits there, ║
 * ║  which is exactly how these rows became invisible in the first place.    ║
 * ║                                                                           ║
 * ║  ⚠️ NOTHING IS INFERRED OR COMBINED ACROSS FIELDS. `funding_amount` and   ║
 * ║  `funding_currency` are separate observations; they are displayed         ║
 * ║  together only when BOTH exist, never with a defaulted currency. CLAUDE.md ║
 * ║  rule 4 forbids inventing the difference away, and "$500,000" from an     ║
 * ║  amount with no currency is an invention.                                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import type { TenantScope } from '@/lib/auth/scope'
import { safeSourceUrl, type Provenance } from '@/lib/crm/provenance'
import { createAdminClient } from '@/lib/supabase/admin'

/** One thing worth showing, with where it came from. */
export type DetailItem = {
  label: string
  /** Plain text, already formatted. */
  text: string | null
  /** Links, when the observation is a set of URLs. */
  links?: { label: string; url: string }[]
  provenance: Provenance
}

export type CompanyDetails = {
  funding: DetailItem[]
  techStack: DetailItem[]
  news: DetailItem[]
  social: DetailItem[]
  other: DetailItem[]
}

export type EvidenceRow = {
  field: string
  value_json: Record<string, unknown>
  source_provider: string | null
  source_url: string | null
  retrieved_at: string
  confidence: number | null
}

function provenanceOf(row: EvidenceRow): Provenance {
  return {
    kind: 'researched',
    provider: row.source_provider ?? 'unnamed source',
    url: safeSourceUrl(row.source_url),
    retrievedAt: row.retrieved_at,
    confidence: row.confidence ?? 0,
  }
}

/** `500000` + `USD` → `$500,000`. Never a currency we did not observe. */
function money(amount: unknown, currency: unknown): string | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null
  if (typeof currency !== 'string' || !currency) {
    // ⚠️ The amount alone, unformatted. Guessing USD would be a fabrication
    // that reads as a fact, and the number is still useful without it.
    return amount.toLocaleString()
  }
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    // An unrecognised currency code is still an observation; show it plainly
    // rather than dropping the amount.
    return `${amount.toLocaleString()} ${currency}`
  }
}

/**
 * Format one evidence row for display, or null when it holds nothing usable.
 *
 * ⚠️ RETURNS NULL RATHER THAN AN EMPTY ITEM. A row whose shape has changed
 * should disappear, not render a label with a blank beside it — a labelled
 * blank reads as "we looked and found nothing", which is a different and
 * stronger claim than "we cannot read this any more".
 */
export function formatEvidenceItem(row: EvidenceRow): DetailItem | null {
  const v = row.value_json ?? {}
  const provenance = provenanceOf(row)

  switch (row.field) {
    case 'funding_round': {
      const round = typeof v.round === 'string' ? v.round : null
      return round ? { label: 'Round', text: round, provenance } : null
    }

    case 'funding_amount': {
      const text = money(v.amount, v.currency)
      return text ? { label: 'Raised', text, provenance } : null
    }

    case 'funding_date': {
      const raised = typeof v.raisedAt === 'string' ? v.raisedAt : null
      if (!raised) return null
      const date = new Date(raised)
      if (Number.isNaN(date.getTime())) return null
      /*
       * ⚠️ `isAnnouncementDate` IS SAID OUT LOUD. The provider distinguishes
       * when a round CLOSED from when it was ANNOUNCED, and they can be months
       * apart. Presenting an announcement date as the raise date is a small
       * inaccuracy that a person doing diligence would care about.
       */
      const announced = v.isAnnouncementDate === true
      return {
        label: announced ? 'Announced' : 'Raised on',
        text: date.toLocaleDateString(),
        provenance,
      }
    }

    case 'funding_recency': {
      /*
       * ╔═══════════════════════════════════════════════════════════════════╗
       * ║  ⚠️ `monthsAgo` AND `window` ARE STORED DERIVATIONS AND THEY GO   ║
       * ║  STALE. They were computed when the row was written. A row saved  ║
       * ║  in February reading `{"window":"last_3_months","monthsAgo":1}`   ║
       * ║  still says "raised 1 month ago" today, seven months later —      ║
       * ║  and "recently funded" is the single strongest buying signal in   ║
       * ║  this product, so being silently wrong about it is expensive.     ║
       * ║                                                                   ║
       * ║  `raisedAt` is the fixed observation. The elapsed time is         ║
       * ║  recomputed from it HERE, at render, every time.                  ║
       * ╚═══════════════════════════════════════════════════════════════════╝
       */
      const raised = typeof v.raisedAt === 'string' ? v.raisedAt : null
      if (!raised) return null
      const date = new Date(raised)
      if (Number.isNaN(date.getTime())) return null

      const months = Math.max(
        0,
        Math.round((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24 * 30.44)),
      )
      const elapsed =
        months === 0 ? 'this month' : months === 1 ? '1 month ago' : `${months} months ago`

      return {
        label: v.isAnnouncementDate === true ? 'Funding announced' : 'Last raised',
        text: `${elapsed} (${date.toLocaleDateString()})`,
        provenance,
      }
    }

    case 'revenue_estimate': {
      const min = money(v.min, v.currency)
      const max = money(v.max, v.currency)
      if (!min && !max) return null
      // An estimate is a range; collapsing it to one number would state more
      // precision than was observed.
      return { label: 'Revenue estimate', text: min && max ? `${min} – ${max}` : (min ?? max), provenance }
    }

    case 'tech_stack': {
      const detected = Array.isArray(v.detected) ? v.detected : []
      const names = detected
        .map((d) => (d && typeof d === 'object' ? (d as { name?: unknown }).name : null))
        .filter((n): n is string => typeof n === 'string' && n.length > 0)
      return names.length > 0 ? { label: 'Detected', text: names.join(', '), provenance } : null
    }

    case 'hiring_signals': {
      const open = typeof v.openRoles === 'number' ? v.openRoles : null
      if (v.hiring !== true && open === null) return null
      return {
        label: 'Hiring',
        text: open === null ? 'Yes' : `${open} open role${open === 1 ? '' : 's'}`,
        provenance,
      }
    }

    case 'company_description': {
      const d = typeof v.description === 'string' ? v.description.trim() : ''
      return d ? { label: 'Description', text: d, provenance } : null
    }

    case 'recent_news': {
      const articles = Array.isArray(v.articles) ? v.articles : []
      const links = articles
        .map((a) => {
          if (!a || typeof a !== 'object') return null
          const { url, title } = a as { url?: unknown; title?: unknown }
          /*
           * ⚠️ EVERY URL HERE CAME FROM A CRAWLED PAGE. `safeSourceUrl` rejects
           * anything that is not http(s); a `javascript:` href in a news list
           * is stored XSS with a friendly title on it.
           */
          const safe = safeSourceUrl(typeof url === 'string' ? url : null)
          if (!safe) return null
          return { label: typeof title === 'string' && title.trim() ? title.trim() : safe, url: safe }
        })
        .filter((l): l is { label: string; url: string } => l !== null)

      return links.length > 0 ? { label: 'Recent news', text: null, links, provenance } : null
    }

    case 'social_profiles': {
      const profiles = Array.isArray(v.profiles) ? v.profiles : []
      const links = profiles
        .map((p) => safeSourceUrl(typeof p === 'string' ? p : null))
        .filter((u): u is string => u !== null)
        .map((url) => ({ label: new URL(url).hostname.replace(/^www\./, ''), url }))

      return links.length > 0 ? { label: 'Profiles', text: null, links, provenance } : null
    }

    case 'company_linkedin': {
      const url = safeSourceUrl(typeof v.value === 'string' ? v.value : null)
      return url ? { label: 'LinkedIn', text: null, links: [{ label: 'Company page', url }], provenance } : null
    }

    case 'company_contact_email': {
      const email = typeof v.email === 'string' ? v.email.trim() : ''
      return email ? { label: 'Company email', text: email, provenance } : null
    }

    case 'company_contact_phone': {
      const phone = typeof v.phone === 'string' ? v.phone.trim() : ''
      return phone ? { label: 'Company phone', text: phone, provenance } : null
    }

    default:
      return null
  }
}

/**
 * Which evidence fields are shown, and where.
 *
 * ⚠️ EXPORTED SO A GUARD CAN CHECK EVERY ENTRY IS ACTUALLY READABLE. A field
 * listed here but unhandled by `formatEvidenceItem` is queried, discarded and
 * never rendered — invisible data with a row in a table saying it should be
 * visible, which is the exact failure this whole module exists to correct.
 */
export const GROUPS: Record<string, keyof CompanyDetails> = {
  funding_recency: 'funding',
  funding_round: 'funding',
  funding_amount: 'funding',
  funding_date: 'funding',
  revenue_estimate: 'funding',
  tech_stack: 'techStack',
  recent_news: 'news',
  social_profiles: 'social',
  company_linkedin: 'social',
  hiring_signals: 'other',
  company_description: 'other',
  company_contact_email: 'other',
  company_contact_phone: 'other',
}

/**
 * Researched detail for one company, grouped for display.
 *
 * ⚠️ SCOPED THE SAME WAY AS EVERY OTHER READ ON THIS SEAM. `research_evidence`
 * is `user_id`-keyed while `crm_companies` is `workspace_id`-keyed; the caller
 * has already proved the company belongs to this workspace, and `user_id` is
 * filtered again here because the service role ignores RLS.
 */
export async function companyDetails(
  scope: TenantScope,
  sourceCompanyId: string | null,
): Promise<CompanyDetails> {
  const empty: CompanyDetails = { funding: [], techStack: [], news: [], social: [], other: [] }
  if (!sourceCompanyId) return empty

  const { data, error } = await createAdminClient()
    .from('research_evidence')
    .select('field, value_json, source_provider, source_url, retrieved_at, confidence')
    .eq('user_id', scope.userId)
    .eq('entity_type', 'company')
    .eq('entity_id', sourceCompanyId)
    .in('field', Object.keys(GROUPS))
    // Newest first, and only the newest per field is shown: an older
    // observation of the same thing is history, not a second fact.
    .order('retrieved_at', { ascending: false })

  if (error) throw new Error(`companyDetails failed: ${error.message}`)

  const seen = new Set<string>()
  for (const row of (data ?? []) as EvidenceRow[]) {
    if (seen.has(row.field)) continue
    seen.add(row.field)

    const item = formatEvidenceItem(row)
    if (!item) continue
    empty[GROUPS[row.field]!].push(item)
  }

  return empty
}

/**
 * A stored domain as a clickable URL, or null.
 *
 * ⚠️ THE STORED VALUE IS A BARE HOST — `acme.com`, not `https://acme.com`. An
 * href of `acme.com` is a RELATIVE path: the browser resolves it against the
 * current page and silently navigates to `/crm/companies/acme.com`, which 404s.
 * The scheme is added for the link only; the displayed text stays what we
 * observed, because normalising the display would be editing the record.
 */
export function companyWebsite(domain: string | null): string | null {
  if (!domain) return null
  const trimmed = domain.trim()
  if (!trimmed) return null
  // Already absolute (some rows hold a full URL) → validate it as-is.
  if (/^https?:\/\//i.test(trimmed)) return safeSourceUrl(trimmed)
  // A host with a path or a stray space is not a host; refuse rather than
  // building a link to somewhere we did not observe.
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(trimmed)) return null
  return safeSourceUrl(`https://${trimmed}`)
}

/**
 * `https://www.linkedin.com/company/northwind-robotics/` → `northwind-robotics`.
 *
 * ⚠️ FOR DISPLAY ONLY — the href keeps the full URL. A LinkedIn URL is about
 * fifty characters and the company header is a four-column grid; rendered raw it
 * wrapped out of its cell and overlapped the column beside it, turning two facts
 * into one unreadable one. Returns null when there is no slug to show, so the
 * caller falls back to a label rather than printing an empty string.
 */
export function linkedInSlug(raw: string | null): string | null {
  const url = safeSourceUrl(raw)
  if (!url) return null
  const segments = new URL(url).pathname.split('/').filter(Boolean)
  const last = segments.at(-1)
  return last && last !== 'company' ? decodeURIComponent(last) : null
}

/** Whether there is anything at all to show, so the section can stay hidden. */
export function hasDetails(details: CompanyDetails): boolean {
  return Object.values(details).some((group) => group.length > 0)
}
