/**
 * HTML → readable text and code-extracted facts.
 *
 * ⚠️ PARSING ONLY — this HTML is never rendered (CLAUDE.md rule 3), and only
 * the extracted text is stored, so there is no saved markup for a future
 * careless render to find.
 */
import { describe, expect, it } from 'vitest'

import { extractReadable } from '@/lib/hubble/extract/readable'
import { needsBrowser } from '@/lib/hubble/fetch/fetcher'

const BASE = 'https://acme.example/about'

describe('extractReadable', () => {
  it('reads the title, text, and description', () => {
    const page = extractReadable(
      `<html><head><title>About Acme</title>
       <meta name="description" content="Acme builds tools.">
       </head><body><main><h1>About Acme</h1>
       <p>${'Acme was founded in 2019 and builds developer tools. '.repeat(8)}</p>
       </main></body></html>`,
      BASE,
    )

    expect(page.title).toBe('About Acme')
    expect(page.text).toContain('founded in 2019')
    expect(page.structured.metaDescription).toBe('Acme builds tools.')
    expect(page.structured.headings).toContain('About Acme')
  })

  it('STRIPS nav, footer, and script boilerplate', () => {
    const page = extractReadable(
      `<html><body>
        <nav>Home Products Pricing Contact</nav>
        <script>var tracking = "analytics junk";</script>
        <main><p>${'The company builds developer tooling for teams. '.repeat(10)}</p></main>
        <footer>Copyright 2026 all rights reserved cookie policy</footer>
      </body></html>`,
      BASE,
    )

    expect(page.text).toContain('developer tooling')
    expect(page.text).not.toContain('analytics junk')
    expect(page.text).not.toContain('all rights reserved')
  })

  it('reads JSON-LD BEFORE scripts are stripped', () => {
    /*
     * JSON-LD lives in a <script> tag and stripping scripts is the first thing
     * we do. Losing it would mean paying a model to infer what the page
     * already stated in machine-readable form.
     */
    const page = extractReadable(
      `<html><body>
        <script type="application/ld+json">
          {"@type":"Organization","name":"Acme","numberOfEmployees":42}
        </script>
        <main><p>${'Text about the company here. '.repeat(12)}</p></main>
      </body></html>`,
      BASE,
    )

    expect(page.structured.jsonLd).toHaveLength(1)
    expect(page.structured.jsonLd[0]).toMatchObject({ name: 'Acme', numberOfEmployees: 42 })
  })

  it('survives malformed JSON-LD without throwing', () => {
    const page = extractReadable(
      `<html><body><script type="application/ld+json">{ not json }</script>
       <main><p>${'Body text about things. '.repeat(12)}</p></main></body></html>`,
      BASE,
    )
    expect(page.structured.jsonLd).toEqual([])
  })

  it('extracts emails that are PRESENT, and invents none', () => {
    /*
     * ⚠️ A pattern like first.last@domain assembled from a name is a
     * fabrication with a plausible shape — CLAUDE.md rule 4.
     */
    const page = extractReadable(
      `<html><body><main>
        <a href="mailto:hello@acme.example">Email us</a>
        <p>${'Reach the team at sales@acme.example any time. '.repeat(8)}</p>
      </main></body></html>`,
      BASE,
    )

    expect(page.structured.emails).toContain('hello@acme.example')
    expect(page.structured.emails).toContain('sales@acme.example')
    expect(page.structured.emails).toHaveLength(2)
  })

  it('classifies careers and pricing links, and resolves them absolutely', () => {
    const page = extractReadable(
      `<html><body><main>
        <a href="/careers">Join us</a>
        <a href="/pricing">Plans</a>
        <p>${'Some body text for the page. '.repeat(12)}</p>
      </main></body></html>`,
      BASE,
    )

    const kinds = page.structured.interestingLinks.map((l) => l.kind)
    expect(kinds).toContain('careers')
    expect(kinds).toContain('pricing')
    expect(page.structured.interestingLinks[0]!.url).toBe('https://acme.example/careers')
  })

  it('collects social profiles', () => {
    const page = extractReadable(
      `<html><body><main>
        <a href="https://github.com/acme">GitHub</a>
        <a href="https://www.linkedin.com/company/acme">LinkedIn</a>
        <p>${'Body text here for length. '.repeat(12)}</p>
      </main></body></html>`,
      BASE,
    )

    expect(page.structured.socials).toHaveLength(2)
  })
})

describe('needsBrowser', () => {
  it('says yes ONLY for an empty JavaScript shell', () => {
    // The only justification for paying for Playwright.
    expect(needsBrowser('<html><body><div id="root"></div></body></html>', 0)).toBe(true)
    expect(needsBrowser('<html><body><app-root></app-root></body></html>', 10)).toBe(true)
  })

  it('says no when the HTML already carried its text', () => {
    expect(needsBrowser('<html><body><div id="root">x</div></body></html>', 5000)).toBe(false)
    expect(needsBrowser('<html><body><p>plain page</p></body></html>', 20)).toBe(false)
  })
})
