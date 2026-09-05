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
 * Probes for every row marked PROBE in `docs/DATA_INVENTORY.md`, grouped by
 * the analytical question each class answers.
 *
 * ⚠️ READS A LOCAL FILE. No network request, no page opened, nothing
 * navigated — CLAUDE.md rule 1 untouched. Point it at a page you saved.
 *
 *   node scripts/census-page.mjs ~/Downloads/account-list.html
 *
 * ⚠️ DELETE THE PAGE AFTERWARDS. `.gitignore` blocks saved pages and a real one
 * contains real people. This output is counts, shapes and vocabulary — never
 * names — so it is safe to paste when the page itself is not.
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
const body = $('body').text().replace(/\s+/g, ' ')

const line = (label, value) => console.log(`  ${String(label).padEnd(32)} ${value}`)
const rule = (t) => console.log(`\n──── ${t} ${'─'.repeat(Math.max(0, 60 - t.length))}`)

/** Present/absent probe. The whole point is that "—" is a real answer. */
const probe = (label, re) => line(label, re.test(body) ? 'PRESENT' : '—')

console.log(`\nCENSUS · ${file}`)
line('file size', `${(html.length / 1024).toFixed(0)} KB`)

/* ═══════════════════════════════════════════════════ 1. IDENTITY ═══════ */
rule('1. IDENTITY — the join keys everything else aggregates on')

const hrefs = $('a[href]').map((_, el) => $(el).attr('href') ?? '').get()
const count = (re) => hrefs.filter((h) => re.test(h)).length

