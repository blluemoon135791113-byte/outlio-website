import 'server-only'

/**
 * Contacts in the many shapes a public page states them.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  A PLAIN `mailto:` IS ONLY ONE FORMAT.                                    ║
 * ║                                                                          ║
 * ║  People publish contacts on forums, team pages, speaker lists and        ║
 * ║  member directories, and those write them as: "jane [at] acme [dot]      ║
 * ║  com"; a `data-email` attribute assembled by script; a Schema.org        ║
 * ║  `Person` in JSON-LD or microdata; an hCard. A forum puts many people on ║
 * ║  one page, so a contact there belongs to the post's AUTHOR, never to     ║
 * ║  whoever the post happens to mention.                                    ║
 * ║                                                                          ║
 * ║  Everything here is READ off the page (CLAUDE.md rule 4): a disguised    ║
 * ║  address is decoded, never completed; a name and a domain are never      ║
 * ║  joined into an address.                                                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * PURE over a cheerio tree. Called by `extractReadable` BEFORE boilerplate is
 * stripped, because a post's author and a card's name sit in exactly the
 * regions stripping removes.
 */
import type { CheerioAPI } from 'cheerio'

/** One person a page describes, with what it states about them. */
export type PersonCard = {
  name: string
  email: string | null
  phone: string | null
  title: string | null
  source: 'json-ld' | 'microdata' | 'hcard'
}

/** One forum or comment post: who wrote it, and what it says. */
export type Post = { author: string | null; text: string }

export type ContactFacts = {
  /** Addresses written in disguise or assembled from attributes, decoded. */
  emails: string[]
  people: PersonCard[]
  /** Forum software recognised, or null for an ordinary page. */
  platform: string | null
  posts: Post[]
}

const MAX_PEOPLE = 200
const MAX_POSTS = 200
const MAX_POST_CHARS = 5_000
/** All posts on one page together: a long thread is read, not held whole. */
const MAX_PAGE_POST_CHARS = 100_000

const clean = (value: string | null | undefined): string =>
  (value ?? '').replace(/\s+/g, ' ').trim()

const asEmail = (value: string | null | undefined): string | null => {
  const address = clean(value).replace(/^mailto:/i, '').split('?')[0] ?? ''
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(address) ? address.toLowerCase() : null
}

const asPhone = (value: string | null | undefined): string | null => {
  const phone = clean(value).replace(/^tel:/i, '')
  return phone.replace(/\D/g, '').length >= 7 ? phone : null
}

/* -------------------------------------------------------------------------- *
 * Disguised addresses
 * -------------------------------------------------------------------------- */

/**
 * `[at]`, `(at)`, `{at}`, `<at>` — bracketed, so a deliberate disguise, never
 * ordinary prose. The spaced ` @ ` and spelled ` at ` forms ARE prose-shaped
 * ("follow us @ twitter.com", "write to us at acme dot com") and are only read
 * right after a word that introduces an address (CONTEXT).
 */
const BRACKET_AT = String.raw`\s*(?:\[\s*at\s*\]|\(\s*at\s*\)|\{\s*at\s*\}|<\s*at\s*>)\s*`
/**
 * A disguised dot, or a plain `.` with NO space either side.
 *
 * ⚠️ A SPACED PLAIN DOT IS A SENTENCE BREAK. "Jane [at] Acme. Thanks" must
 * not become jane@acme.thanks — a decoded address is a reading, never a
 * reconstruction (rule 4).
 */
const DOT = String.raw`(?:\s*(?:\[\s*dot\s*\]|\(\s*dot\s*\)|\{\s*dot\s*\}|<\s*dot\s*>)\s*|\.)`
const LABEL = String.raw`[a-z0-9-]{1,63}`
const LOCAL = String.raw`([a-z0-9._%+-]{2,64})`
const BRACKETED = new RegExp(String.raw`${LOCAL}${BRACKET_AT}(${LABEL}(?:${DOT}${LABEL}){1,4})`, 'gi')
/** Introduces an address: only after one of these is a prose-shaped form read. */
const CONTEXT = String.raw`(?:e-?mail|mail|contact|write(?:\s+to)?|reach(?:\s+me)?)\b[^a-z0-9]{0,12}`
const SPACED = new RegExp(String.raw`${CONTEXT}${LOCAL}\s@\s(${LABEL}(?:\.${LABEL}){1,4})`, 'gi')
const SPELLED = new RegExp(String.raw`${CONTEXT}${LOCAL}\s+at\s+(${LABEL}(?:\s+dot\s+${LABEL}){1,4})\b`, 'gi')

