/**
 * One-time/idempotent repair: re-checks phone numbers saved before their
 * country could be read.
 *
 * Usage (dry run, then write):
 *   npx vite-node --config vitest.config.mts scripts/recheck-saved-phones.ts
 *   npx vite-node --config vitest.config.mts scripts/recheck-saved-phones.ts --apply
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ UPGRADE ONLY. A saved number is never dropped or marked invalid.     ║
 * ║                                                                          ║
 * ║  Phones saved before the verifier, or before a lead's metro ("Greater   ║
 * ║  Phoenix Area") or a company's leads could name a country, were kept as ║
 * ║  `unverified` / `publicly_found`. Their evidence is re-judged with what ║
 * ║  the location reads as today; only a `valid_*` verdict is written. A    ║
 * ║  number that still cannot be judged, or now reads invalid, is counted   ║
 * ║  and left exactly as it was.                                            ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import { loadEnvConfig } from '@next/env'

import { checkPhone, regionFromLocation, type PhoneCheck } from '@/lib/intelligence/verify-contact'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/types/database'

/** Statuses a saved phone may hold that mean "not checked against a country". */
const RECHECKABLE: ReadonlySet<string> = new Set(['unverified', 'publicly_found'])

export type SavedPhoneEvidence = {
  id: string
  entityType: string
  entityId: string
  field: string
  value: Record<string, unknown>
}

export type LeadPlace = { id: string; companyId: string | null; location: string | null }

export type PhoneRecheckPlan = {
  /** Evidence rows to rewrite, with their new value. */
  evidence: { id: string; value: Record<string, unknown> }[]
  /** Company projections to upgrade: only where the column still holds this phone. */
  companies: { id: string; phone: string; status: string }[]
  examined: number
  upgraded: Record<string, number>
  /** No country, or not a real number for it — left as saved. */
  stillUnchecked: number
  /** Would read invalid now. Left as saved; never dropped by a repair. */
  readInvalid: number
}

function savedStatus(item: SavedPhoneEvidence): string | null {
  if (item.field === 'company_contact_phone') return typeof item.value.status === 'string' ? item.value.status : null
  const verification = item.value.verification as { status?: unknown } | undefined
  return typeof verification?.status === 'string' ? verification.status : null
}

/**
 * PURE. Which saved phones a location now lets us check, and what to write.
 *
 * Locations follow the enrichment run: a company's headquarters, else any of
 * its leads' locations that names a country; a person's own location.
 */
export function planPhoneRechecks(
  items: readonly SavedPhoneEvidence[],
  headquarters: ReadonlyMap<string, string | null>,
  leads: readonly LeadPlace[],
): PhoneRecheckPlan {
  const plan: PhoneRecheckPlan = { evidence: [], companies: [], examined: 0, upgraded: {}, stillUnchecked: 0, readInvalid: 0 }
  const leadById = new Map(leads.map((lead) => [lead.id, lead]))
  const regionFor = (item: SavedPhoneEvidence) => {
    if (item.entityType === 'person') return regionFromLocation(leadById.get(item.entityId)?.location)
    const own = regionFromLocation(headquarters.get(item.entityId))
    if (own) return own
    for (const lead of leads) {
      if (lead.companyId !== item.entityId) continue
      const region = regionFromLocation(lead.location)
      if (region) return region
    }
    return null
  }

  // A person's status companion follows the first of their phones that passes.
  const personVerdict = new Map<string, PhoneCheck>()
  for (const item of items) {
    if (item.field !== 'company_contact_phone' && item.field !== 'mobile_phone') continue
    const saved = savedStatus(item)
    if (saved !== null && !RECHECKABLE.has(saved)) continue
    const phone = typeof item.value.phone === 'string' ? item.value.phone : ''
    if (!phone) continue
    plan.examined += 1
    const check = checkPhone(phone, regionFor(item))
    if (check.status === 'invalid') {
      plan.readInvalid += 1
      continue
    }
    if (!check.status.startsWith('valid_')) {
      plan.stillUnchecked += 1
      continue
    }
    plan.upgraded[check.status] = (plan.upgraded[check.status] ?? 0) + 1
    if (item.field === 'company_contact_phone') {
      plan.evidence.push({ id: item.id, value: { ...item.value, status: check.status, verification: check } })
      plan.companies.push({ id: item.entityId, phone, status: check.status })
    } else {
      plan.evidence.push({ id: item.id, value: { ...item.value, verification: check } })
      if (!personVerdict.has(item.entityId)) personVerdict.set(item.entityId, check)
    }
  }

  for (const item of items) {
    if (item.field !== 'phone_status') continue
    const verdict = personVerdict.get(item.entityId)
    const saved = typeof item.value.status === 'string' ? item.value.status : null
    if (!verdict || (saved !== null && !RECHECKABLE.has(saved))) continue
    plan.evidence.push({
      id: item.id,
      value: { ...item.value, status: verdict.status, foundAs: item.value.foundAs ?? saved },
    })
  }
  return plan
}

export type PhoneRecheckOutcome = Omit<PhoneRecheckPlan, 'evidence' | 'companies'> & {
  users: number
  evidenceWritten: number
  companiesWritten: number
}

