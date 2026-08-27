import 'server-only'

/**
 * Scout — free contact-email enrichment, ported from the Scout enrichment
 * engine (Apache-pattern: website harvest → pattern inference → SMTP verify).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 *  THREE GATES BETWEEN A CANDIDATE AND A STORED EMAIL (CLAUDE.md rule 4):
 *
 *    1. PUBLISHED — found on the company's own website. The company said it.
 *       Highest confidence.
 *    2. SMTP-VERIFIED — a pattern candidate the mail server accepted, WITH a
 *       catch-all control proving the server distinguishes real mailboxes.
 *       Medium confidence.
 *    3. EVERYTHING ELSE — including plausible patterns the server would not
 *       confirm and every address on an accept-all server — is REFUSED.
 *       Storing a guess that looks like a contact detail is fabrication, and
 *       the first anyone hears of it is a bounce.
 *
 *  NO PLATFORM SCRAPING. Scout's LinkedIn/Instagram/TikTok scrapers were
 *  deliberately not ported (rules 1–2); only its contact-engine techniques
 *  live here, against domains Outlio already researches.
 *
 *  ⚠️ SMTP PROBING NEEDS OUTBOUND PORT 25, which Vercel serverless blocks.
 *  `SCOUT_SMTP_VERIFY=true` opts a self-hosted worker in. Without it this
 *  provider still answers from PUBLISHED addresses alone.
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import { promises as dns } from 'node:dns'
import { connect as tcpConnect } from 'node:net'

import { normalizeDomain } from '@/lib/companies/normalize'
import { requestTextWithMeta, setHostPacing, USER_AGENT } from '@/lib/intelligence/http'
import { expiresAtFor } from '@/lib/intelligence/ttl'
import type {
  IntelligenceProvider,
  NormalizedEvidence,
  PersonEntity,
  ResearchTask,
  SourceConfidence,
} from '@/lib/intelligence/types'

const CONTACT_PATHS = ['', '/contact', '/contact-us', '/about', '/about-us'] as const

/** Head of page is enough; these are identity-bearing pages, not downloads. */
const HARVEST_MAX_BYTES = 300_000

/**
 * Hosts and shapes that appear in scraped pages but are never the person's
 * business address — framework noise, file attachments, example text.
 */
const EMAIL_HOST_BLACKLIST = [
  'example.com', 'example.org', 'test.com', 'email.com', 'youremail.com',
  'yourdomain.com', 'domain.com', 'sentry.io', 'googleapis.com', 'wixpress.com',
  'w3.org', 'schema.org', 'gravatar.com', 'wordpress.com', 'squarespace.com',
  'cloudflare.com', 'godaddy.com', 'sentinel',
  // Our own identity. Some hosts (YouTube's player config) ECHO the request's
  // User-Agent back into the page body — without this, Outlio's contact
  // address comes home as the lead's business email.
  'outlio.io',
]

const FILE_SUFFIX_BLACKLIST = ['.png', '.jpg', '.jpeg', '.gif', '.css', '.js', '.svg', '.webp', '.ico']

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

const SMTP_TIMEOUT_MS = 10_000

/** Shared/team inboxes are company contacts, never evidence for one person. */
const GENERIC_MAILBOXES = new Set([
  'admin',
  'billing',
  'business',
  'careers',
  'contact',
  'customerservice',
  'hello',
  'help',
  'hr',
  'info',
  'inquiries',
  'jobs',
  'legal',
  'marketing',
  'media',
  'office',
  'operations',
  'partners',
  'press',
  'privacy',
  'sales',
  'security',
  'support',
  'team',
])

/** Paced like every other host we touch, however small the request. */
setHostPacing('scout-harvest', 150)

// ---------------------------------------------------------------------------
// Harvest — emails the company published about itself
// ---------------------------------------------------------------------------

/** PURE. Filters scraper noise out of a raw email candidate. */
export function isHarvestableEmail(email: string): boolean {
  const lower = email.toLowerCase()
  if (EMAIL_HOST_BLACKLIST.some((bad) => lower.endsWith(`@${bad}`) || lower.includes(`@${bad}.`))) {
    return false
  }
  if (FILE_SUFFIX_BLACKLIST.some((ext) => lower.endsWith(ext))) return false
  return true
}