/** Local parts that are prose or placeholders, never a mailbox someone published. */
const NOT_A_LOCAL = new Set([
  'us', 'me', 'we', 'you', 'him', 'her', 'them', 'it', 'name', 'yourname', 'your', 'email',
  'mail', 'user', 'username', 'someone', 'anyone', 'first', 'last', 'firstname', 'lastname',
  'address', 'here', 'xxx',
])
/** Domains that are placeholders in "format" examples. */
const NOT_A_DOMAIN = /^(?:domain|yourdomain|company|yourcompany|example|email|website|site|mysite|yoursite)\./i
/** Top-level domains accepted beyond two-letter country codes. */
const LONG_TLDS = new Set([
  'com', 'org', 'net', 'edu', 'gov', 'mil', 'int', 'info', 'biz', 'io', 'ai', 'app', 'dev',
  'tech', 'xyz', 'online', 'site', 'store', 'agency', 'company', 'studio', 'design', 'digital',
  'consulting', 'solutions', 'services', 'group', 'global', 'health', 'law', 'finance', 'capital',
  'ventures', 'partners', 'media', 'team', 'world', 'network', 'systems', 'software', 'cloud',
  'email', 'pro', 'name', 'coop', 'museum', 'travel', 'eu', 'asia',
])

/** At most this much page text is scanned for disguised addresses. */
const DISGUISE_SCAN_CHARS = 500_000
/** Cheap gate: a page with none of these markers has no disguised address. */
const MARKER = /\[\s*at\s*\]|\(\s*at\s*\)|\{\s*at\s*\}|<\s*at\s*>|\s@\s|\sat\s+\S+\s+dot\s/i

function rebuild(local: string, domain: string): string | null {
  if (NOT_A_LOCAL.has(local.toLowerCase()) || !/[a-z]/i.test(local)) return null
  const labels = domain.split(/\s*(?:\[\s*dot\s*\]|\(\s*dot\s*\)|\{\s*dot\s*\}|<\s*dot\s*>)\s*|\s+dot\s+|\./i).filter(Boolean)
  const tld = (labels.at(-1) ?? '').toLowerCase()
  if (labels.length < 2) return null
  if (!(/^[a-z]{2}$/.test(tld) || LONG_TLDS.has(tld))) return null
  const address = asEmail(`${local}@${labels.join('.')}`)
  return address && !NOT_A_DOMAIN.test(address.split('@')[1] ?? '') ? address : null
}

/** PURE. Addresses written to dodge harvesters, decoded exactly as written. */
export function decodeDisguisedEmails(text: string): string[] {
  const scanned = text.slice(0, DISGUISE_SCAN_CHARS)
  if (!MARKER.test(scanned)) return []
  const found = new Set<string>()
  for (const pattern of [BRACKETED, SPACED, SPELLED]) {
    for (const match of scanned.matchAll(pattern)) {
      const address = rebuild(match[1]!, match[2]!)
      if (address) found.add(address)
    }
  }
  return [...found]
}

/* -------------------------------------------------------------------------- *
 * People: JSON-LD, microdata, hCard
 * -------------------------------------------------------------------------- */

function isPersonType(type: unknown): boolean {
  return Array.isArray(type) ? type.some(isPersonType) : typeof type === 'string' && /(^|\/)Person$/i.test(type)
}

const firstString = (value: unknown): string | null =>
  typeof value === 'string' ? value : Array.isArray(value) ? firstString(value[0]) : null

