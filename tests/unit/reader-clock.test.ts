/**
 * Every timestamp in the product goes through `LocalTime`, and the two that do
 * not say why.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  `LocalTime` EXISTED, WAS CORRECT, AND FIFTEEN PLACES DID NOT USE IT.     ║
 * ║                                                                           ║
 * ║  Its own banner has said since it was written that `toLocaleString()` in  ║
 * ║  a Server Component formats with the SERVER's timezone — "a reply that    ║
 * ║  arrived at 4pm in Karachi renders as 11am to the person who received     ║
 * ║  it". Five such sites were fixed earlier. No guard was added, so eleven   ║
 * ║  more survived, and the fix had to be found a second time.                ║
 * ║                                                                           ║
 * ║  ⚠️ THE COMPONENT WAS BEING ROUTED AROUND FOR A BORING REASON: it took no ║
 * ║  `className`. Six client components hand-rolled the date rather than lose ║
 * ║  their styling, and every one of them lost `suppressHydrationWarning` and ║
 * ║  the machine-readable `dateTime` in the trade. A shared component that    ║
 * ║  cannot be styled is one people stop using.                               ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    let entries: string[]
    try {
      entries = readdirSync(d)
    } catch {
      return
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue
      const full = join(d, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.tsx?$/.test(full)) out.push(full)
    }
  }
  walk(dir)
  return out
}

const PRODUCT = [
  ...sourceFiles(join(ROOT, 'lib')),
  ...sourceFiles(join(ROOT, 'app')),
  ...sourceFiles(join(ROOT, 'components')),
].map((f) => ({
  file: relative(ROOT, f).split('\\').join('/'),
  code: strip(readFileSync(f, 'utf8')),
}))

/** The component that owns reader-clock rendering. */
const OWNER = 'components/ui/LocalTime.tsx'

/**
 * ⚠️ EXEMPT, AND EACH FOR A STATED REASON. Not a list of things to get to —
 * a list of places where a component genuinely cannot render, which is why
 * every one of them pins `timeZone` instead.
 */
const NO_COMPONENT_POSSIBLE = new Set([
  // A string inside a server action's response message. No reader's clock
  // exists there, so it shows the date the billing provider recorded.
  'lib/settings/actions.ts',
])

/**
 * Calls that format a DATE, which is the scope of this file.
 *
 * ⚠️ `someNumber.toLocaleString()` IS DELIBERATELY NOT POLICED HERE, and there
 * are around sixty of them. An unpinned locale on a COUNT renders `1,200` or
 * `1.200` — a cosmetic difference with no timezone in it, and in a client
 * component the reader's own locale is arguably the right answer. A date
 * carries an instant, and getting the zone wrong reports the wrong day. Those
 * are different problems and only the second one is a correctness bug.
 */
function dateCalls(code: string): string[] {
  const explicit = code.match(/\.toLocale(Date|Time)String\([^)]*\)/g) ?? []
  // `toLocaleString` is ambiguous — a Date and a number both have one. It
  // counts only when the receiver is plainly a Date or a date option is passed.
  const onADate: string[] = code.match(/new Date\([^)]*\)\.toLocaleString\([^)]*\)/g) ?? []
  const withDateOptions: string[] =
    code.match(/\.toLocaleString\([^)]*(?:dateStyle|timeStyle|hour:|month:|day:)[^)]*\)/g) ?? []
  return [...explicit, ...onADate, ...withDateOptions]
}

describe('the scanner can see what it polices', () => {
  it('reads the product source and finds the component', () => {
    expect(PRODUCT.length).toBeGreaterThan(300)
    expect(PRODUCT.some((f) => f.file === OWNER)).toBe(true)
  })

  it('tells a date apart from a count', () => {
    /*
     * Vacuity: a matcher that found nothing, or found everything, would make
     * the ratchet below either useless or permanently red.
     */
    expect(dateCalls("d.toLocaleDateString('en-GB')")).toHaveLength(1)
    expect(dateCalls("new Date(x).toLocaleString('en-GB')")).toHaveLength(1)
    expect(dateCalls("d.toLocaleString(undefined, { dateStyle: 'medium' })")).toHaveLength(1)
    expect(dateCalls('total.toLocaleString()'), 'a count was read as a date').toHaveLength(0)
    expect(dateCalls("value.toLocaleString('en-US')")).toHaveLength(0)
  })
})

