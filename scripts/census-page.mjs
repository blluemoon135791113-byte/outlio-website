#!/usr/bin/env node
/**
 * Measures what a saved Sales Navigator page ACTUALLY carries.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  WHY THIS EXISTS.                                                        ║
 * ║                                                                          ║
 * ║  Every selector in this codebase that was GUESSED has been wrong.        ║
 * ║  `data-anonymize="job-title"` was assumed to be tenure text and is the   ║
 * ║  real title on the table layout. `data-anonymize="title"` was documented ║
 * ║  as the real title and does not exist there at all. An investors section ║
 * ║  was built against a page that has no investors section.                 ║
 * ║                                                                          ║
 * ║  Every selector that was CENSUSED has held. So: measure first, build     ║
 * ║  second. This prints the measurement.                                    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ READS A LOCAL FILE. It makes no network request, opens no page and
 * navigates nothing — CLAUDE.md rule 1 is untouched. Point it at a page you
 * saved yourself.
 *
 *   node scripts/census-page.mjs ~/Downloads/account-list.html
 *
 * ⚠️ DELETE THE PAGE AFTERWARDS. `.gitignore` blocks saved pages, and a real
 * one contains real people. The census output is counts and shapes, never
 * names — safe to paste, unlike the page itself.
 */
import { readFile } from 'node:fs/promises'
import * as cheerio from 'cheerio'

const file = process.argv[2]
if (!file) {
  console.error('usage: node scripts/census-page.mjs <saved-page.html>')
  process.exit(1)
}

const html = await readFile(file, 'utf8')
const $ = cheerio.load(html)

const line = (label, value) => console.log(`  ${String(label).padEnd(34)} ${value}`)
const rule = (title) => console.log(`\n──── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`)

console.log(`\nCENSUS · ${file}`)
line('file size', `${(html.length / 1024).toFixed(0)} KB`)

/* ---------------------------------------------------------------- shape -- */
rule('PAGE SHAPE')

const urlHint =
  $('link[rel="canonical"]').attr('href') ??
  $('meta[property="og:url"]').attr('content') ??
  '(no canonical URL in the saved file)'
line('canonical/og url', urlHint)
line('<title>', ($('title').first().text() || '(none)').slice(0, 60))

for (const [label, sel] of [
  ['li.artdeco-list__item', 'li.artdeco-list__item'],
  ['tr[data-x--people-list--row]', 'tr[data-x--people-list--row]'],
  ['[data-x--search-results--row]', '[data-x--search-results--row]'],
  ['article', 'article'],
]) {
  const n = $(sel).length
  if (n > 0) line(`rows: ${label}`, n)
}

/* ------------------------------------------------------- data-anonymize -- */
rule('data-anonymize CENSUS')
console.log('  The only stable anchors. Ember ids and CSS-module hashes are not.\n')

const anon = new Map()
$('[data-anonymize]').each((_, el) => {
  const key = $(el).attr('data-anonymize')
  anon.set(key, (anon.get(key) ?? 0) + 1)
})

if (anon.size === 0) {
  console.log('  ⚠️ NONE. Either this is not a Sales Navigator page, or the layout')
  console.log('     has changed in a way that removes the attribute entirely.')
} else {
  for (const [key, count] of [...anon].sort((a, b) => b[1] - a[1])) {
    const sample = $(`[data-anonymize="${key}"]`).first().text().replace(/\s+/g, ' ').trim()
    line(key, `${String(count).padStart(4)}   e.g. ${sample.slice(0, 44)}`)
  }
}

/* ------------------------------------------------------------- linkage -- */
rule('LINK CENSUS — who and what this page points at')

const hrefs = $('a[href]')
  .map((_, el) => $(el).attr('href') ?? '')
  .get()

