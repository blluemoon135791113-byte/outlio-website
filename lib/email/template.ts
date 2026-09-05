/**
 * Template variables — M6 Phase 16.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  DETERMINISTIC SUBSTITUTION. ZERO AI CREDITS. NO INFERENCE.               ║
 * ║                                                                           ║
 * ║  `{{first_name}}` looks up a field and puts it in the message. It does    ║
 * ║  not guess a first name from an email address, does not expand an         ║
 * ║  initial, and does not ask a model what a company probably does. The      ║
 * ║  brief allows OPTIONAL Hubble personalization as a clearly-labelled       ║
 * ║  credit-consuming step; this file is the free path and must stay free —   ║
 * ║  a customer sending 10,000 emails cannot discover a per-message charge    ║
 * ║  hidden inside `{{first_name}}`.                                          ║
 * ║                                                                           ║
 * ║  ⚠️ AND IT NEVER INVENTS A VALUE. CLAUDE.md rule 4. A missing field with  ║
 * ║  no fallback is a REFUSAL to render, not a blank — see below for why.     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

/**
 * The variables a template may use.
 *
 * ⚠️ AN ALLOWLIST, NOT A FREE LOOKUP. A typo like `{{firstname}}` must be
 * caught when the template is SAVED, in front of the person who wrote it —
 * not discovered at send time across 10,000 messages that all say "Hi ,".
 */
export const TEMPLATE_VARIABLES = [
  'first_name',
  'last_name',
  'full_name',
  'company_name',
  'job_title',
  'owner_name',
  'owner_email',
  'sender_name',
] as const

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number]

/** Custom fields are addressed as `{{custom.slug}}`. */
const CUSTOM_PREFIX = 'custom.'

export type TemplateContext = {
  values: Partial<Record<TemplateVariable, string | null>>
  custom?: Record<string, string | null>
}

/*
 * ⚠️ BOUNDED, NON-BACKTRACKING PATTERN. Templates are customer-supplied text.
 * A pattern like `\{\{(.+?)\}\}` with nested quantifiers can be driven into
 * catastrophic backtracking by a crafted template, hanging the worker that
 * renders it. `[^{}|]` excludes the delimiters outright so there is nothing to
 * backtrack over, and the length caps put a hard ceiling on any single match.
 */
const TOKEN = /\{\{\s*([a-zA-Z0-9_.]{1,64})\s*(?:\|\s*([^{}|]{0,200}?)\s*)?\}\}/g

export type ParsedToken = {
  raw: string
  name: string
  fallback: string | null
}

/** Every variable a template references, in order of appearance. */
export function parseTemplate(template: string): ParsedToken[] {
  const tokens: ParsedToken[] = []
  for (const match of template.matchAll(TOKEN)) {
    tokens.push({
      raw: match[0],
      name: match[1]!,
      fallback: match[2] ?? null,
    })
  }
  return tokens
}

export class TemplateError extends Error {}

/**
 * Checks a template at SAVE time.
 *
 * ⚠️ THE POINT IS TO FAIL IN FRONT OF THE AUTHOR. Every problem this catches
 * would otherwise surface as a broken email already in someone's inbox.
 */
export function validateTemplate(
  template: string,
  knownCustomFields: readonly string[] = [],
): { valid: true } | { valid: false; errors: string[] } {
  const errors: string[] = []
  const known = new Set<string>(TEMPLATE_VARIABLES)
  const customKnown = new Set(knownCustomFields)

  for (const token of parseTemplate(template)) {
    if (token.name.startsWith(CUSTOM_PREFIX)) {
      const slug = token.name.slice(CUSTOM_PREFIX.length)
      if (!slug) {
        errors.push(`\`${token.raw}\` does not name a custom field.`)
      } else if (customKnown.size > 0 && !customKnown.has(slug)) {
        errors.push(`\`${token.raw}\` refers to a custom field that does not exist.`)
      }
      continue
    }

    if (!known.has(token.name)) {
      // A near-miss suggestion, because `{{firstname}}` vs `{{first_name}}` is
      // the mistake people actually make.
      const suggestion = TEMPLATE_VARIABLES.find(
        (v) => v.replace(/_/g, '') === token.name.toLowerCase().replace(/_/g, ''),
      )
      errors.push(
        suggestion
          ? `\`${token.raw}\` is not a variable. Did you mean \`{{${suggestion}}}\`?`
          : `\`${token.raw}\` is not a variable Outlio knows.`,
      )
    }
  }

  /*
   * An unclosed `{{` would otherwise ship literally in the email body, which
   * looks like a bug to the recipient and reveals the tool being used.
   */
  const stray = template.replace(TOKEN, '')
  if (stray.includes('{{')) {
    errors.push('There is an unclosed `{{` in this template.')
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors }
}

/** Escapes a value being inserted into HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export type RenderResult =
  | { ok: true; text: string }
  /**
   * ⚠️ A REFUSAL, NOT A BEST EFFORT. See `renderTemplate` for the reasoning.
   */
  | { ok: false; missing: string[] }