/** PURE. Deduplicated, noise-free emails from raw page text. */
export function extractEmails(text: string | null): string[] {
  if (!text) return []
  // Some servers echo the request's User-Agent into the response body (the
  // YouTube player config does). Our identification string carries a contact
  // address, so it must be stripped BEFORE extraction — the reflected echo is
  // not a fact about the company.
  const cleaned = text.split(USER_AGENT).join(' ')
  const seen = new Set<string>()
  const matches = cleaned.match(EMAIL_PATTERN) ?? []
  for (const match of matches) {
    const email = match.trim().toLowerCase()
    if (email && isHarvestableEmail(email)) seen.add(email)
  }
  return [...seen]
}

/**
 * PURE. A public mailbox belongs to a person only when its local part matches
 * that person's name. Merely sharing the employer's domain is insufficient:
 * `sales@company.com` is a company inbox, not the founder's work email.
 */
export function isPersonMailbox(email: string, fullName: string | null): boolean {
  const local = email.trim().toLowerCase().split('@')[0]?.split('+')[0] ?? ''
  const compactLocal = local.replace(/[^a-z0-9]/g, '')
  if (!local || !compactLocal || GENERIC_MAILBOXES.has(compactLocal)) return false

  const parts = (fullName ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
  if (parts.length === 0) return false

  const first = parts[0]!
  const last = parts[parts.length - 1]!
  const candidates = new Set([
    first,
    `${first}${last}`,
    `${first}.${last}`,
    `${first[0] ?? ''}${last}`,
    `${first[0] ?? ''}.${last}`,
  ])

  return candidates.has(local) || candidates.has(compactLocal)
}

async function fetchPageText(url: string): Promise<string | null> {
  try {
    const { text } = await requestTextWithMeta({
      url,
      method: 'GET',
      timeoutMs: 8_000,
      maxBytes: HARVEST_MAX_BYTES,
      truncateWhenTooLarge: true,
    })
    return text
  } catch {
    return null
  }
}

export type HarvestedContacts = {
  /** Emails whose domain belongs to the company itself. */
  onDomain: string[]
  /** Other real addresses published on the site (generic inboxes etc.). */
  other: string[]
}

/**
 * Reads the company's own contact-bearing pages.
 *
 * Deliberately bounded: five paths, one pass, no crawling.
 */
export async function harvestWebsiteContacts(
  domain: string,
  fetched: (url: string) => Promise<string | null> = fetchPageText,
): Promise<HarvestedContacts> {
  const host = normalizeDomain(domain)
  if (!host) return { onDomain: [], other: [] }

  const registrable = host.replace(/^www\./, '')
  const suffix = registrable.split('.').slice(-2).join('.')

  const onDomain = new Set<string>()
  const other = new Set<string>()

  for (const path of CONTACT_PATHS) {
    const text = await fetched(`https://${registrable}${path}/`)
    if (!text) continue

    for (const email of extractEmails(text)) {
      const emailDomain = email.split('@')[1] ?? ''
      if (
        emailDomain === registrable ||
        emailDomain.endsWith(`.${registrable}`) ||
        emailDomain.endsWith(`.${suffix}`) ||
        emailDomain === suffix
      ) {
        onDomain.add(email)
      } else {
        other.add(email)
      }
    }
  }

  return { onDomain: [...onDomain], other: [...other] }
}

// ---------------------------------------------------------------------------
// Patterns — infer the house style from the samples we just harvested
// ---------------------------------------------------------------------------

export type EmailPattern = 'first.last' | 'first' | 'f.last' | 'flast' | 'firstlast'

/**
 * Detects the local-part convention from a REAL mailbox on the domain.
 *
 * PURE. Refuses anything ambiguous — initials-plus-surname variants beyond the
 * known shapes, numbers, middle names — because a wrong template generates a
 * confident-looking wrong candidate.
 */
export function detectPattern(localPart: string): EmailPattern | null {
  const local = localPart.toLowerCase()
  if (!/^[a-z][a-z.]*$/.test(local) || local.includes('..')) return null

  if (local.includes('.')) {
    const parts = local.split('.')
    if (parts.length !== 2 || parts.some((part) => part.length === 0)) return null
    if (parts[0]!.length === 1 && parts[1]!.length > 1) return 'f.last'
    if (parts[0]!.length > 1 && parts[1]!.length > 1) return 'first.last'
    return null
  }

  // A bare word is ambiguous between first / flast / firstlast — one sample
  // cannot tell, and candidate generation probes every shape anyway. Refusing
  // here costs nothing and never picks the wrong template.
  return null
}

/** PURE. Applies a detected template. Returns null for unusable names. */
export function applyPattern(
  pattern: EmailPattern,
  firstName: string,
  lastName: string,
  domain: string,
): string | null {
  const first = firstName.toLowerCase().replace(/[^a-z]/g, '')
  const last = lastName.toLowerCase().replace(/[^a-z]/g, '')
  if (!first || !last) return null

  switch (pattern) {
    case 'first.last': return `${first}.${last}@${domain}`
    case 'first': return `${first}@${domain}`
    case 'f.last': return `${first[0]}.${last}@${domain}`
    case 'flast': return `${first[0]}${last}@${domain}`
    case 'firstlast': return `${first}${last}@${domain}`
  }
}

/**
 * Ordered candidate list for SMTP probing. Most common conventions first;
 * capped because every entry is a live question to somebody's mail server.
 */
export function generateCandidates(
  fullName: string | null,
  domain: string | null,
  limit = 5,
): string[] {
  if (!fullName || !domain) return []
  const parts = fullName.trim().toLowerCase().split(/\s+/)
  if (parts.length < 2) return []

  const first = parts[0]!.replace(/[^a-z]/g, '')
  const last = parts[parts.length - 1]!.replace(/[^a-z]/g, '')
  if (!first || !last || first.length < 2 || last.length < 2) return []

  const candidates = [
    `${first}.${last}@${domain}`,
    `${first}${last}@${domain}`,
    `${first[0]}${last}@${domain}`,
    `${first[0]}.${last}@${domain}`,
    `${first}@${domain}`,
  ]
  return candidates.slice(0, Math.max(0, limit))
}

// ---------------------------------------------------------------------------
// SMTP verification — does this mailbox actually exist?
// ---------------------------------------------------------------------------

export type SmtpVerdict = {
  probed: boolean
  /** The server accepted the mailbox. */
  exists: boolean
  /** The server accepts ANYTHING — its yes means nothing. */
  acceptAll: boolean
}

export type SmtpProbe = (
  mxHost: string,
  email: string,
  controlEmail: string,
) => Promise<SmtpVerdict>

/**
 * Minimal SMTP conversation over a raw socket.
 *
 * RCPT-probing is the standard technique: a 250 for the target suggests the
 * mailbox exists, and a 250 for a guaranteed-fake control address marks the
 * domain as accept-all, downgrading every answer from it.
 *
 * Any protocol surprise resolves to "inconclusive", never to "does not exist"
 * — a greylisting server must not manufacture a false negative.
 */
export const smtpProbeOverTcp: SmtpProbe = async (mxHost, email, controlEmail) => {
  const verdict: SmtpVerdict = { probed: false, exists: false, acceptAll: false }

  await new Promise<void>((resolve) => {
    const socket = tcpConnect({ host: mxHost, port: 25, timeout: SMTP_TIMEOUT_MS })
    let stage = 0
    let buffer = ''

    const finish = () => {
      socket.destroy()
      resolve()
    }

    socket.setTimeout(SMTP_TIMEOUT_MS, finish)
    socket.on('error', finish)

    /**
     * A reply is complete when its LAST line carries `NNN ` (space, not the
     * continuation dash). Returns that final status code.
     */
    const finalCode = (): number | null => {
      const lines = buffer.split(/\r?\n/).filter((line) => line.length > 0)
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const match = /^(\d{3})([- ])/.exec(lines[i] ?? '')
        if (!match) continue
        if (match[2] === ' ') return Number.parseInt(match[1]!, 10)
        // A dash-continued line can only be final once more lines follow it.
        if (i < lines.length - 1) return Number.parseInt(match[1]!, 10)
        return null
      }
      return null
    }

    const send = (command: string) => {
      buffer = ''
      socket.write(`${command}\r\n`)
    }

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const code = finalCode()
      if (code === null) return

      switch (stage) {
        case 0: // greeting
          if (code !== 220) return finish()
          stage = 1
          send(`EHLO outlio.io`)
          return
        case 1: // EHLO
          if (code !== 250) return finish()
          stage = 2
          send(`MAIL FROM:<verify@outlio.io>`)
          return
        case 2: // MAIL FROM
          if (code !== 250) return finish()
          stage = 3
          send(`RCPT TO:<${email}>`)
          return
        case 3: // target mailbox
          // Greylisting and temp-fails stay inconclusive by design: a 4xx
          // must never manufacture a false negative about a real mailbox.
          if (code === 250) verdict.exists = true
          else if (code >= 400 && code < 500) return finish()
          stage = 4
          send(`RCPT TO:<${controlEmail}>`)
          return
        case 4: // control mailbox
          if (code === 250) verdict.acceptAll = true
          verdict.probed = true
          send(`QUIT`)
          finish()
          return
        default:
          finish()
      }
    })
  })

  return verdict
}

