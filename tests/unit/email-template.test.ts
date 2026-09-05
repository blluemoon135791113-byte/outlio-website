/**
 * Template variables — M6 Phase 16.
 *
 * ⚠️ THE CENTRAL TEST IN THIS FILE IS THAT A MISSING VALUE REFUSES TO RENDER.
 *
 * "Hi ," is the single most recognisable mass-mail failure there is. Every
 * other behaviour here is ordinary string handling; that one is the product
 * decision.
 */
import { describe, expect, it } from 'vitest'

import {
  contextFor,
  parseTemplate,
  previewTemplate,
  renderTemplate,
  TEMPLATE_VARIABLES,
  validateTemplate,
  type TemplateContext,
} from '@/lib/email/template'

const dana: TemplateContext = {
  values: {
    first_name: 'Dana',
    last_name: 'Reyes',
    full_name: 'Dana Reyes',
    company_name: 'Northwind',
    job_title: null,
    owner_name: 'Sam Okafor',
  },
  custom: { industry: 'Logistics', region: null },
}

describe('a missing value refuses to render', () => {
  it('does NOT produce "Hi ,"', () => {
    const result = renderTemplate('Hi {{first_name}},', { values: {} })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.missing).toEqual(['first_name'])
  })

  it('does not leave the raw token in the message either', () => {
    // "Hi {{first_name}}," is worse than "Hi ," — it leaks the tooling.
    const result = renderTemplate('Hi {{first_name}},', { values: {} })
    expect(result.ok).toBe(false)
  })

  it('treats whitespace-only as missing', () => {
    const result = renderTemplate('Hi {{first_name}},', { values: { first_name: '   ' } })
    expect(result.ok).toBe(false)
  })

  it('reports every missing variable at once, not just the first', () => {
    // One round trip should tell the customer everything to fix.
    const result = renderTemplate('{{first_name}} at {{company_name}} ({{job_title}})', {
      values: {},
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.missing.sort()).toEqual(['company_name', 'first_name', 'job_title'])
    }
  })

  it('does not repeat a variable used twice', () => {
    const result = renderTemplate('{{first_name}} {{first_name}}', { values: {} })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.missing).toEqual(['first_name'])
  })
})

describe('fallbacks are the one-keystroke answer', () => {
  it('uses the fallback when the value is missing', () => {
    const result = renderTemplate('Hi {{first_name|there}},', { values: {} })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.text).toBe('Hi there,')
  })

  it('prefers the real value over the fallback', () => {
    const result = renderTemplate('Hi {{first_name|there}},', dana)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.text).toBe('Hi Dana,')
  })

  it('accepts a multi-word fallback', () => {
    const result = renderTemplate('at {{company_name|your company}}', { values: {} })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.text).toBe('at your company')
  })

  it('tolerates spacing inside the braces', () => {
    const result = renderTemplate('Hi {{ first_name | there }},', { values: {} })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.text).toBe('Hi there,')
  })
})

describe('nothing is inferred', () => {
  it('does not derive a first name from a full name', () => {
    /*
     * CLAUDE.md rule 4. Slicing "Dana" out of "Dana Reyes" is guessing: names
     * do not reliably split that way across cultures, and a wrong guess puts
     * the wrong name in a stranger's inbox.
     */
    const result = renderTemplate('Hi {{first_name}}', {
      values: { full_name: 'Dana Reyes' },
    })
    expect(result.ok).toBe(false)
  })

  it('builds a context without deriving anything', () => {
    const ctx = contextFor({ contact: { fullName: 'Dana Reyes' } })
    expect(ctx.values.first_name).toBeNull()
    expect(ctx.values.full_name).toBe('Dana Reyes')
  })
})

describe('custom fields', () => {
  it('renders a custom field', () => {
    const result = renderTemplate('You work in {{custom.industry}}.', dana)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.text).toBe('You work in Logistics.')
  })

  it('refuses a missing custom field with no fallback', () => {
    const result = renderTemplate('In {{custom.region}}.', dana)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.missing).toEqual(['custom.region'])
  })
})

describe('HTML values are escaped', () => {
  it('escapes a name containing markup', () => {
    // A contact name is attacker-controlled; unescaped it would break the
    // email or inject markup into it.
    const result = renderTemplate('<p>Hi {{first_name}}</p>', {
      values: { first_name: '<script>alert(1)</script>' },
    }, { html: true })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.text).not.toContain('<script>')
      expect(result.text).toContain('&lt;script&gt;')
    }
  })

  it('escapes an ampersand, which is the case that actually happens', () => {
    const result = renderTemplate('{{company_name}}', {
      values: { company_name: 'Marks & Spencer' },
    }, { html: true })
    if (result.ok) expect(result.text).toBe('Marks &amp; Spencer')
  })

  it('does NOT escape in plain text', () => {
    const result = renderTemplate('{{company_name}}', {
      values: { company_name: 'Marks & Spencer' },
    })
    if (result.ok) expect(result.text).toBe('Marks & Spencer')
  })
})

describe('validation fails in front of the author', () => {
  it('accepts a template using only known variables', () => {
    expect(validateTemplate('Hi {{first_name|there}} at {{company_name}}').valid).toBe(true)
  })

  it('rejects an unknown variable', () => {
    const result = validateTemplate('Hi {{nonsense}}')
    expect(result.valid).toBe(false)
  })

  it('suggests the right spelling for a near miss', () => {
    // `{{firstname}}` vs `{{first_name}}` is the mistake people actually make.
    const result = validateTemplate('Hi {{firstname}}')
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors[0]).toContain('{{first_name}}')
  })

  it('catches an unclosed brace', () => {
    // Otherwise it ships literally and reveals the tool being used.
    const result = validateTemplate('Hi {{first_name')
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors[0]).toContain('unclosed')
  })

  it('rejects a custom field that does not exist, when the list is known', () => {
    const result = validateTemplate('{{custom.nope}}', ['industry'])
    expect(result.valid).toBe(false)
  })

  it('allows any custom field when the list is not supplied', () => {
    expect(validateTemplate('{{custom.anything}}').valid).toBe(true)
  })
})

describe('preview marks gaps instead of hiding them', () => {
  it('shows a visible placeholder rather than a blank', () => {
    // A preview that silently collapses a gap makes a broken template look
    // fine — the opposite of the preview's job.
    const { text, missing } = previewTemplate('Hi {{first_name}},', { values: {} })
    expect(text).toBe('Hi [no first name],')
    expect(missing).toEqual(['first_name'])
  })

  it('reports nothing missing when a fallback covers it', () => {
    const { text, missing } = previewTemplate('Hi {{first_name|there}},', { values: {} })
    expect(text).toBe('Hi there,')
    expect(missing).toEqual([])
  })
})

describe('parsing is bounded and safe', () => {
  it('finds every token with its fallback', () => {
    const tokens = parseTemplate('{{a_b}} {{c_d|x y}}')
    expect(tokens).toHaveLength(2)
    expect(tokens[1]!.fallback).toBe('x y')
  })

  it('does not hang on a pathological template', () => {
    /*
     * Templates are customer-supplied. A pattern with nested quantifiers can
     * be driven into catastrophic backtracking by input like this, hanging the
     * worker that renders it.
     */
    const hostile = `${'{{'.repeat(5000)}first_name`
    const started = Date.now()
    parseTemplate(hostile)
    validateTemplate(hostile)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('exposes a stable variable list', () => {
    expect(TEMPLATE_VARIABLES).toContain('first_name')
    expect(TEMPLATE_VARIABLES).toContain('owner_name')
  })
})
