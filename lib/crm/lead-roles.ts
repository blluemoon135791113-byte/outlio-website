/**
 * Suggesting a lead's role(s) from their job title.
 *
 * PURE. The rules are DATA (`crm_lead_role_rules`, 0144) that an admin edits;
 * this file only knows how to apply them. No role name, keyword or system key
 * is compared here except `other`, the documented no-match fallback.
 *
 * THE RULE, per role:
 *   suggested  ⇔  any active TITLE keyword matches
 *              ∧  (the role has no active FUNCTION keywords
 *                  ∨ any FUNCTION keyword matches)
 *
 * The second clause is how "Manager" means Champion in Revenue Cycle without
 * making every Office Manager a Champion. A title may suggest several roles —
 * "Chief Information Officer" is a decision maker AND technical — and a title
 * that suggests none gets `other`.
 *
 * ⚠️ WHOLE WORDS, NOT SUBSTRINGS. "IT" must not match "Itinerary" or
 * "Security", and "Lead" must not match "Leadership"… which is a judgement:
 * "Team Leadership Coordinator" still matches on "Coordinator". Keywords of
 * several words ("Head of", "Revenue Cycle") match as a contiguous phrase.
 *
 * ⚠️ A SUGGESTION, NEVER A FACT. Nothing here is written over a person's
 * choice — the SQL writer (0152) skips any lead with `manual_at` set.
 */

export type RoleRule = {
  roleId: string
  matchKind: 'title' | 'function'
  keyword: string
}

export type ClassifierRole = {
  id: string
  systemKey: string | null
  isActive: boolean
}

export type Classifier = {
  roles: ClassifierRole[]
  rules: RoleRule[]
}

/** Lowercased word tokens. "VP, Revenue-Cycle (RCM)" → ["vp","revenue","cycle","rcm"]. */
export function tokens(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function containsPhrase(haystack: string[], phrase: string[]): boolean {
  if (phrase.length === 0 || phrase.length > haystack.length) return false
  outer: for (let i = 0; i + phrase.length <= haystack.length; i += 1) {
    for (let j = 0; j < phrase.length; j += 1) {
      if (haystack[i + j] !== phrase[j]) continue outer
    }
    return true
  }
  return false
}

/**
 * The role ids a title suggests. Empty for an empty title — no title is no
 * evidence, which is different from evidence of "other".
 */
export function classifyTitle(title: string | null | undefined, classifier: Classifier): string[] {
  const words = tokens(title ?? '')
  if (words.length === 0) return []

  const active = classifier.roles.filter((r) => r.isActive)
  const byRole = new Map<string, { title: string[][]; fn: string[][] }>()
  for (const rule of classifier.rules) {
    const phrase = tokens(rule.keyword)
    if (phrase.length === 0) continue
    const entry = byRole.get(rule.roleId) ?? { title: [], fn: [] }
    ;(rule.matchKind === 'title' ? entry.title : entry.fn).push(phrase)
    byRole.set(rule.roleId, entry)
  }

  const suggested: string[] = []
  for (const role of active) {
    if (role.systemKey === 'other') continue
    const entry = byRole.get(role.id)
    if (!entry || entry.title.length === 0) continue
    const titleHit = entry.title.some((p) => containsPhrase(words, p))
    if (!titleHit) continue
    const functionHit = entry.fn.length === 0 || entry.fn.some((p) => containsPhrase(words, p))
    if (functionHit) suggested.push(role.id)
  }

  if (suggested.length > 0) return suggested
  const other = active.find((r) => r.systemKey === 'other')
  return other ? [other.id] : []
}