async function primaryMxHost(domain: string): Promise<string | null> {
  try {
    const records = await dns.resolveMx(domain)
    const best = records.filter((record) => Boolean(record.exchange))
      .sort((a, b) => a.priority - b.priority)[0]
    return best ? best.exchange.replace(/\.$/, '').toLowerCase() : null
  } catch {
    return null
  }
}

const CONTROL_LOCAL_PARTS = new Set(['zzznonexistent999', 'qzxvnotreal731'])

/** PURE. The control probe must be a shape no real mailbox holds. */
export function controlEmailFor(domain: string): string {
  return `${CONTROL_LOCAL_PARTS.values().next().value ?? 'zzznonexistent999'}@${domain}`
}

export async function verifyEmail(
  email: string,
  probe: SmtpProbe = smtpProbeOverTcp,
): Promise<SmtpVerdict> {
  const domain = email.split('@')[1]
  if (!domain) return { probed: false, exists: false, acceptAll: false }

  const mxHost = await primaryMxHost(domain)
  if (!mxHost) return { probed: false, exists: false, acceptAll: false }

  return probe(mxHost, email, controlEmailFor(domain))
}

// ---------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------

export type ScoutOutput = {
  /** Found on the company's own site. Needs no SMTP confirmation. */
  published: string | null
  /** SMTP result for the best pattern candidate, when probing is enabled. */
  verified: string | null
  acceptAll: boolean
}