/** PURE. Every `Person` anywhere in the JSON-LD — founders, employees, authors. */
export function jsonLdPeople(nodes: readonly unknown[]): PersonCard[] {
  const people: PersonCard[] = []
  const visit = (node: unknown, depth: number) => {
    if (depth > 8 || people.length >= MAX_PEOPLE || !node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1)
      return
    }
    const record = node as Record<string, unknown>
    if (isPersonType(record['@type'])) {
      const name = clean(firstString(record.name))
      if (name) {
        people.push({
          name,
          email: asEmail(firstString(record.email)),
          phone: asPhone(firstString(record.telephone)),
          title: clean(firstString(record.jobTitle)) || null,
          source: 'json-ld',
        })
      }
    }
    for (const value of Object.values(record)) if (value && typeof value === 'object') visit(value, depth + 1)
  }
  visit(nodes, 0)
  return people
}

function microdataPeople($: CheerioAPI): PersonCard[] {
  const people: PersonCard[] = []
  $('[itemtype*="schema.org/Person"]').slice(0, MAX_PEOPLE).each((_, element) => {
    const card = $(element)
    const prop = (name: string) => {
      const node = card.find(`[itemprop="${name}"]`).first()
      return node.attr('content') ?? node.attr('href') ?? node.text()
    }
    const name = clean(prop('name'))
    if (!name) return
    people.push({
      name,
      email: asEmail(prop('email')),
      phone: asPhone(prop('telephone')),
      title: clean(prop('jobTitle')) || null,
      source: 'microdata',
    })
  })
  return people
}

function hcardPeople($: CheerioAPI): PersonCard[] {
  const people: PersonCard[] = []
  $('.vcard, .h-card').slice(0, MAX_PEOPLE).each((_, element) => {
    const card = $(element)
    const name = clean(card.find('.fn, .p-name').first().text())
    if (!name) return
    const emailNode = card.find('.email, .u-email').first()
    const telNode = card.find('.tel, .p-tel').first()
    people.push({
      name,
      email: asEmail(emailNode.attr('href') ?? emailNode.text()),
      phone: asPhone(telNode.attr('href') ?? telNode.text()),
      title: clean(card.find('.title, .p-job-title, .role').first().text()) || null,
      source: 'hcard',
    })
  })
  return people
}

/* -------------------------------------------------------------------------- *
 * Forums
 * -------------------------------------------------------------------------- */

type ForumShape = { post: string; author: string; authorAttr?: string; body: string }

/**
 * The forum packages that host most public discussion, by their own markup.
 * Each names a post container, its author and its body. Matched on the
 * `generator` meta first, then on the markup itself.
 */
const FORUMS: ReadonlyArray<{ platform: string; generator?: RegExp; marker: string; shape: ForumShape }> = [
  { platform: 'discourse', generator: /discourse/i, marker: '.topic-post, #post_1',
    shape: { post: '.topic-post, [itemtype*="DiscussionForumPosting"], [itemtype*="Comment"]', author: '[itemprop="author"] [itemprop="name"], .username, .creator span', body: '.cooked, [itemprop="text"], [itemprop="articleBody"]' } },
  { platform: 'xenforo', generator: /xenforo/i, marker: 'article.message',
    shape: { post: 'article.message', author: '.message-name .username, .username', authorAttr: 'data-author', body: '.message-body .bbWrapper, .message-body' } },
  { platform: 'phpbb', generator: /phpbb/i, marker: '.postbody',
    shape: { post: '.post', author: '.author .username, .username, .username-coloured', body: '.content' } },
  { platform: 'vbulletin', generator: /vbulletin/i, marker: '.postbit, .postcontainer, .postbitlegacy',
    shape: { post: '.postbit, .postcontainer, .postbitlegacy', author: '.username', body: '.postcontent, .post_message, .content' } },
  { platform: 'invision', generator: /invision/i, marker: 'article.cPost',
    shape: { post: 'article.cPost', author: '.cAuthorPane_author a, .cAuthorPane_author', body: '[data-role="commentContent"]' } },
  { platform: 'flarum', generator: /flarum/i, marker: '.PostStream-item',
    shape: { post: '.PostStream-item .Post, .Post', author: '.PostUser-name .username, .username', body: '.Post-body' } },
  { platform: 'mybb', generator: /mybb/i, marker: '.post_body',
    shape: { post: '.post', author: '.author_information .largetext a, .post_author a', body: '.post_body' } },
  { platform: 'stackexchange', marker: '.js-post-body, #question',
    shape: { post: '.question, .answer', author: '.user-details a', body: '.js-post-body, .s-prose' } },
  { platform: 'reddit', marker: '.thing.comment, shreddit-comment',
    shape: { post: '.thing.comment, .thing.link, shreddit-comment', author: '.author', authorAttr: 'data-author', body: '.md, [slot="comment"]' } },
  // Any page marked up as a discussion, whatever runs it.
  { platform: 'schema-discussion', marker: '[itemtype*="DiscussionForumPosting"], [itemtype*="schema.org/Comment"]',
    shape: { post: '[itemtype*="DiscussionForumPosting"], [itemtype*="schema.org/Comment"]', author: '[itemprop="author"] [itemprop="name"], [itemprop="author"]', body: '[itemprop="text"], [itemprop="articleBody"]' } },
]

