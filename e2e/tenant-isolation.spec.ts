import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'

/**
 * The direct-URL half of tenant isolation — DoD item 1.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  `tenant-isolation.test.ts` PROVES THE DATA LAYER. THIS PROVES THE PAGE.  ║
 * ║                                                                           ║
 * ║  Those two are not the same claim, and the gap between them is exactly    ║
 * ║  where this project's worst bugs have lived. A page fetches with the      ║
 * ║  SERVICE ROLE, which bypasses RLS entirely — so a correct RLS policy      ║
 * ║  proves nothing about what a server component hands to a browser. The     ║
 * ║  only thing standing between tenants on that path is a `.eq()` in code.  ║
 * ║                                                                           ║
 * ║  ⚠️ THIS RUNS AGAINST STAGING, NEVER PRODUCTION. `npm run dev:staging`     ║
 * ║  forces the staging database into `process.env` before Next loads         ║
 * ║  `.env.local`. The test refuses to run if it detects otherwise.           ║
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

/**
 * A signed-up user with a workspace and one contact.
 *
 * ⚠️ THE SIGNUP METADATA IS NOT OPTIONAL. Migration 0110 restored the gate, so
 * `createUser` without a live reservation token and four 64-hex hashes is
 * refused — which is the gate working, and exactly what broke for eleven days.
 */
