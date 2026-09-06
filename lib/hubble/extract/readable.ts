import 'server-only'

/**
 * HTML → readable text, and the facts code can take without a model.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ PARSING ONLY. THIS HTML IS NEVER RENDERED.                           ║
 * ║                                                                          ║
 * ║  CLAUDE.md rule 3: no `dangerouslySetInnerHTML`, no `innerHTML`, no      ║
 * ║  `srcdoc`. Cheerio builds a tree server-side and we read text out of it. ║
 * ║  Only the extracted text is stored, so there is no saved markup for a    ║
 * ║  future careless render to find.                                         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * DETERMINISTIC FIRST. An email, a phone number, a JSON-LD block, a careers
 * link — these are matched by code, not interpreted by a model. The LLM is for
 * synthesis, and paying it to read a `mailto:` is both slower and less
 * reliable than a regex. It only sees what code could not resolve.
 */
import * as cheerio from 'cheerio'

import { decodeCfEmail, decodeCfEmailHref } from '@/lib/hubble/extract/cfemail'

/** Boilerplate that is never the substance of a page. */
const STRIP = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'iframe',
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[aria-hidden="true"]',
]

/** Where the substance usually lives, best first. */
const CONTENT_ROOTS = ['article', 'main', '[role="main"]', '#content', '.content', 'body']

export type StructuredFacts = {
  /** Parsed JSON-LD / Schema.org objects. The richest free signal on the web. */
  jsonLd: unknown[]
  emails: string[]
  phones: string[]
  socials: string[]
  headings: string[]
  /** Pages worth reading next: careers, pricing, about, contact. */
  interestingLinks: { url: string; label: string; kind: string }[]
  metaDescription: string | null
}

export type ReadablePage = {
  title: string | null
  text: string
  structured: StructuredFacts
}

/** Link kinds worth following, matched on href and label alike. */
const LINK_KINDS: Array<[string, RegExp]> = [
  ['careers', /careers?|jobs?|hiring|join-us|work-with-us|vacanc/i],
  ['pricing', /pricing|plans|subscribe/i],
  ['about', /about|company|who-we-are|our-story|team|leadership/i],
  ['contact', /contact|get-in-touch|support/i],
  ['news', /news|press|blog|announcement|media/i],
  ['investors', /investors?|funding|shareholders/i],
]

const SOCIAL_HOSTS =
  /(?:linkedin\.com|twitter\.com|x\.com|github\.com|facebook\.com|instagram\.com|youtube\.com|crunchbase\.com)/i

/**
 * ⚠️ EMAILS ARE MATCHED, NEVER GUESSED.
 *
 * A pattern like `first.last@domain` assembled from a person's name is a
 * fabrication with a plausible shape — exactly what CLAUDE.md rule 4 forbids.
 * Only an address literally present on the page is returned.
 */
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi

/** Deliberately conservative: a false phone number is worse than none. */
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,4}[\s.-]\d{3,4}(?:[\s.-]\d{2,4})?/g

/** Addresses that are plumbing, not contacts. */
const JUNK_EMAIL = /^(?:.+@)?(?:example|sentry|wixpress|godaddy|schema|w3|sentry\.io)/i

function uniq(values: readonly string[], limit: number): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))].slice(0, limit)
}

