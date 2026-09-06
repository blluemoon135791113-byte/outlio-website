/**
 * CSV import: parsing, column mapping and per-row validation (M2 Phase 3).
 *
 * PURE — no I/O, no database. Turns bytes a user uploaded into either a
 * `ContactInput` or a precise reason it could not be one.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  PARTIAL FAILURE IS THE NORMAL CASE, NOT AN EXCEPTION.                   ║
 * ║                                                                          ║
 * ║  A 5,000-row export with nine malformed rows must import 4,991 people    ║
 * ║  and report exactly which nine failed and why. Refusing the whole file    ║
 * ║  for nine rows is not validation, it is a tantrum — and it teaches the   ║
 * ║  user to strip their data until it is accepted, losing information       ║
 * ║  nobody wanted lost.                                                     ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ This module never writes. `buildImportPlan` produces a plan; the caller
 * decides whether to run it. That is what makes a preview possible.
 */
import type { ContactInput } from '@/lib/crm/repository'
import { normalizeEmail, normalizePhoneNumber } from '@/lib/crm/normalize'

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Rows are raw strings; interpretation happens in `applyMapping`. */
export type ParsedCsv = {
  headers: string[]
  rows: string[][]
}

export class CsvParseError extends Error {}

const MAX_CELL = 100_000

/**
 * RFC 4180 reader.
 *
 * Written rather than pulled in because the requirements are small and exact:
 * quoted fields containing commas and newlines, doubled quotes as an escape,
 * CRLF or LF, and a UTF-8 BOM — which Excel writes on every export and which
 * silently corrupts the first header name if it is not stripped.
 *
 * Delimiter is detected rather than assumed: a European Excel exports
 * semicolons, and reading that file as comma-separated yields one giant column
 * and a baffled user.
 */
export function parseCsv(text: string, delimiterHint?: string): ParsedCsv {
  // Excel's BOM. Without this the first header becomes "﻿email" and
  // matches nothing.
  const source = text.replace(/^﻿/, '')
  if (!source.trim()) throw new CsvParseError('That file is empty.')

  const delimiter = delimiterHint ?? detectDelimiter(source)

  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!

    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        cell += char
      }
      if (cell.length > MAX_CELL) {
        throw new CsvParseError('A field in that file is unreasonably large.')
      }
      continue
    }

    if (char === '"' && cell === '') {
      inQuotes = true
    } else if (char === delimiter) {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (char === '\r') {
      // Swallowed; the \n that follows ends the row.
    } else {
      cell += char
    }
  }

  // A file that does not end with a newline still has a final row.
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  const headerRow = rows.shift()
  if (!headerRow) throw new CsvParseError('That file has no header row.')

  const headers = headerRow.map((h) => h.trim())
  if (headers.every((h) => h === '')) {
    throw new CsvParseError('That file has no column names in its first row.')
  }

  // Blank trailing lines are an artefact of every editor, not data.
  const body = rows.filter((r) => r.some((c) => c.trim() !== ''))

  return { headers, rows: body }
}

/**
 * Picks the delimiter by counting candidates in the header line.
 *
 * The header is used rather than the whole file because a body cell can
 * legitimately contain any of these inside quotes, while a header rarely does.
 */