function readPosts($: CheerioAPI): { platform: string | null; posts: Post[] } {
  const generator = $('meta[name="generator"]').attr('content') ?? ''
  const forum =
    FORUMS.find((candidate) => candidate.generator?.test(generator)) ??
    FORUMS.find((candidate) => $(candidate.marker).length > 0)
  if (!forum) return { platform: null, posts: [] }

  const posts: Post[] = []
  let total = 0
  $(forum.shape.post).slice(0, MAX_POSTS).each((_, element) => {
    const post = $(element)
    const bodyNode = post.find(forum.shape.body).first()
    // No body of its own: the post's whole text would include its replies.
    if (bodyNode.length === 0) return
    /*
     * ⚠️ THE AUTHOR COMES FROM THE POST'S OWN HEADER. A quote inside the body
     * carries the QUOTED user's name in the same markup, and Stack Exchange
     * shows an editor beside the author. Names inside the body are ignored;
     * two different names outside it make the post's author unknown.
     */
    const outsideBody = post
      .find(forum.shape.author)
      .filter((_, node) => $(node).closest(forum.shape.body).length === 0)
      .map((_, node) => clean($(node).text()))
      .get()
      .filter(Boolean)
    const fromAttr = clean(forum.shape.authorAttr ? post.attr(forum.shape.authorAttr) : null)
    const names = new Set(fromAttr ? [fromAttr] : outsideBody)
    const author = names.size === 1 ? [...names][0]! : null
    const text = clean(bodyNode.text()).slice(0, MAX_POST_CHARS)
    if (!text || total >= MAX_PAGE_POST_CHARS) return
    total += text.length
    posts.push({ author, text })
  })
  return { platform: forum.platform, posts }
}

/* -------------------------------------------------------------------------- *
 * Entry point
 * -------------------------------------------------------------------------- */

/** Addresses assembled from attributes: `data-email`, or `data-user` + `data-domain`. */
function attributeEmails($: CheerioAPI): string[] {
  const found: string[] = []
  $('[data-email], [data-mail]').slice(0, 100).each((_, element) => {
    const address = asEmail($(element).attr('data-email') ?? $(element).attr('data-mail'))
    if (address) found.push(address)
  })
  $('[data-user][data-domain]').slice(0, 100).each((_, element) => {
    const address = asEmail(`${$(element).attr('data-user')}@${$(element).attr('data-domain')}`)
    if (address) found.push(address)
  })
  return found
}

/**
 * PURE. Everything this module reads off one page.
 *
 * `$` must still hold the page's header, footer and asides (scripts may be
 * gone). `jsonLd` is what `extractReadable` already parsed.
 */
export function readContactFacts($: CheerioAPI, jsonLd: readonly unknown[]): ContactFacts {
  const text = $.root().text().slice(0, 2_000_000)
  const people = [...jsonLdPeople(jsonLd), ...microdataPeople($), ...hcardPeople($)].slice(0, MAX_PEOPLE)
  const { platform, posts } = readPosts($)
  return {
    emails: [...new Set([...decodeDisguisedEmails(text), ...attributeEmails($)])],
    people,
    platform,
    posts,
  }
}