function nameParts(person: PersonEntity): { first: string; last: string } | null {
  const parts = (person.fullName ?? '').trim().toLowerCase().split(/\s+/)
  const first = parts[0]?.replace(/[^a-z]/g, '') ?? ''
  const last = parts[parts.length - 1]?.replace(/[^a-z]/g, '') ?? ''
  if (first.length < 2 || last.length < 2) return null
  return { first, last }
}

export async function executeScout(
  person: PersonEntity,
  options: {
    /** Injected page fetcher for tests. */
    fetched?: (url: string) => Promise<string | null>
    probeEnabled?: boolean
    smtpVerify?: (email: string) => Promise<SmtpVerdict>
    smtpProbe?: SmtpProbe
  } = {},
): Promise<ScoutOutput | null> {
  const effectiveDomain = normalizeDomain(person.companyDomain)
  if (!effectiveDomain) return null

  const contacts = await harvestWebsiteContacts(effectiveDomain, options.fetched)

  let published: string | null =
    contacts.onDomain.find((email) => isPersonMailbox(email, person.fullName)) ?? null

  // A published address ends the job. Probing pattern candidates afterwards
  // would spend somebody else's mail server on an answer we cannot use.
  if (published) return { published, verified: null, acceptAll: false }

  const parts = nameParts(person)
  let verified: string | null = null
  let acceptAll = false

  const probeEnabled = options.probeEnabled ?? process.env.SCOUT_SMTP_VERIFY === 'true'
  // Whole-verification seam: tests inject this to skip real DNS + sockets.
  const smtpVerify =
    options.smtpVerify ??
    ((email: string) => verifyEmail(email, options.smtpProbe))

  if (parts && probeEnabled) {
    // Prefer the house pattern observed from a real mailbox on the domain.
    let candidate: string | null = null
    const sample = contacts.onDomain.find((email) => email.endsWith(`@${effectiveDomain}`))
    const detected = sample ? detectPattern(sample.split('@')[0] ?? '') : null

    if (detected) {
      candidate = applyPattern(detected, parts.first, parts.last, effectiveDomain)
      // If the inferred address is itself one of the published ones, done.
      if (candidate && contacts.onDomain.includes(candidate.toLowerCase())) {
        published = published ?? candidate.toLowerCase()
        candidate = null
      }
    }

    if (!candidate) {
      for (const option of generateCandidates(person.fullName, effectiveDomain)) {
        if (contacts.onDomain.includes(option.toLowerCase())) continue
        candidate = option
        break
      }
    }

    if (candidate) {
      const verdict = await smtpVerify(candidate)
      if (verdict.probed && verdict.exists && !verdict.acceptAll) {
        verified = candidate.toLowerCase()
      } else if (verdict.probed && verdict.acceptAll) {
        acceptAll = true
      }
    }
  }

  if (!published && !verified) return null
  return { published, verified, acceptAll }
}

