/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  CLAUDE.md'S HARD RULES, MADE BINDING.                                   ║
 * ║                                                                           ║
 * ║  Found by mutation testing: adding `dangerouslySetInnerHTML` to a product ║
 * ║  component, and renaming the service-role key to a `NEXT_PUBLIC_` var,    ║
 * ║  both left all 3,024 tests green. They were rules in a document that      ║
 * ║  nothing in the build could see.                                          ║
 * ║                                                                           ║
 * ║  A rule nothing enforces is a rule that survives exactly as long as       ║
 * ║  everyone remembers it.                                                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      out.push(...sourceFiles(path))
    } else if (/\.tsx?$/.test(path)) {
      out.push(path)
    }
  }
  return out
}

/**
 * Rule 3: never render uploaded HTML in a browser.
 *
 * ⚠️ AN ALLOWLIST, NOT A BAN, because a flat ban is false. Four uses are
 * legitimate and first-party: three serialise JSON-LD we build ourselves, and
 * one is the Google Tag Manager snippet. None of them render anything that
 * came from outside.
 *
 * The list MAY ONLY SHRINK. A new entry means someone decided to inject HTML,
 * and that decision should be visible in a diff rather than absorbed silently.
 */
const INNER_HTML_ALLOWED = new Map<string, string>([
  ['app/layout.tsx', 'Google Tag Manager snippet — static, first-party.'],
  ['app/components/Breadcrumbs.tsx', 'JSON-LD via serializeJsonLd.'],
  ['app/components/FAQSchema.tsx', 'JSON-LD via serializeJsonLd.'],
])

const DANGEROUS = /dangerouslySetInnerHTML|\.innerHTML\s*=|srcdoc/

/** Comments are prose about the rule, not uses of it. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
}

describe('rule 3 — uploaded HTML is never rendered', () => {
  const files = [...sourceFiles(join(ROOT, 'app')), ...sourceFiles(join(ROOT, 'components')), ...sourceFiles(join(ROOT, 'lib'))]

  it('scans a believable number of files', () => {
    // Guards against the sweep silently walking nothing.
    expect(files.length).toBeGreaterThan(200)
  })

  it('has no HTML injection outside the allowlist', () => {
    const offenders = files
      .map((f) => relative(ROOT, f))
      .filter((name) => !INNER_HTML_ALLOWED.has(name))
      .filter((name) => DANGEROUS.test(code(join(ROOT, name))))

    expect(
      offenders,
      'CLAUDE.md rule 3: uploaded HTML must never reach a browser. Parsing is ' +
        'server-side only. If this is first-party markup, add it to ' +
        'INNER_HTML_ALLOWED with a reason.',
    ).toEqual([])
  })

  it('keeps the allowlist honest', () => {
    /*
     * An entry that no longer injects anything is a licence nobody is using.
     * Left in place it silently permits a future one.
     */
    for (const [name, reason] of INNER_HTML_ALLOWED) {
      expect(reason.length, `${name} needs a reason`).toBeGreaterThan(10)
      expect(
        DANGEROUS.test(code(join(ROOT, name))),
        `${name} is allowlisted but no longer injects HTML — remove the entry.`,
      ).toBe(true)
    }
  })
})

describe('rule 6 — the service role key is never client-visible', () => {
  const files = [
    ...sourceFiles(join(ROOT, 'app')),
    ...sourceFiles(join(ROOT, 'components')),
    ...sourceFiles(join(ROOT, 'lib')),
  ]

  it('never prefixes a service-role or secret env var with NEXT_PUBLIC_', () => {
    /*
     * ⚠️ THE PREFIX IS THE WHOLE MECHANISM. Next inlines every NEXT_PUBLIC_
     * variable into the client bundle. Renaming the key is not a typo, it is
     * publishing the credential that bypasses RLS on every table.
     */
    const bad = /NEXT_PUBLIC_[A-Z0-9_]*(SERVICE_ROLE|SECRET_KEY|ENCRYPTION_KEY|CRON_SECRET)/
    const offenders = files
      .filter((f) => bad.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f))

    expect(offenders, 'a server-only secret is named as a public variable').toEqual([])
  })

  it('checks .env.example too, where the name is first copied from', () => {
    let example = ''
    try {
      example = readFileSync(join(ROOT, '.env.example'), 'utf8')
    } catch {
      return
    }
    expect(example).not.toMatch(
      /NEXT_PUBLIC_[A-Z0-9_]*(SERVICE_ROLE|SECRET_KEY|ENCRYPTION_KEY|CRON_SECRET)/,
    )
  })
})

/**
 * Design rule: zero hardcoded colours on authenticated surfaces.
 *
 * ⚠️ SCOPED, AND THE SCOPE IS MEASURED. The marketing site legitimately holds
 * hundreds of literal colours — `components/leadengine` alone has 266, and
 * `orbital-hero-section.tsx` is a hand-tuned gradient. Rule 5 forbids touching
 * the landing page at all. Applying this everywhere would fail on arrival and
 * be deleted; applying it where the rule actually holds makes it stick.
 */
const PRODUCT_SURFACES = [
  'app/(product)',
  'app/admin',
  'components/crm',
  'components/email',
  'components/admin',
]

