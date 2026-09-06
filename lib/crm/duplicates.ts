import 'server-only'

/**
 * Duplicate detection and merging (M2 Phase 4).
 *
 * ⚠️ NOTHING HERE MERGES ANYTHING BY ITSELF. `scanWorkspaceForDuplicates`
 * proposes; `mergeContacts` runs only when a person asks. Never silently merge
 * uncertain people.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  WHY BLOCKING ON THREE KEYS IS COMPLETE, NOT A HEURISTIC.                ║
 * ║                                                                          ║
 * ║  Comparing every contact against every other is O(n²) and unusable past  ║
 * ║  a few thousand people, so detection only compares pairs that share a    ║
 * ║  COMPANY, a PHONE NUMBER, or an EMAIL DOMAIN.                            ║
 * ║                                                                          ║
 * ║  That is not a corner cut. In `lib/crm/dedupe.ts` a name on its own      ║
 * ║  carries at most 55 points against a threshold of 60, so EVERY candidate ║
 * ║  must have at least one corroborating signal — and those three are the   ║
 * ║  only corroborating signals that exist. A pair sharing none of them      ║
 * ║  cannot reach 60 by construction.                                        ║
 * ║                                                                          ║
 * ║  ⚠️ Add a fourth corroborating signal to the scorer and this blocking    ║
 * ║  stops being complete. `tests/unit/crm-dedupe.test.ts` asserts the       ║
 * ║  ceiling that makes the argument hold.                                   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import { normalizeDomain } from '@/lib/companies/normalize'
import {
  orderPair,
  scoreContactPair,
  type CandidateScore,
  type ContactFacts,
} from '@/lib/crm/dedupe'
import { normalizeEmail } from '@/lib/crm/normalize'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/types/database'

export type ScanResult = {
  contactsScanned: number
  pairsCompared: number
  candidatesWritten: number
  /** Blocks skipped for being too large to pair. See `MAX_BLOCK`. */
  blocksSkipped: number
}

/**
 * A block bigger than this is not paired.
 *
 * A 400-person company is 79,800 pairs on its own. Blocks are therefore
 * sub-divided by surname prefix first (see `subBlock`), and anything still
 * over this after that is a key too weak to be worth the comparisons — a
 * shared domain across hundreds of people says nothing about identity.
 *
 * Reported rather than silent: `blocksSkipped` tells the caller detection was
 * incomplete, instead of implying a clean scan.
 */
const MAX_BLOCK = 120

/**
 * Surname prefix used to sub-divide a block.
 *
 * Three characters, so a surname typo past the third letter still collides
 * ("ellis" and "elliss" both give "ell"). A full surname match would miss
 * exactly the misspellings detection is for.
 */
function surnameKey(fullName: string | null): string {
  if (!fullName) return ''
  const tokens = fullName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)

  return (tokens.at(-1) ?? '').slice(0, 3)
}

type Loaded = {
  facts: Map<string, ContactFacts>
  blocks: Map<string, string[]>
}

async function loadWorkspace(workspaceId: string): Promise<Loaded> {
  const db = createAdminClient()

  const { data: contacts, error } = await db
    .from('crm_contacts')
    .select('id, full_name, linkedin_identity_key')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)

  if (error) throw new Error(`scanWorkspaceForDuplicates failed: ${error.message}`)

  const facts = new Map<string, ContactFacts>()
  for (const contact of contacts ?? []) {
    facts.set(contact.id, {
      fullName: contact.full_name,
      linkedInIdentityKey: contact.linkedin_identity_key,
      emailIdentityKeys: [],
      phoneE164s: [],
      companyIds: [],
      emailDomains: [],
    })
  }

  const blocks = new Map<string, string[]>()
  const addToBlock = (key: string, contactId: string) => {
    const bucket = blocks.get(key)
    if (bucket) bucket.push(contactId)
    else blocks.set(key, [contactId])
  }

  const { data: emails, error: emailError } = await db
    .from('crm_contact_emails')
    .select('contact_id, address, identity_key')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)

  if (emailError) throw new Error(`scanWorkspaceForDuplicates failed: ${emailError.message}`)

  for (const row of emails ?? []) {
    const entry = facts.get(row.contact_id)
    if (!entry) continue
    entry.emailIdentityKeys.push(row.identity_key)

    // `normalizeDomain` returns null for mailbox providers, so a shared
    // gmail.com never becomes a block — which is the whole point, since it
    // would put half the workspace in one bucket and say nothing.
    const domain = normalizeDomain(normalizeEmail(row.address)?.domain ?? null)
    if (!domain) continue
    entry.emailDomains.push(domain)
    addToBlock(`domain:${domain}`, row.contact_id)
  }

  const { data: phones, error: phoneError } = await db
    .from('crm_contact_phones')
    .select('contact_id, e164')
    .eq('workspace_id', workspaceId)
    .not('e164', 'is', null)
    .is('deleted_at', null)

  if (phoneError) throw new Error(`scanWorkspaceForDuplicates failed: ${phoneError.message}`)

  for (const row of phones ?? []) {
    const entry = facts.get(row.contact_id)
    if (!entry || !row.e164) continue
    entry.phoneE164s.push(row.e164)
    addToBlock(`phone:${row.e164}`, row.contact_id)
  }

  const { data: employment, error: employmentError } = await db
    .from('crm_contact_company_relationships')
    .select('contact_id, company_id')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)

  if (employmentError) {
    throw new Error(`scanWorkspaceForDuplicates failed: ${employmentError.message}`)
  }

  for (const row of employment ?? []) {
    const entry = facts.get(row.contact_id)
    if (!entry) continue
    entry.companyIds.push(row.company_id)
    addToBlock(`company:${row.company_id}`, row.contact_id)
  }

  return { facts, blocks }
}

