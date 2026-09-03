import 'server-only'

/**
 * Exporting contacts.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  TWO EXPORTS, BECAUSE THEY ANSWER DIFFERENT QUESTIONS.                   ║
 * ║                                                                           ║
 * ║  `crm` is the whole book — every contact you can see, with the fields a   ║
 * ║  person reads. `marketing` is a mailing list: only contacts with an       ║
 * ║  address, only addresses that may lawfully be mailed, and the columns an  ║
 * ║  email tool actually maps.                                                ║
 * ║                                                                           ║
 * ║  ⚠️ THE MARKETING FILE EXCLUDES SUPPRESSED ADDRESSES, AND THAT IS THE     ║
 * ║  WHOLE POINT OF IT BEING A SEPARATE EXPORT. Someone who unsubscribed,     ║
 * ║  hard-bounced or filed a spam complaint is in `email_suppressions`. The   ║
 * ║  sending pipeline honours that list; a CSV handed to Mailchimp does not.  ║
 * ║  Exporting those addresses is how an unsubscribe gets undone and how a    ║
 * ║  sending domain gets blacklisted — the harm lands on the customer's own   ║
 * ║  deliverability, days later, with no visible cause.                       ║
 * ║                                                                           ║
 * ║  ⚠️ SCOPED BY `dataScope`, NEVER BY THE UI. A setter exports their own    ║
 * ║  contacts because the QUERY narrows them, not because a button was        ║
 * ║  hidden. The service role bypasses RLS, so this file is the boundary.     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { toCsv, type CsvColumn } from '@/lib/export/sanitize'
import { createAdminClient } from '@/lib/supabase/admin'

export type ContactExportKind = 'crm' | 'marketing'

export function isContactExportKind(value: string | null): value is ContactExportKind {
  return value === 'crm' || value === 'marketing'
}

/**
 * ⚠️ A CAP, NOT A PAGE SIZE. `lib/crm/report-export.ts` sets the same limit and
 * explains why: an aggregate report is bounded by team size, but a RECORD
 * export is bounded by contact count, which is unbounded. A request handler
 * that tries to stream 400,000 rows times out and leaves the customer with a
 * truncated file they have no way to detect.
 *
 * Above this the answer is a loud error naming the number, not a silent
 * `LIMIT` that hands back the first 5,000 rows as if they were all of them.
 */
export const MAX_EXPORT_ROWS = 5_000

export class ContactExportTooLargeError extends Error {}

export type ContactExportRow = {
  fullName: string | null
  firstName: string | null
  lastName: string | null
  jobTitle: string | null
  companyName: string | null
  email: string | null
  phone: string | null
  location: string | null
  linkedInUrl: string | null
  ownerName: string | null
  source: string
  createdAt: string
}

export type ContactExportOptions = {
  kind: ContactExportKind
  /** `null` means the whole workspace — only ever passed for a manager. */
  ownerUserId: string | null
}

/**
 * Splits a display name into given/family for the mail-merge columns every
 * email tool expects.
 *
 * ⚠️ FIRST WORD AND LAST WORD, AND THAT IS ALL IT CLAIMS. Names do not decompose
 * reliably — "Muhammad Husnain Rafiq" and "van der Berg" both defeat any rule —
 * so the full name is exported ALONGSIDE these, unchanged. A tool that merges
 * on the wrong field can be repointed at `Full name`; a file that had thrown the
 * original away could not.
 */