line('canonical/og url', $('link[rel="canonical"]').attr('href') ?? $('meta[property="og:url"]').attr('content') ?? '(none saved)')
line('<title>', ($('title').first().text() || '(none)').slice(0, 56))
line('person · /sales/lead/', count(/\/sales\/lead\//))
line('person · /in/', count(/linkedin\.com\/in\/|^\/in\//))
line('company · /sales/company/', count(/\/sales\/company\//))
line('company · /company/', count(/linkedin\.com\/company\/|^\/company\//))

for (const sel of [
  'li.artdeco-list__item',
  'tr[data-x--people-list--row]',
  '[data-x--search-results--row]',
  'article',
]) {
  const n = $(sel).length
  if (n > 0) line(`rows: ${sel}`, n)
}

/* ═══════════════════════════════════════════ 2. STABLE ANCHORS ════════ */
rule('2. data-anonymize CENSUS — the only selectors that survive a redeploy')

const anon = new Map()
$('[data-anonymize]').each((_, el) => {
  const k = $(el).attr('data-anonymize')
  anon.set(k, (anon.get(k) ?? 0) + 1)
})

if (anon.size === 0) {
  console.log('  ⚠️ NONE. Either this is not a Sales Navigator page, or the layout')
  console.log('     no longer carries the attribute — which would be a big finding.')
} else {
  for (const [k, n] of [...anon].sort((a, b) => b[1] - a[1])) {
    const sample = $(`[data-anonymize="${k}"]`).first().text().replace(/\s+/g, ' ').trim()
    line(k, `${String(n).padStart(4)}   e.g. ${sample.slice(0, 40)}`)
  }
}

/* ═════════════════════════════════════════════ 3. FIRMOGRAPHICS ══════ */
rule('3. FIRMOGRAPHICS — can this page segment the book?')
probe('industry vocabulary', /\b(software|services|manufactur|consult|financ|health|retail)\w*\b/i)
probe('"employees"', /\bemployees?\b/i)
probe('employee RANGE (2-10)', /\b\d[\d,]*\s*[-–]\s*\d[\d,]*\s+employees?\b/i)
probe('employee EXACT', /\b[\d,]{2,}\s+employees?\b/i)
probe('"headquarters" / "HQ"', /\bheadquarters?\b|\bHQ\b/i)
probe('"founded"', /\bfounded\b/i)
probe('"specialties"', /\bspecial(ties|ities|ization)\b/i)
probe('company type', /\b(public company|privately held|nonprofit|self-employed|partnership)\b/i)

/* ══════════════════════════════════════════════════ 4. GROWTH ════════ */
rule('4. GROWTH & MOMENTUM — the highest-value class, and the least covered')
probe('headcount growth %', /\b\d+(\.\d+)?\s*%\s*(growth|increase|change)|\bgrowth\b[^.]{0,20}\d+\s*%/i)
probe('"growth"', /\bgrowth\b/i)
probe('job openings count', /\b\d+\s+(job|open|role|position)\w*\b/i)
probe('"hiring"', /\bhiring\b|\bwe.re hiring\b/i)
probe('"job openings" label', /job openings?/i)
probe('department hiring', /\bhiring\b[^.]{0,40}\b(sales|engineering|marketing|product)\b/i)
probe('"new office" / expansion', /new office|expand(ing|ed)?\b/i)

/* ═════════════════════════════════════════════════ 5. FUNDING ═══════ */
rule('5. FUNDING — expected ABSENT; confirming the boundary')
probe('"funding" / "raised"', /\bfunding\b|\braised\b/i)
probe('round names', /\b(seed|series [a-f]|pre-seed|ipo)\b/i)
probe('currency amounts', /[$£€]\s?\d[\d,.]*\s*(m|bn|million|billion)?/i)
probe('"investors"', /\binvestors?\b/i)
probe('"crunchbase"', /crunchbase/i)

/* ═════════════════════════════════════════ 6. PEOPLE & ORG ══════════ */
rule('6. PEOPLE & ORG STRUCTURE')

const named = $('a[href*="/sales/lead/"], a[href*="/in/"]').filter(
  (_, el) => ($(el).text() ?? '').trim().length > 1,
)
line('named person links', named.length)
probe('"decision maker"', /decision makers?/i)
probe('seniority words', /\b(chief|head of|vp|vice president|director|founder|owner|manager)\b/i)
probe('department words', /\b(engineering|sales|marketing|finance|operations|product|hr|people)\b/i)
probe('"new in role" / promoted', /new (to|in) (the )?role|recently (joined|promoted|started)/i)
probe('"tenure" / "years at"', /\btenure\b|\byears? (at|in)\b/i)

if (named.length > 0) {
  console.log('\n  what sits beside a person (shows what identifies them):')
  named.slice(0, 3).each((i, el) => {
    const card = $(el).closest('li, tr, article, div[class*="card"], section')
    console.log(`    [${i + 1}] ${(card.text() || '').replace(/\s+/g, ' ').trim().slice(0, 140)}`)
  })
}

/* ══════════════════════════════════════ 7. ENGAGEMENT & ACTIVITY ════ */
rule('7. ENGAGEMENT — "how tied they are to the company"')
console.log('  You named this as what identifies personnel. Does the page render it?\n')
probe('"posted" / "posts"', /\bposted\b|\bposts?\b/i)
probe('recency ("3d ago")', /\b\d+\s*(d|w|mo|yr|days?|weeks?|months?|years?)\s+ago\b/i)
probe('"followers"', /\bfollowers?\b/i)
probe('"activity" / "active"', /\bactivity\b|\bactive\b/i)
probe('"shared" / "reposted"', /\bshared\b|\breposted\b/i)
probe('"viewed" / "engaged"', /\bviewed\b|\bengaged\b/i)
probe('"likes" / "reactions"', /\blikes?\b|\breactions?\b/i)
line('post/activity links', count(/\/posts\/|\/feed\/update|activity-\d/))

/* ═══════════════════════════════════════ 8. RELATIONSHIP & NETWORK ══ */
rule('8. RELATIONSHIP — the path in')
probe('connection degree', /\b(1st|2nd|3rd)\b|\bdegree connection\b/i)
probe('"mutual" connections', /\bmutual\b/i)
probe('"shared" experience', /shared (experience|education|connection)/i)
probe('"teammates" / "colleagues"', /teammates?|colleagues?/i)
probe('"reachable" badge', /\breachable\b/i)
probe('saved lists', /\b\d+\s+lists?\b/i)

/* ═════════════════════════════════ 9. WEB PRESENCE (fetchable) ══════ */
rule('9. WEB PRESENCE — URLs Hubble can FETCH, needing no search engine')

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

line('distinct external hosts', external.size)

for (const [label, re] of [
  ['github', /(^|\.)github\.com/i],
  ['x / twitter', /(^|\.)(twitter\.com|x\.com)/i],
  ['youtube', /(^|\.)youtube\.com|youtu\.be/i],
  ['instagram', /(^|\.)instagram\.com/i],
  ['facebook', /(^|\.)facebook\.com/i],
  ['crunchbase', /(^|\.)crunchbase\.com/i],
  ['producthunt / launch', /producthunt\.com/i],
  ['app store', /apps\.apple\.com|play\.google\.com/i],
  ['link shortener', /(^|\.)(lnkd\.in|bit\.ly|t\.co)/i],
]) {
  const n = [...external.keys()].filter((h) => re.test(h)).length
  if (n > 0) line(`  ${label}`, n)
}

/* Path shapes reveal launches, pricing and partners even on unknown hosts. */
console.log('')
for (const [label, re] of [
  ['/pricing paths', /\/pricing/i],
  ['/careers or /jobs paths', /\/(careers?|jobs?)\b/i],
  ['/launch or /product paths', /\/(launch|product)/i],
  ['/partners paths', /\/partners?/i],
  ['/about paths', /\/about/i],
  ['/blog or /news paths', /\/(blog|news|press)/i],
]) {
  const n = count(re)
  if (n > 0) line(label, n)
}

if (external.size > 0) {
  console.log('\n  external hosts — the launch / landing / partner / social surface:')
  for (const [host, n] of [...external].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
    line(`    ${host}`, n)
  }
}

/* ════════════════════════════════════════════ 10. MARKET POSITION ═══ */
rule('10. MARKET POSITION')
probe('"similar companies"', /similar (companies|pages)/i)
probe('"competitors"', /competitors?/i)
probe('"customers" / "clients"', /\bcustomers?\b|\bclients?\b/i)
probe('reviews / ratings', /\breviews?\b|\bratings?\b|\b\d\.\d\s*(stars?|\/5)/i)
probe('"awards"', /\bawards?\b/i)

/* ════════════════════════════════════════ 11. RISK & COMPLIANCE ════ */
rule('11. RISK & COMPLIANCE')
probe('company status words', /\b(active|dissolved|liquidation|administration)\b/i)
probe('registration number', /\b(company (number|no)|registration number|CIK|EIN)\b/i)

/* ══════════════════════════════════ 12. LABELLED NUMBERS ═══════════ */
rule('12. LABELLED NUMBERS — every count this page could yield')
console.log('  Read by LABEL, never by position: a page is a stack of unlabelled')
console.log('  counters whose order LinkedIn is free to change.\n')

const seen = new Set()
let shown = 0
for (const match of body.match(/[\d,]+\+?\s+[a-z][a-z ]{2,26}/gi) ?? []) {
  const norm = match.replace(/\s+/g, ' ').trim()
  const key = norm.toLowerCase().replace(/[\d,]+/g, '#')
  if (seen.has(key)) continue
  seen.add(key)
  console.log(`    ${norm.slice(0, 58)}`)
  if (++shown >= 25) break
}
if (shown === 0) console.log('    (none)')

/* ═══════════════════════════════════════════ 13. THE BOUNDARY ══════ */
rule('13. CONTACT DATA — confirming the known boundary')
line('mailto: links', $('a[href^="mailto:"]').length)
line('tel: links', $('a[href^="tel:"]').length)
line('email-shaped text', (body.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? []).length)
console.log('\n  Expected zero on all three. A non-zero here would overturn the')
console.log('  census of 2026-08-19 and is worth reporting.')

console.log('\n⚠️ Delete the saved page now. This output is safe to share; the page is not.\n')