/**
 * Splits a block by surname prefix so a large company does not become a
 * quadratic comparison. Members with no usable surname are dropped rather than
 * lumped together — an empty key would rebuild the very bucket this avoids.
 */
function subBlock(members: string[], facts: Map<string, ContactFacts>): string[][] {
  const groups = new Map<string, string[]>()

  for (const id of members) {
    const key = surnameKey(facts.get(id)?.fullName ?? null)
    if (!key) continue
    const bucket = groups.get(key)
    if (bucket) bucket.push(id)
    else groups.set(key, [id])
  }

  return [...groups.values()].filter((group) => group.length > 1)
}

/**
 * Scans a workspace and records duplicate candidates.
 *
 * ⚠️ Re-runnable. A pair a person already resolved or ignored is left exactly
 * as it is — re-flagging a rejected pair on every scan is how a Duplicate
 * Center becomes something people stop opening.
 */
export async function scanWorkspaceForDuplicates(
  workspaceId: string,
): Promise<ScanResult> {
  const { facts, blocks } = await loadWorkspace(workspaceId)

  const scored = new Map<string, { a: string; b: string; result: CandidateScore }>()
  let pairsCompared = 0
  let blocksSkipped = 0

  for (const members of blocks.values()) {
    if (members.length < 2) continue

    const groups = members.length > MAX_BLOCK ? subBlock(members, facts) : [members]

    for (const group of groups) {
      if (group.length > MAX_BLOCK) {
        blocksSkipped += 1
        continue
      }

      const unique = [...new Set(group)]
      for (let i = 0; i < unique.length; i += 1) {
        for (let j = i + 1; j < unique.length; j += 1) {
          const [a, b] = orderPair(unique[i]!, unique[j]!)
          const key = `${a}:${b}`
          // Two contacts can share a company AND a phone; the pair is one
          // candidate, scored once.
          if (scored.has(key)) continue

          const left = facts.get(a)
          const right = facts.get(b)
          if (!left || !right) continue

          pairsCompared += 1
          const result = scoreContactPair(left, right)
          if (result.confidence === 'none') continue

          scored.set(key, { a, b, result })
        }
      }
    }
  }

  const candidatesWritten = await writeCandidates(workspaceId, [...scored.values()])

  return {
    contactsScanned: facts.size,
    pairsCompared,
    candidatesWritten,
    blocksSkipped,
  }
}

async function writeCandidates(
  workspaceId: string,
  found: { a: string; b: string; result: CandidateScore }[],
): Promise<number> {
  if (found.length === 0) return 0
  const db = createAdminClient()

  // Existing rows are read first so a resolved or ignored decision is never
  // overwritten. `ON CONFLICT DO UPDATE` alone would need a WHERE on the
  // excluded row's status, which is easy to get subtly wrong; reading is
  // clearer and the volume is small.
  const { data: existing, error } = await db
    .from('crm_duplicate_candidates')
    .select('record_a_id, record_b_id, status')
    .eq('workspace_id', workspaceId)
    .eq('entity', 'contact')

  if (error) throw new Error(`writeCandidates failed: ${error.message}`)

  const decided = new Set(
    (existing ?? [])
      .filter((row) => row.status !== 'open')
      .map((row) => `${row.record_a_id}:${row.record_b_id}`),
  )

  const rows = found
    .filter((entry) => !decided.has(`${entry.a}:${entry.b}`))
    .map((entry) => ({
      workspace_id: workspaceId,
      entity: 'contact' as const,
      record_a_id: entry.a,
      record_b_id: entry.b,
      score: entry.result.score,
      confidence: entry.result.confidence as 'exact' | 'possible',
      signals: entry.result.signals as unknown as Json,
      summary: entry.result.summary,
    }))

  if (rows.length === 0) return 0

  const { error: upsertError } = await db
    .from('crm_duplicate_candidates')
    .upsert(rows, { onConflict: 'workspace_id,entity,record_a_id,record_b_id' })

  if (upsertError) throw new Error(`writeCandidates failed: ${upsertError.message}`)
  return rows.length
}

// ---------------------------------------------------------------------------
// Duplicate Center
// ---------------------------------------------------------------------------

export type DuplicateCenterTab = 'exact' | 'possible' | 'resolved' | 'ignored'