describe('design — the product uses tokens, not literal colours', () => {
  const COLOUR = /(#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\()/

  for (const surface of PRODUCT_SURFACES) {
    it(`${surface} has no literal colour`, () => {
      const files = sourceFiles(join(ROOT, surface))
      expect(files.length, `${surface} matched no files — has it moved?`).toBeGreaterThan(0)

      const offenders = files
        .filter((f) => COLOUR.test(code(f)))
        .map((f) => relative(ROOT, f))

      expect(
        offenders,
        'Authenticated surfaces use the theme tokens so a palette change reaches ' +
          'every screen. See docs/DESIGN_TOKENS.md.',
      ).toEqual([])
    })
  }
})

/**
 * The E2E harness must never adopt a server it did not start.
 *
 * ⚠️ THIS PINS AN INCIDENT, NOT A PREFERENCE. On 2026-09-07 a plain
 * `npm run dev` — which reads `.env.local`, i.e. PRODUCTION — was left
 * listening on port 3000. Playwright reused it, so E2E fixtures were written to
 * staging while the browser signed in against production. Five specs failed and
 * looked like five product bugs.
 *
 * The dangerous variant is the one that does NOT fail: a spec that signs up
 * would have created real accounts in the live database and reported green.
 *
 * `reuseExistingServer: !process.env.CI` reads like a safe optimisation, which
 * is exactly why it will be reintroduced by someone speeding up local runs.
 */
describe('e2e harness — no cross-environment server reuse', () => {
  const config = code(join(ROOT, 'playwright.config.ts'))

  it('playwright.config.ts never reuses an existing server', () => {
    const setting = config.match(/reuseExistingServer:\s*([^,\n]+)/)

    expect(setting, 'reuseExistingServer disappeared — Playwright defaults it to TRUE off CI').not.toBeNull()
    expect(
      setting![1].trim(),
      'A reused server may point at ANY environment, including production. ' +
        'Playwright cannot tell `dev:staging` from `dev`. Starting our own ' +
        'server costs one boot; reusing costs silent production writes.',
    ).toBe('false')
  })

  it('the harness still starts the staging server itself', () => {
    expect(
      config,
      'Without dev:staging the suite runs against .env.local — production.',
    ).toContain("command: 'npm run dev:staging'")
  })
})

/**
 * Design rule: every screen ships a designed loading, empty and error state.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE RULE WAS WRITTEN DOWN AND TWO THIRDS OF IT WAS UNIMPLEMENTED.        ║
 * ║                                                                           ║
 * ║  38 product pages, and before 2026-09-09 there was no `error.tsx` and no   ║
 * ║  `loading.tsx` at ANY level — not per route, not per group, not at the     ║
 * ║  root. Every throw in a Server Component rendered Next's bare             ║
 * ║  "Application error"; every navigation held the previous page with no      ║
 * ║  feedback.                                                                ║
 * ║                                                                           ║
 * ║  Empty states were the two-thirds that did exist, written per screen.      ║
 * ║  They are not checkable structurally — an empty state is prose inside a    ║
 * ║  conditional — so this guard covers the two that are files.               ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
describe('design — the product has loading and error states', () => {
  const GROUP = join(ROOT, 'app', '(product)')

  it('the product group has an error boundary', () => {
    expect(
      existsSync(join(GROUP, 'error.tsx')),
      'Without app/(product)/error.tsx every throw in a Server Component renders ' +
        "Next's bare \"Application error\" page — no navigation, no branding, no way back.",
    ).toBe(true)
  })

  it('the product group has a loading state', () => {
    expect(
      existsSync(join(GROUP, 'loading.tsx')),
      'Without app/(product)/loading.tsx a click holds the previous page until the ' +
        'server resolves, which reads as the click having missed.',
    ).toBe(true)
  })

  it('the error state never shows the error message to the user', () => {
    /*
     * ⚠️ THE DIGEST IS SAFE; THE MESSAGE IS NOT. CLAUDE.md: never return a
     * stack trace, SQL, a storage path or an internal id to the client. In
     * development `error.message` is the real one.
     */
    const source = code(join(GROUP, 'error.tsx'))
    expect(source).toContain('error.digest')
    expect(source, 'error.tsx renders error.message').not.toMatch(/\{\s*error\.message\s*\}/)
    expect(source, 'error.tsx renders a stack').not.toContain('error.stack')
  })

  it('the loading state respects prefers-reduced-motion', () => {
    // House convention, matching ExtractionDashboard's live indicator.
    const source = code(join(GROUP, 'loading.tsx'))
    expect(source).toContain('motion-safe:animate-pulse')
    expect(source, 'an unguarded animate-pulse ignores reduced-motion').not.toMatch(
      /className="[^"]*[^:]animate-pulse/,
    )
  })

  it('announces loading once, not a dozen decorative bars', () => {
    const source = code(join(GROUP, 'loading.tsx'))
    expect(source).toContain('aria-busy')
    expect(source).toContain('sr-only')
    // Every placeholder bar is hidden from assistive tech.
    const bars = source.match(/rounded-\[var\(--radius/g) ?? []
    const hidden = source.match(/aria-hidden/g) ?? []
    expect(hidden.length).toBeGreaterThanOrEqual(bars.length - 2)
  })
})