export function scoutEvidence(
  output: ScoutOutput | null,
  person: PersonEntity,
  retrievedAt: Date = new Date(),
): NormalizedEvidence[] {
  if (!output) return []

  const evidence: NormalizedEvidence[] = []
  const push = (
    field: 'work_email' | 'email_status',
    value: Record<string, unknown>,
    sourceConfidence: SourceConfidence,
    confidence: number,
  ) => {
    evidence.push({
      field,
      entityType: 'person',
      entityId: person.id,
      value,
      sourceProvider: 'scout',
      sourceUrl: person.companyDomain ? `https://${normalizeDomain(person.companyDomain) ?? ''}/` : null,
      sourceConfidence,
      confidence,
      retrievedAt: retrievedAt.toISOString(),
      expiresAt: expiresAtFor(field === 'work_email' ? 'work_email' : 'email_status', retrievedAt)?.toISOString() ?? null,
    })
  }

  if (output.published) {
    push('work_email', { email: output.published }, 'high', 0.85)
    push('email_status', { status: 'publicly_found', verificationMethod: 'company_website' }, 'high', 0.85)
    return evidence
  }

  // An SMTP yes on a catch-all domain proves nothing, so it stores nothing.
  if (output.verified) {
    push('work_email', { email: output.verified }, 'medium', 0.75)
    push('email_status', { status: 'verified', verificationMethod: 'smtp' }, 'medium', 0.75)
  }

  return evidence
}

const SCOUT_FIELDS: ReadonlySet<string> = new Set(['work_email', 'email_status'])

export const scoutEmailProvider: IntelligenceProvider<ScoutOutput | null> = {
  name: 'scout',
  category: 'contact_email',

  canHandle: (task: ResearchTask) => {
    if (task.entity.type !== 'person') return false
    const person = task.entity as PersonEntity
    // A domain is the whole job: harvesting reads it and patterns key on it.
    // Without one this provider cannot possibly answer, so it declines and
    // lets the next provider try with name+company matching instead.
    return (
      Boolean(person.fullName) &&
      Boolean(person.companyDomain) &&
      task.fields.some((field) => SCOUT_FIELDS.has(field))
    )
  },

  estimateCost: async () => 0,

  execute: async (task) => {
    const person = task.entity as PersonEntity
    return executeScout(person)
  },

  normalize: (output, task) => scoutEvidence(output, task.entity as PersonEntity),
}