export function extractReadable(html: string, baseUrl: string): ReadablePage {
  const $ = cheerio.load(html)

  const title =
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('title').first().text().trim() ||
    $('h1').first().text().trim() ||
    null

  const metaDescription =
    $('meta[name="description"]').attr('content')?.trim() ||
    $('meta[property="og:description"]').attr('content')?.trim() ||
    null

  /*
   * JSON-LD is read BEFORE the strip pass, because it lives in a <script> tag
   * and stripping scripts is the first thing we do. Losing it would mean
   * paying a model to infer what the page already stated in machine-readable
   * form.
   */
  const jsonLd: unknown[] = []
  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).contents().text().trim()
    if (!raw || raw.length > 200_000) return
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) jsonLd.push(...parsed)
      else jsonLd.push(parsed)
    } catch {
      // Malformed JSON-LD is common and is simply not a fact.
    }
  })

  const headings: string[] = []
  $('h1, h2, h3').each((_, element) => {
    const value = $(element).text().replace(/\s+/g, ' ').trim()
    if (value && value.length <= 200) headings.push(value)
  })

  const socials: string[] = []
  const interestingLinks: StructuredFacts['interestingLinks'] = []
  const emails: string[] = []
  const linkedPhones: string[] = []

  /*
   * Cloudflare-obfuscated addresses, decoded BEFORE the strip pass.
   *
   * ⚠️ THE ORDERING IS THE WHOLE POINT — same trap as JSON-LD above. A company
   * contact address most often sits in the <footer>, and <footer> is the third
   * thing STRIP removes. Decoding after the strip would silently find nothing
   * on exactly the pages this exists to rescue.
   *
   * The node's text is replaced with the decoded address so the placeholder
   * "[email protected]" does not reach the model as the page's own words.
   * Safe to mutate: this tree is read for text and then discarded — it is
   * never rendered (rule 3).
   */
  $('[data-cfemail]').each((_, element) => {
    const address = decodeCfEmail($(element).attr('data-cfemail'))
    if (!address) return
    emails.push(address)
    $(element).text(address)
  })

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href') ?? ''
    const label = $(element).text().replace(/\s+/g, ' ').trim().slice(0, 120)

    if (href.toLowerCase().startsWith('mailto:')) {
      const address = href.slice(7).split('?')[0]
      if (address) emails.push(address)
      return
    }

    if (href.toLowerCase().startsWith('tel:')) {
      const phone = href.slice(4).split('?')[0]?.trim()
      if (phone) linkedPhones.push(phone)
      return
    }

    // The same fact in a second shape: what a `mailto:` becomes when
    // Cloudflare's obfuscation rewrites it.
    const protectedAddress = decodeCfEmailHref(href)
    if (protectedAddress) {
      emails.push(protectedAddress)
      $(element).text(protectedAddress)
      return
    }

    let absolute: string
    try {
      absolute = new URL(href, baseUrl).toString()
    } catch {
      return
    }
    if (!absolute.startsWith('http')) return

    if (SOCIAL_HOSTS.test(absolute)) socials.push(absolute)

    for (const [kind, pattern] of LINK_KINDS) {
      if (pattern.test(href) || pattern.test(label)) {
        interestingLinks.push({ url: absolute, label, kind })
        break
      }
    }
  })

  // Strip boilerplate, then take the densest remaining root.
  for (const selector of STRIP) $(selector).remove()

  let text = ''
  for (const selector of CONTENT_ROOTS) {
    const candidate = $(selector).first()
    if (candidate.length === 0) continue
    const value = candidate.text().replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
    // A nav-only <main> is not content; keep looking.
    if (value.length > text.length) text = value
    if (text.length > 500) break
  }

  const bodyText = text || $.root().text().replace(/\s+/g, ' ').trim()

  emails.push(...(bodyText.match(EMAIL) ?? []))
  const phones = [...linkedPhones, ...(bodyText.match(PHONE) ?? [])].filter((value) => {
    const digits = value.replace(/\D/g, '')
    // Years, prices and IDs all match a loose phone pattern.
    return digits.length >= 9 && digits.length <= 15
  })

  return {
    title,
    text: bodyText,
    structured: {
      jsonLd: jsonLd.slice(0, 20),
      emails: uniq(
        emails.map((value) => value.toLowerCase()).filter((value) => !JUNK_EMAIL.test(value)),
        20,
      ),
      phones: uniq(phones, 10),
      socials: uniq(socials, 25),
      headings: uniq(headings, 40),
      interestingLinks: interestingLinks.slice(0, 40),
      metaDescription,
    },
  }
}