function splitName(full: string | null): { first: string | null; last: string | null } {
  const words = (full ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { first: null, last: null }
  if (words.length === 1) return { first: words[0]!, last: null }
  return { first: words[0]!, last: words[words.length - 1]! }
}

/**
 * Every contact the caller may export, resolved in batched lookups rather than
 * per row.
 */
export async function collectContactsForExport(
  workspaceId: string,
  options: ContactExportOptions,
): Promise<ContactExportRow[]> {
  const db = createAdminClient()

  let query = db
    .from('crm_contacts')
    .select(
      'id, full_name, job_title, location, linkedin_url, owner_user_id, source, created_at, primary_company_id',
      { count: 'exact' },
    )
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)

  // The narrowing that makes "export your own contacts" true rather than a
  // hidden button.
  if (options.ownerUserId) query = query.eq('owner_user_id', options.ownerUserId)

  const { data, count, error } = await query
    .order('full_name', { ascending: true, nullsFirst: false })
    .order('id', { ascending: true })
    .limit(MAX_EXPORT_ROWS + 1)

  if (error) throw new Error(`collectContactsForExport failed: ${error.message}`)

  /*
   * ⚠️ COUNTED WITH `exact`, NOT ESTIMATED. The contacts LIST uses an estimated
   * count because it is cheap and only drives a page number. Here the number
   * decides whether the customer gets a complete file or an error, so an
   * estimate 0.2% low would hand back a silently truncated export.
   */
  const total = count ?? data?.length ?? 0
  if (total > MAX_EXPORT_ROWS) {
    throw new ContactExportTooLargeError(
      `This would export ${total.toLocaleString()} contacts, which is more than a direct download can carry. Filter the list, or ask for a background export.`,
    )
  }

  const rows = data ?? []
  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id)
  const companyIds = [...new Set(rows.map((r) => r.primary_company_id).filter(Boolean))] as string[]
  const ownerIds = [...new Set(rows.map((r) => r.owner_user_id).filter(Boolean))] as string[]

  const [companies, owners, emails, phones, suppressed] = await Promise.all([
    companyIds.length
      ? db.from('crm_companies').select('id, name').in('id', companyIds)
      : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
    ownerIds.length
      ? db.from('profiles').select('id, full_name, email').in('id', ownerIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string | null }[] }),
    db
      .from('crm_contact_emails')
      .select('contact_id, address, is_primary')
      .eq('workspace_id', workspaceId)
      .in('contact_id', ids)
      .is('deleted_at', null),
    db
      .from('crm_contact_phones')
      .select('contact_id, raw, is_primary')
      .eq('workspace_id', workspaceId)
      .in('contact_id', ids)
      .is('deleted_at', null),
    /*
     * The suppression list for this workspace. Fetched for BOTH kinds so the
     * CRM export can be filtered too if that is ever wanted, and because
     * fetching it conditionally is how it gets forgotten.
     */
    db.from('email_suppressions').select('email').eq('workspace_id', workspaceId),
  ])

  const companyName = new Map((companies.data ?? []).map((c) => [c.id, c.name]))
  const ownerName = new Map<string, string | null>(
    (owners.data ?? []).map((o) => [o.id, o.full_name?.trim() || o.email || null]),
  )

  // Primary wins; otherwise the first address we have.
  const emailFor = new Map<string, string>()
  for (const row of emails.data ?? []) {
    if (row.is_primary || !emailFor.has(row.contact_id)) emailFor.set(row.contact_id, row.address)
  }
  const phoneFor = new Map<string, string>()
  for (const row of phones.data ?? []) {
    if (row.is_primary || !phoneFor.has(row.contact_id)) phoneFor.set(row.contact_id, row.raw)
  }

  /*
   * ⚠️ COMPARED LOWERCASED. The column has a `email = lower(email)` check so
   * the stored side is already folded, but `crm_contact_emails.address` keeps
   * whatever case the source gave us — so a case-sensitive comparison would
   * miss `Sam@Example.com` against a suppression on `sam@example.com` and mail
   * someone who unsubscribed.
   */
  const suppressedSet = new Set(
    ((suppressed as { data: { email: string }[] | null }).data ?? []).map((s) =>
      s.email.toLowerCase(),
    ),
  )

  const out: ContactExportRow[] = []
  for (const row of rows) {
    const email = emailFor.get(row.id) ?? null

    if (options.kind === 'marketing') {
      // No address, nothing to mail.
      if (!email) continue
      if (suppressedSet.has(email.toLowerCase())) continue
    }

    const { first, last } = splitName(row.full_name)
    out.push({
      fullName: row.full_name,
      firstName: first,
      lastName: last,
      jobTitle: row.job_title,
      companyName: row.primary_company_id
        ? (companyName.get(row.primary_company_id) ?? null)
        : null,
      email,
      phone: phoneFor.get(row.id) ?? null,
      location: row.location,
      linkedInUrl: row.linkedin_url,
      ownerName: row.owner_user_id ? (ownerName.get(row.owner_user_id) ?? null) : null,
      source: row.source,
      createdAt: row.created_at,
    })
  }

  return out
}

const CRM_COLUMNS: CsvColumn<ContactExportRow>[] = [
  { header: 'Full name', value: (r) => r.fullName },
  { header: 'Job title', value: (r) => r.jobTitle },
  { header: 'Company', value: (r) => r.companyName },
  { header: 'Email', value: (r) => r.email },
  { header: 'Phone', value: (r) => r.phone },
  { header: 'Location', value: (r) => r.location },
  /*
   * ⚠️ A PLAIN URL COLUMN, NEVER `=HYPERLINK(...)`. CLAUDE.md fixes name and
   * URL as separate columns, and `sanitizeCell` exists precisely to stop a
   * formula reaching a cell.
   */
  { header: 'LinkedIn URL', value: (r) => r.linkedInUrl },
  { header: 'Owner', value: (r) => r.ownerName },
  { header: 'Source', value: (r) => r.source.replace(/_/g, ' ') },
  { header: 'Added', value: (r) => r.createdAt.slice(0, 10) },
]

/**
 * ⚠️ EMAIL FIRST, AND FEWER COLUMNS. Mailchimp, Brevo and friends map the first
 * column by default and choke on fields they have no merge tag for. This is the
 * file you upload, not the file you read.
 */
const MARKETING_COLUMNS: CsvColumn<ContactExportRow>[] = [
  { header: 'Email', value: (r) => r.email },
  { header: 'First name', value: (r) => r.firstName },
  { header: 'Last name', value: (r) => r.lastName },
  { header: 'Full name', value: (r) => r.fullName },
  { header: 'Company', value: (r) => r.companyName },
  { header: 'Job title', value: (r) => r.jobTitle },
]

export function contactsToCsv(rows: ContactExportRow[], kind: ContactExportKind): string {
  const columns = kind === 'marketing' ? MARKETING_COLUMNS : CRM_COLUMNS

  return toCsv(rows, columns, {
    /*
     * ⚠️ THE MARKETING FILE USES A TRUE EMPTY, NOT `N/A`. `toCsv` defaults to
     * "N/A" because a human reading a spreadsheet cannot tell a blank from a
     * failure. An email platform cannot tell either — it merges the literal
     * text, and the campaign greets someone as "Hi N/A".
     */
    emptyValue: kind === 'marketing' ? '' : 'N/A',
    /*
     * Pinned so the header row is stable even when a batch happens to have no
     * company or no last name — an import mapping built once keeps working.
     */
    alwaysKeep: columns.map((c) => c.header),
  })
}