export type DuplicateCandidate = {
  id: string
  recordAId: string
  recordBId: string
  score: number
  confidence: 'exact' | 'possible'
  summary: string
  signals: { kind: string; weight: number; reason: string }[]
  status: string
  detectedAt: string
}

/** The four tabs of the Duplicate Center, newest and strongest first. */
export async function listDuplicateCandidates(
  workspaceId: string,
  tab: DuplicateCenterTab,
  options: { limit?: number; offset?: number } = {},
): Promise<DuplicateCandidate[]> {
  const limit = Math.min(options.limit ?? 50, 200)
  const offset = options.offset ?? 0

  let query = createAdminClient()
    .from('crm_duplicate_candidates')
    .select('id, record_a_id, record_b_id, score, confidence, summary, signals, status, detected_at')
    .eq('workspace_id', workspaceId)
    .eq('entity', 'contact')

  if (tab === 'exact' || tab === 'possible') {
    query = query.eq('status', 'open').eq('confidence', tab)
  } else if (tab === 'resolved') {
    query = query.eq('status', 'resolved')
  } else {
    query = query.eq('status', 'ignored')
  }

  const { data, error } = await query
    .order('score', { ascending: false })
    .order('detected_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) throw new Error(`listDuplicateCandidates failed: ${error.message}`)

  return (data ?? []).map((row) => ({
    id: row.id,
    recordAId: row.record_a_id,
    recordBId: row.record_b_id,
    score: row.score,
    confidence: row.confidence as 'exact' | 'possible',
    summary: row.summary,
    signals: (row.signals as unknown as DuplicateCandidate['signals']) ?? [],
    status: row.status,
    detectedAt: row.detected_at,
  }))
}

/**
 * Records that a pair is NOT a duplicate.
 *
 * Remembered permanently, because detection is re-runnable: without this the
 * same rejected pair reappears on every scan and the Center fills with
 * questions the user has already answered.
 */
export async function ignoreCandidate(
  workspaceId: string,
  candidateId: string,
  actorUserId: string | null = null,
): Promise<void> {
  const { error } = await createAdminClient()
    .from('crm_duplicate_candidates')
    .update({
      status: 'ignored',
      resolution: 'not_duplicate',
      resolved_at: new Date().toISOString(),
      resolved_by: actorUserId,
    })
    .eq('workspace_id', workspaceId)
    .eq('id', candidateId)
    .eq('status', 'open')

  if (error) throw new Error(`ignoreCandidate failed: ${error.message}`)
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

export type MergeResult = {
  mergeEventId: string
  survivingId: string
  mergedId: string
  moved: Record<string, number>
}

export class MergeConflictError extends Error {}

/**
 * Merges one contact into another.
 *
 * All the hard parts are in `crm_merge_contacts` (0074): both rows are locked
 * in a deterministic order, every child table is moved with its own collision
 * rule, and the merge is recorded. This wrapper exists to translate a lost
 * race into something a caller can show a person.
 */
export async function mergeContacts(
  workspaceId: string,
  survivingId: string,
  mergedId: string,
  actorUserId: string | null = null,
): Promise<MergeResult> {
  const { data, error } = await createAdminClient().rpc('crm_merge_contacts', {
    p_workspace_id: workspaceId,
    p_survivor_id: survivingId,
    p_merged_id: mergedId,
    // Omitted rather than passed as null: the generated signature is
    // `p_actor_id?: string`, because the function declares a default. Same
    // shape as `p_member_limit` on redeem_workspace_invitation.
    ...(actorUserId === null ? {} : { p_actor_id: actorUserId }),
  })

  if (error) {
    // Someone merged this pair between the page loading and the click. Not an
    // internal error — the work is already done, and the caller should say so
    // rather than showing a stack trace.
    if (/already been merged or deleted/i.test(error.message)) {
      throw new MergeConflictError(
        'That contact has already been merged. Refresh to see the current record.',
      )
    }
    throw new Error(`mergeContacts failed: ${error.message}`)
  }

  const result = data as unknown as {
    merge_event_id: string
    surviving_id: string
    merged_id: string
    moved: Record<string, number>
  }

  return {
    mergeEventId: result.merge_event_id,
    survivingId: result.surviving_id,
    mergedId: result.merged_id,
    moved: result.moved ?? {},
  }
}

/**
 * Follows a merged contact forward to the record that survives.
 *
 * A stale id — from a bookmark, a webhook payload, an export — must not become
 * a dead end. Bounded, because a corrupted chain must not spin forever.
 */
export async function resolveContactId(
  workspaceId: string,
  contactId: string,
  maxHops = 10,
): Promise<string | null> {
  const db = createAdminClient()
  let current = contactId

  for (let hop = 0; hop < maxHops; hop += 1) {
    const { data, error } = await db
      .from('crm_contacts')
      .select('id, deleted_at, merged_into_id')
      .eq('workspace_id', workspaceId)
      .eq('id', current)
      .maybeSingle()

    if (error) throw new Error(`resolveContactId failed: ${error.message}`)
    if (!data) return null
    if (!data.deleted_at) return data.id
    if (!data.merged_into_id) return null

    current = data.merged_into_id
  }

  return null
}