function detectDelimiter(source: string): string {
  const firstLine = source.split(/\r?\n/, 1)[0] ?? ''
  const candidates = [',', ';', '\t', '|']

  let best = ','
  let bestCount = 0
  for (const candidate of candidates) {
    const count = firstLine.split(candidate).length - 1
    if (count > bestCount) {
      best = candidate
      bestCount = count
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

/** Contact fields a CSV column can be mapped onto. */
export const IMPORT_FIELDS = [
  'full_name',
  'first_name',
  'last_name',
  'job_title',
  'email',
  'phone',
  'linkedin_url',
  'company_name',
  'company_domain',
  'company_linkedin_url',
  'location',
  'headline',
] as const

export type ImportField = (typeof IMPORT_FIELDS)[number]

/** Column header → field. Headers absent from the map are ignored. */
export type ImportMapping = Partial<Record<string, ImportField>>

/**
 * Header spellings seen in the wild, per field.
 *
 * Compared after lowercasing and stripping every non-alphanumeric character,
 * so "E-Mail Address", "email_address" and "Email address" all collapse to
 * `emailaddress`.
 */
const HEADER_ALIASES: Record<ImportField, string[]> = {
  full_name: ['fullname', 'name', 'contactname', 'personname', 'leadname'],
  first_name: ['firstname', 'givenname', 'forename', 'first'],
  last_name: ['lastname', 'surname', 'familyname', 'last'],
  job_title: ['jobtitle', 'title', 'position', 'role', 'jobposition'],
  email: ['email', 'emailaddress', 'workemail', 'businessemail', 'mail', 'primaryemail'],
  phone: ['phone', 'phonenumber', 'mobile', 'mobilephone', 'telephone', 'tel', 'cell'],
  linkedin_url: ['linkedin', 'linkedinurl', 'linkedinprofile', 'profileurl', 'linkedinlink'],
  company_name: ['company', 'companyname', 'organization', 'organisation', 'account', 'employer'],
  company_domain: ['domain', 'companydomain', 'website', 'companywebsite', 'url', 'companyurl'],
  company_linkedin_url: ['companylinkedin', 'companylinkedinurl', 'organizationlinkedin'],
  location: ['location', 'city', 'country', 'region', 'geo', 'address'],
  headline: ['headline', 'summary', 'bio', 'about', 'description'],
}

function canonicalHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Best-guess mapping, for the UI to present as a starting point.
 *
 * ⚠️ A SUGGESTION, NEVER A DECISION. The user confirms it. An auto-mapping
 * that silently reads "Owner" as a contact name imports the salesperson as the
 * lead, and nothing downstream can tell that happened.
 *
 * First match wins per field, so a file with both "Email" and "Work Email"
 * maps the earlier column and leaves the other for the user.
 */
export function suggestMapping(headers: string[]): ImportMapping {
  const mapping: ImportMapping = {}
  const taken = new Set<ImportField>()

  for (const header of headers) {
    const canonical = canonicalHeader(header)
    if (!canonical) continue

    for (const field of IMPORT_FIELDS) {
      if (taken.has(field)) continue
      if (!HEADER_ALIASES[field].includes(canonical)) continue
      mapping[header] = field
      taken.add(field)
      break
    }
  }

  return mapping
}

// ---------------------------------------------------------------------------
// Row validation
// ---------------------------------------------------------------------------

export type RowError = {
  /** 1-based, counting the header as line 1 — what the user sees in a spreadsheet. */
  line: number
  reason: string
}

export type ImportPlanRow = {
  line: number
  contact: ContactInput
  company: {
    name: string | null
    websiteUrl: string | null
    linkedInUrl: string | null
  } | null
}

export type ImportPlan = {
  rows: ImportPlanRow[]
  errors: RowError[]
  /** Every data row seen, including the ones that failed. */
  rowsTotal: number
}

/** Beyond this the report stops being a report and becomes a second problem. */
export const MAX_REPORTED_ERRORS = 100

export type ImportOptions = {
  /** Only applied to national-format numbers. Never inferred (Ledger D12). */
  defaultPhoneCountry?: string | null
  /** Assigns every imported contact to one person. */
  ownerUserId?: string | null
}

/**
 * Turns a parsed CSV and a confirmed mapping into a plan.
 *
 * Nothing is written. The plan is what a preview renders and what the importer
 * then executes, so what the user approved and what runs cannot diverge.
 */
export function buildImportPlan(
  parsed: ParsedCsv,
  mapping: ImportMapping,
  options: ImportOptions = {},
): ImportPlan {
  const rows: ImportPlanRow[] = []
  const errors: RowError[] = []

  // Column indexes resolved once. A header mapped twice would otherwise be
  // scanned per row for no reason.
  const columns: { index: number; field: ImportField }[] = []
  parsed.headers.forEach((header, index) => {
    const field = mapping[header]
    if (field) columns.push({ index, field })
  })

  const mappedFields = new Set(columns.map((c) => c.field))
  const canIdentify =
    mappedFields.has('email') ||
    mappedFields.has('linkedin_url') ||
    mappedFields.has('full_name') ||
    (mappedFields.has('first_name') && mappedFields.has('last_name'))

  if (!canIdentify) {
    // Not a row-level failure: no row in this file could ever identify anyone,
    // so the mapping is wrong rather than the data.
    return {
      rows: [],
      errors: [
        {
          line: 1,
          reason:
            'Map at least one column to Email, LinkedIn URL, or a name before importing.',
        },
      ],
      rowsTotal: parsed.rows.length,
    }
  }

  parsed.rows.forEach((cells, rowIndex) => {
    const line = rowIndex + 2 // header is line 1

    // Partial, not Record: a column the user did not map is genuinely absent,
    // and a type that claims otherwise makes every `?? null` below look
    // redundant when it is load-bearing.
    const values: Partial<Record<ImportField, string>> = {}
    for (const column of columns) {
      const raw = (cells[column.index] ?? '').trim()
      if (raw) values[column.field] = raw
    }

    // A file with separate first/last columns is as common as one with a full
    // name, and reconstructing here means the rest of the pipeline sees one
    // shape.
    const fullName =
      values.full_name ?? [values.first_name, values.last_name].filter(Boolean).join(' ')

    // ---- identity ---------------------------------------------------------
    const email = values.email ? normalizeEmail(values.email) : null
    if (values.email && !email) {
      errors.push({ line, reason: `“${values.email}” is not a valid email address.` })
      return
    }

    if (!fullName && !email && !values.linkedin_url) {
      errors.push({ line, reason: 'This row has no name, email or LinkedIn URL.' })
      return
    }

    // ---- phone ------------------------------------------------------------
    // A bad phone is NEVER a row failure — dropping a whole person over a
    // number is exactly the over-strictness this module exists to avoid.
    //
    // But there are two kinds of bad, and they deserve different answers:
    //
    //   ambiguous_no_country  a real number we cannot regionalize. KEPT raw
    //                         with no E.164, because a human can still read
    //                         and dial it (Ledger D12).
    //   invalid               not a number at all — "call reception", "n/a",
    //                         "see notes". DROPPED, because storing it puts
    //                         prose in a phone field that a dialler, an
    //                         export and a duplicate check all have to
    //                         pretend is a number.
    const phones: string[] = []
    if (values.phone) {
      const phone = normalizePhoneNumber(values.phone, {
        defaultCountry: options.defaultPhoneCountry ?? null,
      })
      if (phone && phone.reason !== 'invalid') phones.push(phone.raw)
    }

    rows.push({
      line,
      contact: {
        fullName: fullName || null,
        jobTitle: values.job_title ?? null,
        linkedInUrl: values.linkedin_url ?? null,
        location: values.location ?? null,
        headline: values.headline ?? null,
        emails: email ? [email.address] : [],
        phones,
        defaultPhoneCountry: options.defaultPhoneCountry ?? null,
        ownerUserId: options.ownerUserId ?? null,
        source: 'csv_import',
      },
      company:
        values.company_name || values.company_domain || values.company_linkedin_url
          ? {
              name: values.company_name ?? null,
              websiteUrl: values.company_domain ?? null,
              linkedInUrl: values.company_linkedin_url ?? null,
            }
          : null,
    })
  })

  return {
    rows,
    // Capped so one malformed file cannot store thousands of error objects.
    // The count is still honest: `rowsTotal - rows.length` is the real failure
    // count, whatever the report shows.
    errors: errors.slice(0, MAX_REPORTED_ERRORS),
    rowsTotal: parsed.rows.length,
  }
}

/** The numbers a validation report shows before anything is written. */
export function summarizePlan(plan: ImportPlan): {
  rowsTotal: number
  rowsValid: number
  rowsFailed: number
  errorsTruncated: boolean
} {
  const rowsFailed = plan.rowsTotal - plan.rows.length
  return {
    rowsTotal: plan.rowsTotal,
    rowsValid: plan.rows.length,
    rowsFailed,
    errorsTruncated: rowsFailed > plan.errors.length,
  }
}
