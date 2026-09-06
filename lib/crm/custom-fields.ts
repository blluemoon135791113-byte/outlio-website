/**
 * Typed custom fields (M2 Phase 2).
 *
 * PURE — no I/O. The definition declares a type; this file is the ONE place a
 * value is checked against it.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  WHY THE DATABASE DOES NOT ALSO VALIDATE THIS.                           ║
 * ║                                                                          ║
 * ║  A CHECK constraint cannot express "this JSONB matches the type named by  ║
 * ║  a row in another table". An approximation in SQL would be a SECOND      ║
 * ║  source of truth that drifts from this one — the failure mode both       ║
 * ║  0043_companies.sql and lib/limits/credits.ts carry warnings about.      ║
 * ║                                                                          ║
 * ║  So the split is deliberate: the database enforces SHAPE (one value per  ║
 * ║  definition per record, options is an array), and this file enforces      ║
 * ║  TYPE, at the single choke point every write goes through.               ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Every validator NORMALIZES as well as checks, so one real value has one
 * stored form: `" 42 "` and `42` become the same number, and an email is
 * folded through the same `normalizeEmail` the contact record uses.
 */
import { normalizeEmail } from '@/lib/crm/normalize'

/** Mirrors the `crm_custom_field_type` enum in migration 0071. */
export type CustomFieldType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'url'
  | 'email'
  | 'select'
  | 'multi_select'

/** Mirrors `crm_custom_field_entity`. */
export type CustomFieldEntity = 'contact' | 'company' | 'opportunity'

export type CustomFieldDefinition = {
  key: string
  label: string
  fieldType: CustomFieldType
  /** Permitted choices. Only meaningful for `select` and `multi_select`. */
  options: string[]
  isRequired: boolean
}

/**
 * `value` is what gets written to `crm_custom_field_values.value` as JSONB.
 * `null` means "no value", which is distinct from a validation failure.
 */
export type CustomFieldResult =
  | { ok: true; value: CustomFieldValue }
  | { ok: false; reason: string }

export type CustomFieldValue = string | number | boolean | string[] | null

const MAX_TEXT = 5_000
const MAX_OPTION = 200
const MAX_MULTI_SELECT = 50

const fail = (reason: string): CustomFieldResult => ({ ok: false, reason })
const pass = (value: CustomFieldValue): CustomFieldResult => ({ ok: true, value })

/**
 * True for the several ways a form, a CSV cell and a JSON payload each spell
 * "nothing". Collapsing them here means `required` behaves the same whichever
 * write path the value arrived on.
 */
function isBlank(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true
  if (typeof raw === 'string' && raw.trim() === '') return true
  if (Array.isArray(raw) && raw.length === 0) return true
  return false
}

/**
 * `YYYY-MM-DD`, checked for real existence rather than shape.
 *
 * `2026-02-30` matches the pattern and is not a date. Round-tripping through
 * `Date` and comparing catches it, along with month 13 and day 0.
 */
function normalizeDate(raw: string): string | null {
  const text = raw.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null

  const parsed = new Date(`${text}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return null
  // JavaScript rolls 2026-02-30 forward to 2026-03-02 rather than failing.
  return parsed.toISOString().slice(0, 10) === text ? text : null
}

/**
 * Only `http` and `https`.
 *
 * `javascript:` and `data:` parse perfectly well as URLs and are stored,
 * rendered, and eventually clicked. A custom field is user-supplied content
 * that ends up in a link, so the scheme allow-list belongs here rather than at
 * every render site.
 */
function normalizeUrl(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null

  let candidate = text
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) candidate = `https://${candidate}`

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname.includes('.')) return null

  return url.toString()
}

/**
 * Accepts the shapes a checkbox, a CSV cell and a JSON body each produce.
 * Anything outside this list is a failure, not a coercion: `"maybe"` must not
 * quietly become `false`.
 */
function normalizeBoolean(raw: unknown): boolean | null {
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'number') {
    if (raw === 1) return true
    if (raw === 0) return false
    return null
  }
  if (typeof raw !== 'string') return null

  const text = raw.trim().toLowerCase()
  if (['true', 'yes', 'y', '1', 'on'].includes(text)) return true
  if (['false', 'no', 'n', '0', 'off'].includes(text)) return false
  return null
}

function normalizeNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string') return null

  const text = raw.trim().replace(/,/g, '')
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) return null

  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

/** Options are compared case-insensitively but stored as the definition spells them. */
function matchOption(options: string[], candidate: string): string | null {
  const wanted = candidate.trim().toLowerCase()
  return options.find((option) => option.trim().toLowerCase() === wanted) ?? null
}

/**
 * Validates and normalizes one custom-field value.
 *
 * Returns a NORMALIZED value, not the input: callers must store what this
 * returns, or two spellings of one value end up in the database and every
 * filter has to know about both.
 */
