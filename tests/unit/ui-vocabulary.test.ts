/**
 * One button, one field, one feedback line — Phase 24.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ MEASURED BEFORE ANY OF IT WAS WRITTEN:                                ║
 * ║                                                                           ║
 * ║    148  distinct button class strings in the authenticated product        ║
 * ║     24  distinct input class strings                                      ║
 * ║     94  role="alert"/"status" blocks, in 31 distinct styles               ║
 * ║      0  shared form or button primitives                                  ║
 * ║                                                                           ║
 * ║  Operate mode states the rule these break in one line: "If the save       ║
 * ║  button looks different in two places, one is wrong." It looked different ║
 * ║  in 148, and no reviewer could hold them all in their head — which is     ║
 * ║  exactly why this has to be a test rather than a convention.              ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')

function filesUnder(dir: string, ext: string): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...filesUnder(full, ext))
    else if (entry.endsWith(ext)) out.push(full)
  }
  return out
}

/**
 * ⚠️ MARKETING IS EXCLUDED, NOT POLICED. `app/page.tsx` and
 * `components/leadengine/**` are read-only by CLAUDE.md rule 5, and the coral
 * landing page deliberately does not share the product's blue vocabulary.
 * Asserting against it would either fail forever or force an edit the rules
 * forbid.
 */
const PRODUCT_DIRS = [
  join(ROOT, 'app', '(product)'),
  join(ROOT, 'app', '(auth)'),
  join(ROOT, 'components'),
]

const EXCLUDE = /components\/(leadengine|ui\/(floating-dots-cta|orbital-hero-section|singularity-hero-scene))/

function productFiles(): { rel: string; source: string }[] {
  const out: { rel: string; source: string }[] = []
  for (const dir of PRODUCT_DIRS) {
    for (const file of filesUnder(dir, '.tsx')) {
      const rel = relative(ROOT, file)
      if (EXCLUDE.test(rel)) continue
      out.push({ rel, source: readFileSync(file, 'utf8') })
    }
  }
  return out
}

/**
 * ⚠️ COMMENTS STRIPPED BEFORE EVERY MATCH, AND THIS FILE IS THE PROOF IT
 * MATTERS. The script that fixed the fading-hover defect across 26 files
 * rewrote the paragraph in `Button.tsx` that DESCRIBED the defect, because the
 * prose contained the string it was replacing. Same trap, at least eight times
 * in this repository now.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
}

describe('the scanner sees what it polices', () => {
  const files = productFiles()

  it('scans a believable number of product files', () => {
    /*
     * Without this, a path typo empties the list and every assertion below
     * passes against nothing — the vacuity this project has been bitten by
     * before.
     */
    expect(files.length).toBeGreaterThan(80)
  })

  it('strips comments rather than matching the argument', () => {
    const button = readFileSync(join(ROOT, 'components/ui/Button.tsx'), 'utf8')
    // The banner quotes the fading hover it exists to forbid.
    expect(button, 'the rationale was deleted').toMatch(/fading hover/i)
    expect(code(button)).not.toMatch(/fading hover/i)
  })
})

describe('a filled button darkens on hover, never fades', () => {
  it('no accent-filled control in the product fades', () => {
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  ⚠️ 42 BUTTONS DID THIS, AND IT IS A DEFECT RATHER THAN A PREFERENCE.  ║
     * ║                                                                       ║
     * ║  Fading a filled button blends it toward the page, so the contrast     ║
     * ║  between label and background DROPS at the moment the pointer          ║
     * ║  arrives. Hover then says "less available" when it should say "more".  ║
     * ║  `--accent-deep` exists for this and CLAUDE.md records it              ║
     * ║  contrast-measured at 6.70 on `--panel`.                              ║
     * ║                                                                       ║
     * ║  Asserted per LINE, because a file can legitimately contain both a     ║
     * ║  filled button and an unfilled control that fades.                     ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    const offenders: string[] = []
    for (const { rel, source } of productFiles()) {
      for (const [i, line] of code(source).split('\n').entries()) {
        if (line.includes('bg-accent') && line.includes('hover:opacity-')) {
          offenders.push(`${rel}:${i + 1}`)
        }
      }
    }
    expect(
      offenders,
      'A filled button must darken (hover:bg-accent-deep), not fade — fading lowers ' +
        `contrast exactly when the pointer arrives:\n${offenders.join('\n')}`,
    ).toEqual([])
  })
})

