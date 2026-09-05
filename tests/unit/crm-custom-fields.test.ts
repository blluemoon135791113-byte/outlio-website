/**
 * Typed custom fields — M2 Phase 2.
 *
 * The database enforces SHAPE; this file is where TYPE is enforced, so these
 * tests are the only thing standing between a definition that says "number"
 * and a value that says "banana".
 */
import { describe, expect, it } from 'vitest'

import {
  validateCustomFieldDefinition,
  validateCustomFieldValue,
  type CustomFieldDefinition,
  type CustomFieldType,
} from '@/lib/crm/custom-fields'
import { normalizeTagName } from '@/lib/crm/normalize'

function field(
  fieldType: CustomFieldType,
  over: Partial<CustomFieldDefinition> = {},
): CustomFieldDefinition {
  return {
    key: 'test_field',
    label: 'Test field',
    fieldType,
    options: [],
    isRequired: false,
    ...over,
  }
}

const ok = (definition: CustomFieldDefinition, raw: unknown) => {
  const result = validateCustomFieldValue(definition, raw)
  if (!result.ok) throw new Error(`expected success, got: ${result.reason}`)
  return result.value
}

const rejected = (definition: CustomFieldDefinition, raw: unknown) =>
  validateCustomFieldValue(definition, raw).ok === false

// ---------------------------------------------------------------------------
// Blank and required
// ---------------------------------------------------------------------------