export function validateCustomFieldValue(
  definition: CustomFieldDefinition,
  raw: unknown,
): CustomFieldResult {
  if (isBlank(raw)) {
    return definition.isRequired
      ? fail(`${definition.label} is required.`)
      : pass(null)
  }

  switch (definition.fieldType) {
    case 'text': {
      if (typeof raw !== 'string') return fail(`${definition.label} must be text.`)
      const text = raw.trim()
      if (text.length > MAX_TEXT) {
        return fail(`${definition.label} must be ${MAX_TEXT} characters or fewer.`)
      }
      return pass(text)
    }

    case 'number': {
      const value = normalizeNumber(raw)
      if (value === null) return fail(`${definition.label} must be a number.`)
      return pass(value)
    }

    case 'boolean': {
      const value = normalizeBoolean(raw)
      if (value === null) return fail(`${definition.label} must be true or false.`)
      return pass(value)
    }

    case 'date': {
      if (typeof raw !== 'string') return fail(`${definition.label} must be a date.`)
      const value = normalizeDate(raw)
      if (!value) return fail(`${definition.label} must be a real date, as YYYY-MM-DD.`)
      return pass(value)
    }

    case 'url': {
      if (typeof raw !== 'string') return fail(`${definition.label} must be a link.`)
      const value = normalizeUrl(raw)
      if (!value) return fail(`${definition.label} must be an http or https link.`)
      return pass(value)
    }

    case 'email': {
      if (typeof raw !== 'string') return fail(`${definition.label} must be an email address.`)
      // The SAME normalizer the contact record uses, so a custom email field
      // and a contact email agree on what one address is.
      const email = normalizeEmail(raw)
      if (!email) return fail(`${definition.label} must be a valid email address.`)
      return pass(email.address)
    }

    case 'select': {
      if (typeof raw !== 'string') return fail(`${definition.label} must be one of the options.`)
      const value = matchOption(definition.options, raw)
      if (!value) return fail(`${definition.label} must be one of the options.`)
      return pass(value)
    }

    case 'multi_select': {
      // A single string is accepted so a CSV cell holding one choice does not
      // need the importer to know whether the field is multi-valued.
      const list = Array.isArray(raw) ? raw : [raw]
      if (list.length > MAX_MULTI_SELECT) {
        return fail(`${definition.label} accepts at most ${MAX_MULTI_SELECT} options.`)
      }

      const chosen: string[] = []
      for (const entry of list) {
        if (typeof entry !== 'string') {
          return fail(`${definition.label} must be a list of options.`)
        }
        if (entry.trim() === '') continue
        const value = matchOption(definition.options, entry)
        if (!value) return fail(`“${entry.trim()}” is not an option for ${definition.label}.`)
        // Deduplicated, so selecting one option twice cannot change a filter's
        // count of how many records carry it.
        if (!chosen.includes(value)) chosen.push(value)
      }

      if (chosen.length === 0) {
        return definition.isRequired
          ? fail(`${definition.label} is required.`)
          : pass(null)
      }
      return pass(chosen)
    }
  }
}

/**
 * Validates a definition itself, before it is created.
 *
 * A broken definition is worse than a broken value: it silently invalidates
 * every value already stored against it.
 */
export function validateCustomFieldDefinition(input: {
  key: string
  label: string
  fieldType: CustomFieldType
  options?: unknown
}): { ok: true; options: string[] } | { ok: false; reason: string } {
  // Mirrors the CHECK constraint in 0071. The key is a merge variable and an
  // API field name, so it is deliberately narrow.
  if (!/^[a-z][a-z0-9_]{0,48}$/.test(input.key)) {
    return {
      ok: false,
      reason:
        'A field key must start with a letter and contain only lowercase letters, numbers and underscores.',
    }
  }

  const label = input.label.trim()
  if (!label || label.length > 80) {
    return { ok: false, reason: 'A field needs a label of 80 characters or fewer.' }
  }

  const needsOptions =
    input.fieldType === 'select' || input.fieldType === 'multi_select'

  if (!needsOptions) {
    // Options on a text field are meaningless and would imply a constraint
    // that nothing enforces.
    if (Array.isArray(input.options) && input.options.length > 0) {
      return { ok: false, reason: 'Only choice fields can have options.' }
    }
    return { ok: true, options: [] }
  }

  if (!Array.isArray(input.options) || input.options.length === 0) {
    return { ok: false, reason: 'A choice field needs at least one option.' }
  }

  const options: string[] = []
  for (const entry of input.options) {
    if (typeof entry !== 'string') {
      return { ok: false, reason: 'Options must be text.' }
    }
    const option = entry.trim()
    if (!option) return { ok: false, reason: 'An option cannot be blank.' }
    if (option.length > MAX_OPTION) {
      return { ok: false, reason: `An option must be ${MAX_OPTION} characters or fewer.` }
    }
    // Case-insensitive, because `matchOption` resolves values that way: two
    // options differing only by case could never both be selected.
    if (options.some((existing) => existing.toLowerCase() === option.toLowerCase())) {
      return { ok: false, reason: `“${option}” is listed twice.` }
    }
    options.push(option)
  }

  return { ok: true, options }
}
