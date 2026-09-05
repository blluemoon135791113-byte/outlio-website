import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'

/**
 * Phase 3's journey: a value on screen can be traced to where it came from.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE UNIT TESTS PROVE THE MAPPING. THIS PROVES A PERSON CAN SEE IT.    ║
 * ║                                                                           ║
 * ║  `withProvenance` can be correct while the page renders none of it, and   ║
 * ║  every unit test still passes — which is the shape of every serious bug   ║
 * ║  this project has found. 2,294 evidence rows sat in production, correctly ║
 * ║  stored and entirely invisible, for exactly that reason.                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

function stagingEnv(): Record<string, string> {
  if (!existsSync('.env.staging')) return {}
  const out: Record<string, string> = {}
  for (const line of readFileSync('.env.staging', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]!] = m[2]!.trim()
  }
  return out
}

const ENV = stagingEnv()
const hasStaging = Boolean(ENV.NEXT_PUBLIC_SUPABASE_URL && ENV.SUPABASE_SERVICE_ROLE_KEY)

function admin(): SupabaseClient {
  return createClient(ENV.NEXT_PUBLIC_SUPABASE_URL!, ENV.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

const CITED = `cited-${Date.now()}@example.com`
const TYPED = `typed-${Date.now()}@example.com`

async function makeFixture() {
  const db = admin()
  const token = randomBytes(32).toString('base64url')
  await db.rpc('reserve_signup_ip', {
    p_ip_hash: createHash('sha256').update(`prov:${Date.now()}`).digest('hex'),
    p_token_hash: createHash('sha256').update(token).digest('hex'),
    p_reservation_seconds: 600,
  })
  const h = (k: string) =>
    createHash('sha256').update(`${k}:${Date.now()}:${Math.random()}`).digest('hex')

  const email = `outlio-e2e-prov-${Date.now()}@example.com`
  const password = `E2e-${randomBytes(9).toString('base64url')}-Aa1!`

  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: 'Provenance Tester',
      signup_reservation_token: token,
      signup_device_hash: h('d'),
      signup_email_hash: h('e'),
      signup_phone_hash: h('p'),
      signup_linkedin_hash: h('l'),
    },
  })
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`)
  const userId = data.user.id

  const { data: plan } = await db.from('plans').select('id').eq('key', 'custom').single()
  await db.from('profiles').update({ role: 'approved_user', plan_id: plan!.id }).eq('id', userId)

  const { data: workspace } = await db
    .from('workspaces')
    .select('id')
    .eq('owner_user_id', userId)
    .single()

  // A researched contact: lead → evidence → contact, the real shape.
  const { data: job } = await db
    .from('extraction_jobs')
    .insert({ user_id: userId })
    .select('id')
    .single()
  const { data: lead } = await db
    .from('extracted_leads')
    .insert({
      user_id: userId,
      extraction_job_id: job!.id,
      full_name: 'Researched Person',
      dedupe_key: `prov-${Date.now()}`,
      dedupe_strategy: 'row_hash',
    })
    .select('id')
    .single()

  const { data: evidence } = await db
    .from('research_evidence')
    .insert({
      user_id: userId,
      entity_type: 'person',
      entity_id: lead!.id,
      field: 'work_email',
      // Keyed per field — a generic `value` key is silently ignored.
      value_json: { email: CITED },
      source_provider: 'e2e-provider',
      source_url: 'https://example.com/found-here',
      source_confidence: 'high',
      confidence: 0.91,
      retrieved_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  const { data: researched } = await db
    .from('crm_contacts')
    .insert({
      workspace_id: workspace!.id,
      full_name: 'Researched Person',
      source: 'lead_engine',
      source_lead_id: lead!.id,
    })
    .select('id')
    .single()

  await db.from('crm_contact_emails').insert({
    workspace_id: workspace!.id,
    contact_id: researched!.id,
    address: CITED,
    identity_key: CITED,
    is_primary: true,
    source: 'lead_engine',
    evidence_id: evidence!.id,
  })

  // A hand-entered contact, so "entered" and "researched" can be told apart.
  const { data: typed } = await db
    .from('crm_contacts')
    .insert({ workspace_id: workspace!.id, full_name: 'Typed Person', source: 'manual' })
    .select('id')
    .single()

  await db.from('crm_contact_emails').insert({
    workspace_id: workspace!.id,
    contact_id: typed!.id,
    address: TYPED,
    identity_key: TYPED,
    is_primary: true,
    source: 'manual',
  })

  return { userId, email, password, researchedId: researched!.id, typedId: typed!.id }
}

test.describe('provenance is visible', () => {
  test.skip(!hasStaging, '.env.staging is required — see ADR-005')
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(120_000)

  let fx: Awaited<ReturnType<typeof makeFixture>>

  test.beforeAll(async () => {
    fx = await makeFixture()
  })

  test.afterAll(async () => {
    if (fx?.userId) await admin().auth.admin.deleteUser(fx.userId)
  })

  test('a researched value shows its source; a typed one says so instead', async ({ page }) => {
    const hosts = new Set<string>()
    page.on('request', (r) => {
      const { hostname } = new URL(r.url())
      if (hostname.endsWith('.supabase.co')) hosts.add(hostname)
    })

    await page.goto('/sign-in')
    const expected = new URL(ENV.NEXT_PUBLIC_SUPABASE_URL!).hostname
    await page.waitForFunction(() => document.readyState === 'complete')
    expect([...hosts].filter((h) => h !== expected), 'not on staging').toEqual([])

    await page.getByLabel(/email/i).fill(fx.email)
    await page.getByLabel(/^password$/i).fill(fx.password)
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 20_000 })

    await page.goto(`/crm/contacts/${fx.researchedId}`, { waitUntil: 'domcontentloaded' })
    const researched = await page.content()

    // POSITIVE CONTROL: the value itself is on the page.
    expect(researched, 'the contact page did not render its email').toContain(CITED)

    /*
     * ⚠️ THE ASSERTION PHASE 3 EXISTS FOR. Before this, the address rendered and
     * its origin did not — 2,294 evidence rows, none reachable.
     */
    expect(researched, 'the researched value shows no provider').toContain('e2e-provider')
    expect(researched, 'the source URL is not linked').toContain('https://example.com/found-here')

    await page.goto(`/crm/contacts/${fx.typedId}`, { waitUntil: 'domcontentloaded' })
    const typed = await page.content()

    expect(typed).toContain(TYPED)
    /*
     * ⚠️ DECISION-11. A hand-typed value must NOT be labelled "source not
     * recorded" — if it were, the genuine unknowns would be invisible among
     * thousands of them and the indicator would be useless.
     */
    expect(typed, 'a typed value is not labelled as entered').toContain('Added by hand')
    expect(typed, 'a typed value was wrongly credited to a provider').not.toContain('e2e-provider')
  })
})