describe('blank values', () => {
  const BLANKS = [null, undefined, '', '   ', []]

  it('are null on an optional field, whatever shape the blank arrived in', () => {
    for (const type of ['text', 'number', 'boolean', 'date', 'url', 'email'] as const) {
      for (const blank of BLANKS) {
        expect(ok(field(type), blank)).toBeNull()
      }
    }
  })

  it('are rejected on a required field', () => {
    for (const blank of BLANKS) {
      expect(rejected(field('text', { isRequired: true }), blank)).toBe(true)
    }
  })

  it('distinguish "no value" from "invalid value"', () => {
    // Both are falsy to a careless caller; only one is an error.
    expect(validateCustomFieldValue(field('number'), '')).toEqual({ ok: true, value: null })
    expect(validateCustomFieldValue(field('number'), 'banana').ok).toBe(false)
  })

  it('treats false and zero as values, not blanks', () => {
    expect(ok(field('boolean', { isRequired: true }), false)).toBe(false)
    expect(ok(field('number', { isRequired: true }), 0)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Per type
// ---------------------------------------------------------------------------

describe('text', () => {
  it('trims', () => {
    expect(ok(field('text'), '  hello  ')).toBe('hello')
  })

  it('rejects a non-string', () => {
    expect(rejected(field('text'), 42)).toBe(true)
    expect(rejected(field('text'), { a: 1 })).toBe(true)
  })

  it('rejects text beyond the limit', () => {
    expect(ok(field('text'), 'a'.repeat(5000))).toHaveLength(5000)
    expect(rejected(field('text'), 'a'.repeat(5001))).toBe(true)
  })
})

describe('number', () => {
  it('accepts numbers and numeric strings alike', () => {
    expect(ok(field('number'), 42)).toBe(42)
    expect(ok(field('number'), ' 42 ')).toBe(42)
    expect(ok(field('number'), '-3.5')).toBe(-3.5)
    expect(ok(field('number'), '.5')).toBe(0.5)
    expect(ok(field('number'), '1e3')).toBe(1000)
  })

  it('accepts thousands separators, which every spreadsheet emits', () => {
    expect(ok(field('number'), '1,250,000')).toBe(1250000)
  })

  it('rejects anything that is not a number', () => {
    for (const value of ['banana', '12px', '1.2.3', '--5', NaN, Infinity, true, {}]) {
      expect(rejected(field('number'), value)).toBe(true)
    }
  })
})

describe('boolean', () => {
  it('accepts the shapes a checkbox, a CSV and a JSON body produce', () => {
    for (const truthy of [true, 1, 'true', 'TRUE', 'yes', 'y', '1', 'on']) {
      expect(ok(field('boolean'), truthy)).toBe(true)
    }
    for (const falsy of [false, 0, 'false', 'No', 'n', '0', 'off']) {
      expect(ok(field('boolean'), falsy)).toBe(false)
    }
  })

  it('NEVER coerces an unrecognised value', () => {
    // "maybe" quietly becoming false is how a filter starts lying.
    for (const value of ['maybe', 'null', 2, -1, {}]) {
      expect(rejected(field('boolean'), value)).toBe(true)
    }
  })
})

describe('date', () => {
  it('accepts a real ISO date', () => {
    expect(ok(field('date'), '2026-08-30')).toBe('2026-08-30')
    // 2028 IS a leap year; 2026 is not. Getting this backwards in a fixture is
    // how you end up "fixing" a validator that was right.
    expect(ok(field('date'), '  2028-02-29  ')).toBe('2028-02-29')
  })

  it('rejects a date that matches the pattern but does not exist', () => {
    // JavaScript rolls these forward rather than failing, which is exactly why
    // a regex alone is not enough.
    for (const value of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-02-29']) {
      expect(rejected(field('date'), value)).toBe(true)
    }
  })

  it('rejects 29 February in a non-leap year', () => {
    expect(rejected(field('date'), '2027-02-29')).toBe(true)
    expect(rejected(field('date'), '2100-02-29')).toBe(true) // century, not a leap year
    expect(ok(field('date'), '2000-02-29')).toBe('2000-02-29') // divisible by 400
  })

  it('rejects other date formats rather than guessing the order', () => {
    // 03/04/2026 is two different days depending on where you live.
    for (const value of ['03/04/2026', '30 Aug 2026', '2026-8-3', '20260830']) {
      expect(rejected(field('date'), value)).toBe(true)
    }
  })
})

describe('url', () => {
  it('accepts http and https, and adds a scheme when one is missing', () => {
    expect(ok(field('url'), 'https://acme.com/pricing')).toBe('https://acme.com/pricing')
    expect(ok(field('url'), 'acme.com')).toBe('https://acme.com/')
    expect(ok(field('url'), 'http://acme.com')).toBe('http://acme.com/')
  })

  it('REJECTS dangerous schemes', () => {
    // These parse as URLs, get stored, get rendered, and get clicked.
    for (const value of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ]) {
      expect(rejected(field('url'), value)).toBe(true)
    }
  })

  it('rejects input that is not a link', () => {
    for (const value of ['not a url', 'http://', 'localhost', 42]) {
      expect(rejected(field('url'), value)).toBe(true)
    }
  })
})

describe('email', () => {
  it('normalizes through the same path a contact email takes', () => {
    expect(ok(field('email'), '  Sam@Example.COM ')).toBe('sam@example.com')
    expect(ok(field('email'), 'Sam Ellis <sam@acme.com>')).toBe('sam@acme.com')
  })

  it('stores the contactable address, never the folded identity key', () => {
    // Folding here would put an address the person never gave us into a field
    // someone will later copy into a To: line.
    expect(ok(field('email'), 'j.doe+tag@gmail.com')).toBe('j.doe+tag@gmail.com')
  })

  it('rejects an invalid address', () => {
    for (const value of ['not-an-email', 'sam@', '@acme.com', 'sam@acme', 42]) {
      expect(rejected(field('email'), value)).toBe(true)
    }
  })
})

describe('select', () => {
  const single = field('select', { options: ['Hot', 'Warm', 'Cold'] })

  it('accepts an option and stores it as the definition spells it', () => {
    expect(ok(single, 'Hot')).toBe('Hot')
    expect(ok(single, '  hot ')).toBe('Hot')
    expect(ok(single, 'HOT')).toBe('Hot')
  })

  it('rejects anything not on the list', () => {
    expect(rejected(single, 'Lukewarm')).toBe(true)
    expect(rejected(single, 42)).toBe(true)
  })
})

describe('multi_select', () => {
  const multi = field('multi_select', { options: ['Hot', 'Warm', 'Cold'] })

  it('accepts a list and canonicalizes each entry', () => {
    expect(ok(multi, ['hot', 'COLD'])).toEqual(['Hot', 'Cold'])
  })

  it('accepts a bare string, so a CSV cell needs no special case', () => {
    expect(ok(multi, 'Hot')).toEqual(['Hot'])
  })

  it('deduplicates', () => {
    // Otherwise selecting one option twice changes how many records a filter
    // reports as carrying it.
    expect(ok(multi, ['Hot', 'hot', ' HOT '])).toEqual(['Hot'])
  })

  it('skips blank entries rather than failing a whole import row', () => {
    expect(ok(multi, ['Hot', '', '  '])).toEqual(['Hot'])
  })

  it('is null when every entry was blank, unless required', () => {
    expect(ok(multi, ['', '  '])).toBeNull()
    expect(rejected(field('multi_select', { options: ['Hot'], isRequired: true }), ['', ' '])).toBe(
      true,
    )
  })

  it('rejects an unknown option, naming it', () => {
    const result = validateCustomFieldValue(multi, ['Hot', 'Lukewarm'])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('Lukewarm')
  })

  it('rejects a list longer than the cap', () => {
    const many = field('multi_select', {
      options: Array.from({ length: 60 }, (_, i) => `opt${i}`),
    })
    expect(rejected(many, Array.from({ length: 51 }, (_, i) => `opt${i}`))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

describe('validateCustomFieldDefinition', () => {
  it('accepts a well-formed text field', () => {
    expect(
      validateCustomFieldDefinition({ key: 'deal_notes', label: 'Deal notes', fieldType: 'text' }),
    ).toEqual({ ok: true, options: [] })
  })

  it('enforces the same key rule as the CHECK constraint in 0071', () => {
    for (const key of ['Deal', '1deal', 'deal-notes', 'deal notes', '', 'a'.repeat(50), 'déal']) {
      expect(validateCustomFieldDefinition({ key, label: 'x', fieldType: 'text' }).ok).toBe(false)
    }
    expect(validateCustomFieldDefinition({ key: 'a', label: 'x', fieldType: 'text' }).ok).toBe(true)
  })

  it('requires a usable label', () => {
    expect(validateCustomFieldDefinition({ key: 'k', label: '   ', fieldType: 'text' }).ok).toBe(
      false,
    )
    expect(
      validateCustomFieldDefinition({ key: 'k', label: 'a'.repeat(81), fieldType: 'text' }).ok,
    ).toBe(false)
  })

  it('requires options on a choice field', () => {
    expect(validateCustomFieldDefinition({ key: 'k', label: 'K', fieldType: 'select' }).ok).toBe(
      false,
    )
    expect(
      validateCustomFieldDefinition({
        key: 'k',
        label: 'K',
        fieldType: 'multi_select',
        options: [],
      }).ok,
    ).toBe(false)
  })

  it('refuses options on a field that cannot use them', () => {
    // They would imply a constraint nothing enforces.
    expect(
      validateCustomFieldDefinition({
        key: 'k',
        label: 'K',
        fieldType: 'text',
        options: ['a'],
      }).ok,
    ).toBe(false)
  })

  it('trims options and rejects case-insensitive duplicates', () => {
    expect(
      validateCustomFieldDefinition({
        key: 'k',
        label: 'K',
        fieldType: 'select',
        options: [' Hot ', 'Cold'],
      }),
    ).toEqual({ ok: true, options: ['Hot', 'Cold'] })

    // Two options that resolve identically could never both be selected.
    expect(
      validateCustomFieldDefinition({
        key: 'k',
        label: 'K',
        fieldType: 'select',
        options: ['Hot', 'hot'],
      }).ok,
    ).toBe(false)
  })

  it('rejects blank and non-string options', () => {
    for (const options of [[''], ['  '], [42], [null], ['a'.repeat(201)]]) {
      expect(
        validateCustomFieldDefinition({ key: 'k', label: 'K', fieldType: 'select', options }).ok,
      ).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

describe('normalizeTagName', () => {
  it('keeps the display casing and lowercases the identity', () => {
    expect(normalizeTagName('  Hot   Lead ')).toEqual({
      name: 'Hot Lead',
      normalizedName: 'hot lead',
    })
  })

  it('makes case and spacing variants one tag', () => {
    const keys = new Set(
      ['Hot Lead', 'hot lead', 'HOT   LEAD', ' Hot Lead '].map(
        (v) => normalizeTagName(v)?.normalizedName,
      ),
    )
    expect(keys).toEqual(new Set(['hot lead']))
  })

  it('rejects a tag that is not a word', () => {
    for (const value of ['', '   ', '---', 'a'.repeat(61), null, undefined]) {
      expect(normalizeTagName(value)).toBeNull()
    }
  })
})