const linkKinds = [
  ['person · /sales/lead/', /\/sales\/lead\//],
  ['person · /in/', /linkedin\.com\/in\/|^\/in\//],
  ['company · /sales/company/', /\/sales\/company\//],
  ['company · /company/', /linkedin\.com\/company\/|^\/company\//],
  ['job posting', /\/jobs\/|\/sales\/jobs/],
  ['LinkedIn post/activity', /\/posts\/|\/feed\/update|activity-\d/],
]

for (const [label, re] of linkKinds) {
  const n = hrefs.filter((h) => re.test(h)).length
  if (n > 0) line(label, n)
}

/*
 * ⚠️ THE OUTBOUND LINKS ARE THE POINT.
 *
 * Launches, landing pages, partners and social accounts are pages Hubble can
 * FETCH. With web search unreliable, a company page that hands over its own
 * URLs is a route to evidence that needs no search engine at all.
 */
const OUTBOUND_KINDS = [
  ['github', /(^|\.)github\.com/i],
  ['x / twitter', /(^|\.)(twitter\.com|x\.com)/i],
  ['youtube', /(^|\.)youtube\.com|youtu\.be/i],
  ['instagram', /(^|\.)instagram\.com/i],
  ['facebook', /(^|\.)facebook\.com/i],
  ['crunchbase', /(^|\.)crunchbase\.com/i],
  ['producthunt / launch', /producthunt\.com|\/launch/i],
  ['app store', /apps\.apple\.com|play\.google\.com/i],
]

const external = new Map()
for (const href of hrefs) {
  let host
  try {
    host = new URL(href, 'https://www.linkedin.com').hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    continue
  }
  if (/linkedin\.com$|licdn\.com$/.test(host)) continue
  external.set(host, (external.get(host) ?? 0) + 1)
}

console.log('')
line('distinct external hosts', external.size)
for (const [label, re] of OUTBOUND_KINDS) {
  const n = [...external.keys()].filter((h) => re.test(h)).length
  if (n > 0) line(`  ${label}`, n)
}

if (external.size > 0) {
  console.log('\n  external hosts (the affiliate/launch/partner surface):')
  for (const [host, count] of [...external].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    line(`    ${host}`, count)
  }
}

/* ----------------------------------------------------------- personnel -- */
rule('PERSONNEL — what identifies a person here')
console.log('  You said role, activity and how tied they are to the company.')
console.log('  This checks whether the page actually renders any of that.\n')

const peopleAnchors = $('a[href*="/sales/lead/"], a[href*="/in/"]').filter(
  (_, el) => ($(el).text() ?? '').trim().length > 1,
)
line('named person links', peopleAnchors.length)

if (peopleAnchors.length > 0) {
  const sample = peopleAnchors.slice(0, 3)
  console.log('\n  context around the first few (what sits beside a name):')
  sample.each((i, el) => {
    const card = $(el).closest('li, tr, article, div[class*="card"]')
    const text = (card.text() || '').replace(/\s+/g, ' ').trim()
    console.log(`    [${i + 1}] ${text.slice(0, 150)}`)
  })
}

/*
 * Activity vocabulary. If none of this appears, "how much they post about the
 * company" is not on the page and must not be invented as a field.
 */
const body = $('body').text().replace(/\s+/g, ' ')
console.log('')
for (const [label, re] of [
  ['"posted" / "post"', /\bposted\b|\bposts?\b/i],
  ['"activity" / "active"', /\bactivity\b|\bactive\b/i],
  ['"follower"', /\bfollowers?\b/i],
  ['"shared"', /\bshared\b/i],
  ['"ago" (recency)', /\b\d+\s*(d|w|mo|yr|days?|weeks?|months?|years?)\s+ago\b/i],
  ['"decision maker"', /decision makers?/i],
  ['"employees"', /\bemployees?\b/i],
  ['"headcount growth"', /headcount|growth/i],
  ['"job openings"', /job openings?|hiring/i],
]) {
  line(label, re.test(body) ? 'PRESENT' : '—')
}

/* --------------------------------------------------- labelled numbers -- */
rule('LABELLED NUMBERS — candidates for counts')
const numbers = body.match(/[\d,]+\+?\s+[a-z][a-z ]{2,24}/gi) ?? []
const seen = new Set()
let shown = 0
for (const match of numbers) {
  const norm = match.replace(/\s+/g, ' ').trim()
  const key = norm.toLowerCase().replace(/[\d,]+/g, '#')
  if (seen.has(key)) continue
  seen.add(key)
  console.log(`    ${norm.slice(0, 60)}`)
  if (++shown >= 20) break
}
if (shown === 0) console.log('    (none)')

/* -------------------------------------------------------- the boundary -- */
rule('CONTACT DATA — confirming the known boundary')
line('mailto: links', $('a[href^="mailto:"]').length)
line('tel: links', $('a[href^="tel:"]').length)
line('email-shaped text', (body.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? []).length)

console.log('\n⚠️ Delete the saved page now. This output is safe to share; the page is not.\n')