function lookup(name: string, context: TemplateContext): string | null {
  if (name.startsWith(CUSTOM_PREFIX)) {
    return context.custom?.[name.slice(CUSTOM_PREFIX.length)] ?? null
  }
  return context.values[name as TemplateVariable] ?? null
}

/**
 * Renders a template against one contact's data.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  A MISSING VALUE WITH NO FALLBACK REFUSES TO RENDER.                     ║
 * ║                                                                           ║
 * ║  The three tempting alternatives are all worse:                           ║
 * ║                                                                           ║
 * ║   - Substitute empty  → "Hi ," goes out. The single most recognisable    ║
 * ║     mass-mail failure there is, and it tells the recipient they are one   ║
 * ║     of thousands.                                                        ║
 * ║   - Leave the token   → "Hi {{first_name}}," is worse still: it leaks the ║
 * ║     tooling and reads as incompetence.                                    ║
 * ║   - Invent a value    → forbidden outright (CLAUDE.md rule 4). Guessing a ║
 * ║     first name from an address puts a WRONG name in a stranger's inbox.  ║
 * ║                                                                           ║
 * ║  Refusing means the message is never queued and the customer is told      ║
 * ║  which contacts lack which field, while they can still fix it. Writing    ║
 * ║  `{{first_name|there}}` is the one-keystroke answer, and it is an         ║
 * ║  explicit editorial choice rather than a silent default.                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export function renderTemplate(
  template: string,
  context: TemplateContext,
  options: { html?: boolean } = {},
): RenderResult {
  const missing: string[] = []

  const text = template.replace(TOKEN, (_raw, name: string, fallback?: string) => {
    const value = lookup(name, context)
    const trimmed = value?.trim()

    if (trimmed) return options.html ? escapeHtml(trimmed) : trimmed

    if (fallback !== undefined && fallback !== '') {
      return options.html ? escapeHtml(fallback) : fallback
    }

    missing.push(name)
    return ''
  })

  if (missing.length > 0) return { ok: false, missing: [...new Set(missing)] }
  return { ok: true, text }
}

/**
 * Renders for a PREVIEW, where refusing would be unhelpful.
 *
 * ⚠️ MISSING VALUES ARE MARKED, NEVER BLANK. The preview's job is to show the
 * author exactly what is wrong, so a gap is rendered as a visible placeholder
 * rather than silently collapsing — which would make a broken template look
 * fine.
 */
export function previewTemplate(
  template: string,
  context: TemplateContext,
  options: { html?: boolean } = {},
): { text: string; missing: string[] } {
  const missing: string[] = []

  const text = template.replace(TOKEN, (_raw, name: string, fallback?: string) => {
    const value = lookup(name, context)?.trim()
    if (value) return options.html ? escapeHtml(value) : value
    if (fallback !== undefined && fallback !== '') {
      return options.html ? escapeHtml(fallback) : fallback
    }
    missing.push(name)
    return `[no ${name.replace(CUSTOM_PREFIX, '').replace(/_/g, ' ')}]`
  })

  return { text, missing: [...new Set(missing)] }
}

/**
 * Builds a render context from a contact.
 *
 * ⚠️ NOTHING IS DERIVED THAT WAS NOT STORED. `first_name` comes from the
 * `first_name` column; it is not sliced out of `full_name`, and it is
 * certainly not guessed from an email address. If the extractor did not
 * capture it, it is missing, and the template must say so.
 */
export function contextFor(input: {
  contact: {
    firstName?: string | null
    lastName?: string | null
    fullName?: string | null
    jobTitle?: string | null
    companyName?: string | null
  }
  ownerName?: string | null
  ownerEmail?: string | null
  senderName?: string | null
  custom?: Record<string, string | null>
}): TemplateContext {
  return {
    values: {
      first_name: input.contact.firstName ?? null,
      last_name: input.contact.lastName ?? null,
      full_name: input.contact.fullName ?? null,
      job_title: input.contact.jobTitle ?? null,
      company_name: input.contact.companyName ?? null,
      owner_name: input.ownerName ?? null,
      owner_email: input.ownerEmail ?? null,
      sender_name: input.senderName ?? null,
    },
    custom: input.custom,
  }
}

/** A human list of what a template needs, for the composer's sidebar. */
export function describeVariables(): { name: string; example: string; note: string }[] {
  return [
    { name: 'first_name', example: '{{first_name|there}}', note: 'Always give this a fallback.' },
    { name: 'last_name', example: '{{last_name}}', note: '' },
    { name: 'full_name', example: '{{full_name}}', note: '' },
    { name: 'company_name', example: '{{company_name|your team}}', note: '' },
    { name: 'job_title', example: '{{job_title}}', note: 'Often missing — use a fallback.' },
    { name: 'owner_name', example: '{{owner_name}}', note: 'Whoever owns the contact.' },
    { name: 'owner_email', example: '{{owner_email}}', note: '' },
    { name: 'sender_name', example: '{{sender_name}}', note: 'The mailbox sending it.' },
    { name: 'custom.<field>', example: '{{custom.industry}}', note: 'Any custom field.' },
  ]
}
