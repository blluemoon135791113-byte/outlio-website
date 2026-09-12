/**
 * Choosing a variant, and rendering it — §4.9's compile step.
 *
 * ⚠️ IT DOES NOT IMPLEMENT A TEMPLATE ENGINE. `lib/email/template.ts` is
 * already a safe one: a bounded non-backtracking token pattern, HTML escaping,
 * and — the part that matters — a REFUSAL to render a missing value rather than
 * a blank or a left-in token. Writing a second renderer here would be writing a
 * second set of those decisions, and the one that got them wrong would be the
 * one sending to strangers.
 *
 * What this layer adds is the thing that engine cannot express: which variant
 * is permitted, given how well each value is known.
 */
import { renderTemplate } from '@/lib/email/template'
import { TEMPLATES, type LinkedInTemplate, type TemplateId, type Variant } from '@/lib/linkedin/templates'
import {
  usable,
  VARIABLES,
  type Evidenced,
  type VariableName,
} from '@/lib/linkedin/variables'

export type LinkedInContext = Partial<Record<VariableName, Evidenced>>

export type RenderOutcome =
  | { kind: 'rendered'; variantId: string; text: string; subject?: string; usedFallbackVariant: boolean }
  /** No variant could render; §4.9 says drop this touch and continue. */
  | { kind: 'skip'; missing: VariableName[] }
  /** A human must write it. */
  | { kind: 'manual_rewrite'; missing: VariableName[] }
  /** The step cannot proceed at all. */
  | { kind: 'blocked'; missing: VariableName[] }

/** The longest a connection note may render to before it is refused. */
export const CONNECTION_NOTE_LIMIT = 300

/**
 * Which variables a variant cannot fill from this context.
 *
 * A literal fallback counts as filling it — but only where §4.9 states one
 * exactly, which is why `literalFallback` is `null` for most variables rather
 * than an empty string.
 */
function unmet(variant: Variant, context: LinkedInContext): VariableName[] {
  return variant.requires.filter((name) => {
    if (usable(name, context[name])) return false
    return VARIABLES[name].literalFallback === null
  })
}

/** Plain strings for the engine: the evidenced value, or §4.9's literal. */
function flatten(variant: Variant, context: LinkedInContext): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of variant.requires) {
    const evidence = context[name]
    out[name] = usable(name, evidence)
      ? evidence!.value.trim()
      : (VARIABLES[name].literalFallback ?? '')
  }
  return out
}

function renderVariant(
  variant: Variant,
  context: LinkedInContext,
): { ok: true; text: string } | { ok: false; missing: string[] } {
  /*
   * ⚠️ VALUES GO THROUGH `custom.`, WHICH IS NOT A WORKAROUND. The email
   * engine's own namespace is a fixed union of contact fields; LinkedIn
   * variables are a different vocabulary, and `custom` is the documented way to
   * pass one. The engine's refusal behaviour applies identically either way,
   * which is the whole reason for going through it.
   */
  const resolved = flatten(variant, context)

  /*
   * ⚠️ EMPTY APPROVED FALLBACKS ARE APPLIED HERE, NOT BY THE ENGINE — and that
   * is deliberate, not a workaround.
   *
   * `renderTemplate` treats an empty value as MISSING and refuses. That is
   * exactly right for email: its doctrine is that a blank in a sentence is the
   * most recognisable mass-mail failure there is, and relaxing it would relax
   * it for every campaign in the product.
   *
   * But §4.9 gives some variables an approved fallback that IS the empty
   * string — `name_suffix` is one, because "Thanks for connecting." is a
   * correct sentence. That is a LinkedIn editorial decision, so it is settled
   * in the LinkedIn layer before the engine is asked, and the engine keeps its
   * refusal intact for everything else.
   */
  let body = variant.body
  const passed: Record<string, string> = {}
  for (const [name, value] of Object.entries(resolved)) {
    if (value === '') {
      body = body.replace(new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`, 'gi'), '')
    } else {
      passed[name] = value
    }
  }

  body = body.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, '{{custom.$1}}')
  const result = renderTemplate(body, { values: {}, custom: passed })

  if (!result.ok) return { ok: false, missing: result.missing }

  /*
   * ⚠️ A SECOND PASS FINDS WHAT THE FIRST LEFT BEHIND. §4.9 asks for two
   * passes and for unresolved braces to be rejected. A value that itself
   * contains `{{…}}` — a customer pasting a variable into their offer sentence,
   * or a fetched page echoing one — would otherwise reach a recipient as
   * tooling. Nothing is substituted in this pass; anything still matching is a
   * refusal.
   */
  if (/\{\{|\}\}/.test(result.text)) {
    return { ok: false, missing: ['unresolved_token'] }
  }

  return { ok: true, text: tidy(result.text) }
}

/**
 * Repairs the spacing a dropped variable leaves behind.
 *
 * ⚠️ IT NEVER REPAIRS MEANING. `name_suffix` and a handful of others have an
 * empty literal fallback by design — "Thanks for connecting." is a correct
 * sentence — but the naive substitution leaves "connecting ." behind. §4.9
 * rejects "malformed punctuation", and this is the only class of it that is
 * safe to fix silently, because no word has been removed.
 */
function tidy(text: string): string {
  return text
    .replace(/\s+([.,!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/**
 * Renders the best permitted variant of a template.
 *
 * ⚠️ VARIANTS ARE TRIED IN ORDER AND THE FIRST THAT FITS WINS. The order in
 * `templates.ts` is §4.9's preference order — grounded context before a role
 * observation, a real insight before a bare qualification question — so a
 * weaker message is only ever sent because the evidence for a stronger one was
 * absent, never because it was cheaper to produce.
 */
export function renderLinkedInMessage(
  templateId: TemplateId,
  context: LinkedInContext,
): RenderOutcome {
  const template: LinkedInTemplate = TEMPLATES[templateId]

  let lastMissing: VariableName[] = []

  for (const [index, variant] of template.variants.entries()) {
    const gaps = unmet(variant, context)
    if (gaps.length > 0) {
      lastMissing = gaps
      continue
    }

    const rendered = renderVariant(variant, context)
    if (!rendered.ok) {
      lastMissing = rendered.missing as VariableName[]
      continue
    }

    // §4.9: validate the rendered result against the account's observed
    // allowance. "Do not blindly truncate" — an overlong note is refused.
    if (templateId === 'T01' && rendered.text.length > CONNECTION_NOTE_LIMIT) {
      lastMissing = []
      continue
    }

    let subject: string | undefined
    if (template.subject) {
      const subjectVariant = template.subject[0]!
      if (unmet(subjectVariant, context).length > 0) {
        lastMissing = unmet(subjectVariant, context)
        continue
      }
      const renderedSubject = renderVariant(subjectVariant, context)
      // §4.9 rejects blank subjects outright.
      if (!renderedSubject.ok || renderedSubject.text.trim() === '') {
        lastMissing = (renderedSubject.ok ? [] : renderedSubject.missing) as VariableName[]
        continue
      }
      subject = renderedSubject.text
    }

    return {
      kind: 'rendered',
      variantId: variant.id,
      text: rendered.text,
      subject,
      usedFallbackVariant: index > 0,
    }
  }

  const missing = [...new Set(lastMissing)]
  if (template.onExhausted === 'skip') return { kind: 'skip', missing }
  if (template.onExhausted === 'block') return { kind: 'blocked', missing }
  return { kind: 'manual_rewrite', missing }
}