async function makeTenant(label: string) {
  const db = admin()
  const token = randomBytes(32).toString('base64url')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const ipHash = createHash('sha256').update(`e2e:${label}:${Date.now()}`).digest('hex')

  const { error: reserveError } = await db.rpc('reserve_signup_ip', {
    p_ip_hash: ipHash,
    p_token_hash: tokenHash,
    p_reservation_seconds: 600,
  })
  if (reserveError) throw new Error(`reserve failed: ${reserveError.message}`)

  const hash = (kind: string) =>
    createHash('sha256').update(`${kind}:${label}:${Date.now()}:${Math.random()}`).digest('hex')

  const email = `outlio-e2e-${label}-${Date.now()}@example.com`
  const password = `E2e-${randomBytes(9).toString('base64url')}-Aa1!`

  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: `${label} Owner`,
      signup_reservation_token: token,
      signup_device_hash: hash('device'),
      signup_email_hash: hash('email'),
      signup_phone_hash: hash('phone'),
      signup_linkedin_hash: hash('linkedin'),
    },
  })
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`)

  /*
   * ⚠️ A NEW SIGNUP CANNOT SIGN IN. Outlio is invitation-gated: `profiles.role`
   * defaults to `registered_user`, and `precheckAccess` denies anything outside
   * SCRAPER_ROLES with reason `no_request`. Without this the browser stays on
   * /sign-in and the test times out looking like a navigation bug.
   *
   * Promoting the fixture is legitimate — the journey under test is tenant
   * isolation between two APPROVED customers, not the approval flow itself.
   */
  /*
   * ⚠️ AND A PLAN THAT INCLUDES THE CRM MODULE. Entitlements come from the
   * workspace OWNER's `profiles.plan_id` → `plans.limits.crm_enabled`. Without
   * it the contact page renders "CRM is not included in your plan" — a correct
   * page that is not the one under test, and the failure looks like a broken
   * locator rather than a missing entitlement.
   */
  /*
   * ⚠️ `custom`, NOT `agency` — and the difference is a real defect, not a
   * preference. The seeded `agency` plan has no `credits_per_month`, which
   * `planLimitsSchema` requires, so `getPlanById` THROWS and every page that
   * resolves entitlements 500s. Verified present in production too; it is
   * harmless there only because `agency` is inactive with zero users.
   *
   * Picking it here cost an hour of chasing what looked like a locator problem.
   */
  const { data: plan } = await db.from('plans').select('id').eq('key', 'custom').single()

  await db
    .from('profiles')
    .update({ role: 'approved_user', plan_id: plan!.id })
    .eq('id', data.user.id)

  const { data: workspace } = await db
    .from('workspaces')
    .select('id')
    .eq('owner_user_id', data.user.id)
    .single()

  const { data: contact } = await db
    .from('crm_contacts')
    .insert({ workspace_id: workspace!.id, full_name: `${label} Secret Person` })
    .select('id')
    .single()

  return { userId: data.user.id, email, password, workspaceId: workspace!.id, contactId: contact!.id }
}

async function destroy(userId: string) {
  const db = admin()
  await db.auth.admin.deleteUser(userId)
  for (const t of ['signup_ip_claims', 'signup_device_claims', 'signup_identity_claims']) {
    await db.from(t).delete().eq('user_id', userId)
  }
}

test.describe('tenant isolation at a real URL', () => {
  test.skip(!hasStaging, '.env.staging is required — see ADR-005')
  // Sign-up creates rows; two files racing would fight over identity hashes.
  test.describe.configure({ mode: 'serial' })

  let a: Awaited<ReturnType<typeof makeTenant>>
  let b: Awaited<ReturnType<typeof makeTenant>>

  test.beforeAll(async () => {
    a = await makeTenant('alpha')
    b = await makeTenant('bravo')
  })

  test.afterAll(async () => {
    // Runs even after failures. Staging is disposable; leaking is still a habit
    // worth not forming.
    for (const t of [a, b]) if (t?.userId) await destroy(t.userId)
  })

  /*
   * ⚠️ GENEROUS TIMEOUT, AND IT IS NOT FLAKINESS INSURANCE. `next dev` compiles
   * each route on first request, and `/crm/contacts/[id]` is a heavy one — the
   * default 30s budget expired during compilation, not during the assertion.
   * Raising it here rather than globally keeps the fast tripwire tests honest.
   */
  test.setTimeout(120_000)

  test('a signed-in member cannot open another workspace’s contact by URL', async ({ page }) => {
    /*
     * ⚠️ THE SERVER MUST BE ON STAGING. If the dev server were on production,
     * this signs a real user in and the assertions would be meaningless — worse,
     * the fixtures above would not exist there and the test would "pass" by
     * finding nothing.
     */
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  ⚠️ PROVE THE SERVER IS ON STAGING BEFORE TOUCHING IT.                 ║
     * ║                                                                        ║
     * ║  `reuseExistingServer` is true locally, so Playwright will happily     ║
     * ║  attach to a `next dev` somebody already started — and a plain         ║
     * ║  `next dev` loads `.env.local`, which is PRODUCTION. That happened on  ║
     * ║  2026-09-04: this test signed a staging user into the production app,  ║
     * ║  which correctly rejected the credentials, and the failure looked      ║
     * ║  exactly like a broken locator.                                       ║
     * ║                                                                        ║
     * ║  The benign outcome was luck. The same misdirection with a SIGN-UP     ║
     * ║  journey would create real accounts in the customer database — which   ║
     * ║  is how 43 of them got there in the first place.                      ║
     * ║                                                                        ║
     * ║  So the target is observed from real network traffic, not assumed      ║
     * ║  from a script name.                                                   ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    const supabaseHosts = new Set<string>()
    page.on('request', (request) => {
      const { hostname } = new URL(request.url())
      if (hostname.endsWith('.supabase.co')) supabaseHosts.add(hostname)
    })

    await page.goto('/sign-in')

    const expectedHost = new URL(ENV.NEXT_PUBLIC_SUPABASE_URL!).hostname
    await page.waitForFunction(() => document.readyState === 'complete')

    expect(
      [...supabaseHosts].filter((h) => h !== expectedHost),
      `The dev server is talking to a Supabase project other than staging ` +
        `(${expectedHost}). Playwright reuses an already-running \`next dev\`, and ` +
        `a plain \`next dev\` loads .env.local — production. Kill it and let ` +
        '`npm run dev:staging` start instead.',
    ).toEqual([])

    await page.getByLabel(/email/i).fill(a.email)
    await page.getByLabel(/^password$/i).fill(a.password)
    await page.getByRole('button', { name: /sign in/i }).click()

    await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 20_000 })

    // POSITIVE CONTROL: A's own contact must be reachable, or the denial below
    // proves only that the app is broken for everyone.
    // `domcontentloaded`, not `load`: the page is server-rendered and the
    // assertions below read the delivered HTML.
    await page.goto(`/crm/contacts/${a.contactId}`, { waitUntil: 'domcontentloaded' })

    /*
     * ⚠️ ASSERT ON THE DELIVERED HTML, NOT ON A LOCATOR.
     *
     * Two locator attempts failed here for reasons that had nothing to do with
     * isolation: `getByText` matched the hidden <title>, and
     * `getByRole('heading')` found nothing because the name is not rendered as a
     * heading. Both looked like security failures and were not.
     *
     * The real question is simpler and stricter than any locator: DID THIS
     * TENANT'S DATA REACH THE BROWSER AT ALL? `page.content()` answers exactly
     * that, and it catches the <title> too — which is a real leak channel, and
     * the one a visible-element locator would have missed entirely.
     */
    expect(
      await page.content(),
      'workspace A cannot load its OWN contact — every denial below would be meaningless',
    ).toContain('alpha Secret Person')

    // The actual question: B's contact id, typed into the URL bar by A.
    await page.goto(`/crm/contacts/${b.contactId}`, { waitUntil: 'domcontentloaded' })

    expect(
      await page.content(),
      'workspace A opened workspace B’s contact by direct URL — a cross-tenant read',
    ).not.toContain('bravo Secret Person')
  })
})