describe('the primitives exist and own their states', () => {
  const button = code(readFileSync(join(ROOT, 'components/ui/Button.tsx'), 'utf8'))
  const field = code(readFileSync(join(ROOT, 'components/ui/Field.tsx'), 'utf8'))
  const feedback = code(readFileSync(join(ROOT, 'components/ui/Feedback.tsx'), 'utf8'))

  it('the button names every variant it claims', () => {
    for (const variant of ['primary', 'secondary', 'outline', 'ghost', 'danger']) {
      expect(button, `${variant} is declared in the type but has no styles`).toMatch(
        new RegExp(`${variant}:`),
      )
    }
  })

  it('disabled means the cursor says so, not just the opacity', () => {
    /*
     * ⚠️ THE EXISTING PRODUCT-WIDE PATTERN IS `disabled:opacity-60` ALONE, which
     * dims the control while the pointer still reports "clickable". A user then
     * clicks a greyed button repeatedly and nothing acknowledges them.
     */
    expect(button).toMatch(/disabled:cursor-not-allowed/)
    expect(field).toMatch(/disabled:cursor-not-allowed/)
  })

  it('does NOT redeclare a focus ring', () => {
    /*
     * ⚠️ `globals.css` ALREADY OWNS IT: a global `:focus-visible` outline plus
     * an accent-coloured variant for product buttons. The 34 scattered
     * `focus-visible:border-accent` usages in the product are a second ring
     * arriving one component at a time; the primitives must not start a third.
     */
    expect(button, 'the button started a second focus-ring system').not.toMatch(/focus-visible:/)
    expect(field, 'the field started a second focus-ring system').not.toMatch(/focus-visible:/)
  })

  it('keeps motion inside the project cap', () => {
    // DESIGN_TOKENS: motion ≤150ms in the product.
    for (const [name, src] of [['Button', button], ['Field', field]] as const) {
      const durations = [...src.matchAll(/duration-(\d+)/g)].map((m) => Number(m[1]))
      for (const ms of durations) {
        expect(ms, `${name} animates for ${ms}ms, over the 150ms cap`).toBeLessThanOrEqual(150)
      }
    }
  })

  it('ties the alert role to the tone so they cannot disagree', () => {
    /*
     * ⚠️ THE ROLE IS THE PART THAT MATTERS. `alert` interrupts and is announced
     * immediately; `status` is polite. Reversing them either makes a success
     * message shout over whatever the user was reading, or leaves a failure
     * completely silent. A component taking `role` and colour separately allows
     * exactly that pairing.
     */
    expect(feedback).toMatch(/error: \{ role: 'alert'/)
    expect(feedback).toMatch(/success: \{ role: 'status'/)
  })

  it('makes an empty state explain itself', () => {
    /*
     * Operate: "Empty states that teach the interface, not 'nothing here.'"
     * There are 36 in this product; `body` is a required prop so the next one
     * cannot be a dead end.
     */
    expect(feedback).toMatch(/body: ReactNode/)
    expect(feedback, 'body became optional, so an empty state can say nothing').not.toMatch(
      /body\?: ReactNode/,
    )
  })

  it('renders figures with tabular numerals', () => {
    /*
     * ⚠️ PROPORTIONAL FIGURES CHANGE WIDTH PER DIGIT, so a row of stats jitters
     * whenever a count ticks over and a column of them never aligns. One class,
     * invisible until it is missing.
     */
    expect(feedback).toMatch(/tabular-nums/)
  })
})

describe('stat cards are two-up on a phone', () => {
  it('does not stack four numbers into four screens', () => {
    /*
     * ⚠️ MEASURED: THE DASHBOARD WAS 3,497px TALL ON A 347px VIEWPORT — five
     * screens of scroll for a handful of figures, because every stat grid began
     * at one column and only went two-up at `sm` (640px). A stat card holds a
     * label and a number; it fits half a phone.
     *
     * ⚠️ ASSERTED ON THE STAT GRIDS ONLY. A contact's field list and the saved-
     * list cards legitimately keep full width on a phone — they hold prose.
     */
    const rows = [
      'components/product/PerformanceRow.tsx',
      'app/(product)/crm/reports/page.tsx',
      'app/(product)/crm/reports/dashboards/[id]/page.tsx',
    ]
    for (const rel of rows) {
      const src = code(readFileSync(join(ROOT, rel), 'utf8'))
      expect(src, `${rel} has a stat grid that starts at one column`).not.toMatch(
        /grid gap-3 sm:grid-cols-2 (xl|lg):grid-cols-4/,
      )
      expect(src, `${rel} lost its two-up phone layout`).toMatch(/grid-cols-2/)
    }
  })

  it('keeps the delta chip out of a wrapping label', () => {
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  ⚠️ THIS DEFECT WAS INTRODUCED BY THE TWO-UP CHANGE ABOVE AND CAUGHT   ║
     * ║  BY RENDERING, NOT BY READING.                                         ║
     * ║                                                                       ║
     * ║  At 152px "CONTACTS ADDED" wraps. With the chip as a `justify-between` ║
     * ║  sibling of the label it landed in the gap between the two label       ║
     * ║  lines, reading as part of the label text.                             ║
     * ║                                                                       ║
     * ║  The chip now sits beside the FIGURE, which is also where it belongs:  ║
     * ║  "New" describes the number's movement, not the metric's name.         ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    const src = code(readFileSync(join(ROOT, 'components/product/StatCard.tsx'), 'utf8'))
    const label = src.indexOf('{label}')
    const chip = src.indexOf('<DeltaChip')
    const figure = src.indexOf('value.toLocaleString()')
    expect(label).toBeGreaterThan(-1)
    expect(chip).toBeGreaterThan(-1)
    expect(chip, 'the delta chip is back beside the label, where it collides').toBeGreaterThan(
      figure,
    )
  })
})