describe('a timestamp is rendered in the reader’s clock', () => {
  it('nothing formats a date without either the component or a pinned zone', () => {
    /*
     * ⚠️ THE RULE IS "PINNED ZONE OR COMPONENT", NOT "PINNED LOCALE". In a
     * client component an unpinned LOCALE is correct — the reader's locale is
     * the right one. It is the unpinned TIMEZONE that silently moves an
     * instant, and on a Server Component it moves it for every reader at once.
     */
    const offenders = PRODUCT.filter((f) => {
      if (f.file === OWNER || NO_COMPONENT_POSSIBLE.has(f.file)) return false
      return dateCalls(f.code).some((call) => !/timeZone:/.test(call))
    }).map((f) => f.file)

    expect(
      offenders,
      'A date is being formatted without a timezone. In a Server Component ' +
        "that is the server's zone for every reader; in a client component it " +
        'is a hydration mismatch. Use <LocalTime iso={…} /> — it takes a ' +
        'className — or pin timeZone if no component can render there.',
    ).toEqual([])
  })

  it('the exempt file pins a zone rather than being merely exempt', () => {
    /*
     * ⚠️ ASSERTED IN BOTH DIRECTIONS. An exemption list that only removes
     * files from a scan is a way to make a guard quiet; this is what makes it
     * still mean something.
     */
    for (const file of NO_COMPONENT_POSSIBLE) {
      const source = PRODUCT.find((f) => f.file === file)
      expect(source, `${file} is exempt but does not exist`).toBeDefined()
      expect(source!.code, `${file} is exempt and pins nothing`).toMatch(/timeZone: 'UTC'/)
    }
  })
})

describe('the component keeps what the hand-rolled versions dropped', () => {
  const LOCAL_TIME = PRODUCT.find((f) => f.file === OWNER)!.code

  it('carries the machine-readable instant', () => {
    // Available to assistive tech and to anything parsing the page, including
    // before hydration — which the hand-rolled `<span>`s were not.
    expect(LOCAL_TIME).toMatch(/<time dateTime=\{iso\}/)
  })

  it('suppresses the hydration warning, because the difference is by design', () => {
    /*
     * ⚠️ CORRECT HERE AND ESSENTIALLY NOWHERE ELSE. The server cannot know the
     * reader's timezone, so the two passes differ deliberately. Everywhere
     * else a mismatch is a real bug, so this must not spread.
     */
    expect(LOCAL_TIME).toContain('suppressHydrationWarning')

    const others = PRODUCT.filter(
      (f) => f.file !== OWNER && /suppressHydrationWarning/.test(f.code),
    ).map((f) => f.file)
    expect(others, 'hydration warnings are being suppressed outside LocalTime').toEqual([])
  })

  it('accepts a className, which is why it can now be adopted', () => {
    // The styling gap is what the six workarounds were working around.
    expect(LOCAL_TIME).toMatch(/className\?: string/)
    expect(LOCAL_TIME).toMatch(/<time dateTime=\{iso\} className=\{className\}/)
  })
})

describe('the component is actually used, not merely available', () => {
  it('is imported across the product surfaces', () => {
    /*
     * ⚠️ THE RATCHET ABOVE PASSES TRIVIALLY IF EVERY TIMESTAMP IS DELETED.
     * This is the other direction: the dates still render, through one door.
     */
    const importers = PRODUCT.filter((f) =>
      /from '@\/components\/ui\/LocalTime'/.test(f.code),
    ).map((f) => f.file)

    expect(importers.length).toBeGreaterThanOrEqual(12)
    for (const expected of [
      'app/admin/page.tsx',
      'components/crm/TaskList.tsx',
      'components/email/SuppressionList.tsx',
      'components/settings/TeamSettings.tsx',
    ]) {
      expect(importers, `${expected} stopped rendering its timestamp`).toContain(expected)
    }
  })
})