const PAGE = 1_000

async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string } | null }>, what: string): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) throw new Error(`${what} read failed: ${error.code ?? 'unknown'}`)
    rows.push(...(data ?? []))
    if ((data ?? []).length < PAGE) return rows
  }
}

/** Re-checks every user's saved phones. Writes nothing unless `apply`. */
export async function recheckSavedPhones(options: { apply: boolean }): Promise<PhoneRecheckOutcome> {
  const db = createAdminClient()
  const outcome: PhoneRecheckOutcome = {
    users: 0, examined: 0, upgraded: {}, stillUnchecked: 0, readInvalid: 0, evidenceWritten: 0, companiesWritten: 0,
  }

  const owners = await readAll<{ user_id: string }>(
    (from, to) => db.from('research_evidence').select('user_id').in('field', ['company_contact_phone', 'mobile_phone']).order('id').range(from, to),
    'phone owners',
  )
  for (const userId of new Set(owners.map((row) => row.user_id))) {
    outcome.users += 1
    // Service role bypasses RLS — every read and write below is scoped by user_id.
    const evidence = await readAll<{ id: string; entity_type: string; entity_id: string; field: string; value_json: unknown }>(
      (from, to) => db.from('research_evidence')
        .select('id, entity_type, entity_id, field, value_json')
        .eq('user_id', userId)
        .in('field', ['company_contact_phone', 'mobile_phone', 'phone_status'])
        .order('id')
        .range(from, to),
      'phone evidence',
    )
    const items: SavedPhoneEvidence[] = evidence.map((row) => ({
      id: row.id, entityType: row.entity_type, entityId: row.entity_id, field: row.field, value: (row.value_json ?? {}) as Record<string, unknown>,
    }))
    const companyIds = [...new Set(items.filter((item) => item.entityType === 'company').map((item) => item.entityId))]
    const personIds = [...new Set(items.filter((item) => item.entityType === 'person').map((item) => item.entityId))]

    const headquarters = new Map<string, string | null>()
    const leads: LeadPlace[] = []
    for (let i = 0; i < companyIds.length; i += 200) {
      const slice = companyIds.slice(i, i + 200)
      const { data: companies, error } = await db.from('companies').select('id, headquarters').eq('user_id', userId).in('id', slice)
      if (error) throw new Error(`companies read failed: ${error.code ?? 'unknown'}`)
      for (const row of companies ?? []) headquarters.set(row.id as string, (row.headquarters as string | null) ?? null)
      const { data: byCompany, error: leadError } = await db.from('extracted_leads').select('id, company_id, location').eq('user_id', userId).in('company_id', slice)
      if (leadError) throw new Error(`leads read failed: ${leadError.code ?? 'unknown'}`)
      for (const row of byCompany ?? []) leads.push({ id: row.id as string, companyId: (row.company_id as string | null) ?? null, location: (row.location as string | null) ?? null })
    }
    for (let i = 0; i < personIds.length; i += 200) {
      const { data: people, error } = await db.from('extracted_leads').select('id, company_id, location').eq('user_id', userId).in('id', personIds.slice(i, i + 200))
      if (error) throw new Error(`leads read failed: ${error.code ?? 'unknown'}`)
      for (const row of people ?? []) leads.push({ id: row.id as string, companyId: (row.company_id as string | null) ?? null, location: (row.location as string | null) ?? null })
    }

    const plan = planPhoneRechecks(items, headquarters, leads)
    outcome.examined += plan.examined
    outcome.stillUnchecked += plan.stillUnchecked
    outcome.readInvalid += plan.readInvalid
    for (const [status, count] of Object.entries(plan.upgraded)) outcome.upgraded[status] = (outcome.upgraded[status] ?? 0) + count
    if (!options.apply) continue

    for (const row of plan.evidence) {
      const { error } = await db.from('research_evidence').update({ value_json: row.value as Json }).eq('id', row.id).eq('user_id', userId)
      if (error) throw new Error(`phone evidence write failed: ${error.code ?? 'unknown'}`)
      outcome.evidenceWritten += 1
    }
    for (const company of plan.companies) {
      const { data, error } = await db.from('companies')
        .update({ contact_phone_status: company.status })
        .eq('id', company.id)
        .eq('user_id', userId)
        // Only the projection of THIS phone, and only if nothing has judged it since.
        .eq('contact_phone', company.phone)
        .in('contact_phone_status', [...RECHECKABLE])
        .select('id')
      if (error) throw new Error(`company phone status write failed: ${error.code ?? 'unknown'}`)
      outcome.companiesWritten += (data ?? []).length
    }
  }
  return outcome
}

async function main() {
  loadEnvConfig(process.cwd())
  const apply = process.argv.includes('--apply')
  const outcome = await recheckSavedPhones({ apply })
  console.log(`${apply ? 'Applied' : 'Dry run'}: ${JSON.stringify(outcome)}`)
}

// Run only under vite-node (which drops the script path from argv); the unit test imports the planner.
if (process.argv[1]?.includes('vite-node')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Phone re-check failed.')
    process.exitCode = 1
  })
}
