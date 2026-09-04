import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

import { expect, test, type Page } from '@playwright/test'

/**
 * A real under-privileged member, refused by the route rather than by the UI.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE GAP PHASE 1 RECORDED AND COULD NOT CLOSE. Its isolation suite      ║
 * ║  created two workspace OWNERS, so every check was "another tenant's data   ║
 * ║  is invisible" — never "a member of THIS workspace, with a lower role, is  ║
 * ║  refused". Proving that needs a second member in one workspace, which was  ║
 * ║  Phase 2 fixture work. Phase 2 has shipped, so this closes it.            ║
 * ║                                                                           ║
 * ║  ⚠️ THE PERMISSION MATRIX IS ALREADY TESTED EXHAUSTIVELY AS A PURE         ║
 * ║  FUNCTION. That is not this. `workspace-permissions.test.ts` proves        ║
 * ║  `can(setter, 'crm.export')` is false; it cannot prove any ROUTE asks.    ║
 * ║  CLAUDE.md rule 8 — "hiding a button is not access control" — is a claim   ║
 * ║  about the server, and only a request can test it.                        ║
 * ║                                                                           ║
 * ║  ⚠️ THE COOKIE IS LOad-BEARING. `pickActive` prefers a workspace the user  ║
 * ║  OWNS, and every signup gets one — so without `outlio_workspace` pointing  ║
 * ║  at the owner's workspace, this "setter" would be tested inside their own  ║
 * ║  workspace as its OWNER and every denial below would silently become an    ║
 * ║  allow. The cookie only ever SELECTS among proven memberships, so this     ║
 * ║  grants nothing it did not already have.                                  ║
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

async function makeUser(db: SupabaseClient, label: string) {
  const token = randomBytes(32).toString('base64url')
  await db.rpc('reserve_signup_ip', {
    p_ip_hash: createHash('sha256').update(`${label}:${Date.now()}:${Math.random()}`).digest('hex'),
    p_token_hash: createHash('sha256').update(token).digest('hex'),
    p_reservation_seconds: 900,
  })
  const h = (k: string) =>
    createHash('sha256').update(`${k}:${label}:${Date.now()}:${Math.random()}`).digest('hex')

  const email = `outlio-e2e-role-${label}-${Date.now()}@example.com`
  const password = `Role-${randomBytes(9).toString('base64url')}-Aa1!`

  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: `Role ${label}`,
      signup_reservation_token: token,
      signup_device_hash: h('d'),
      signup_email_hash: h('e'),
      signup_phone_hash: h('p'),
      signup_linkedin_hash: h('l'),
    },
  })
  if (error || !data.user) throw new Error(`createUser(${label}) failed: ${error?.message}`)

  // `custom`, not `agency` — the agency plan is unpriced and has no
  // credits_per_month, so it is not a plan a fixture should depend on.
  const { data: plan } = await db.from('plans').select('id').eq('key', 'custom').single()
  await db
    .from('profiles')
    .update({ role: 'approved_user', plan_id: plan!.id })
    .eq('id', data.user.id)

  return { userId: data.user.id, email, password }
}

async function seed() {
  const db = admin()
  const owner = await makeUser(db, 'owner')
  const setter = await makeUser(db, 'setter')

  const { data: workspace } = await db
    .from('workspaces')
    .select('id')
    .eq('owner_user_id', owner.userId)
    .single()

  /*
   * ⚠️ A SECOND MEMBER IN THE OWNER'S WORKSPACE — the fixture Phase 1 lacked.
   * `setter` is the interesting role: high enough to be a real user of the
   * product, low enough that export, delete, merge, import, flows and team
   * administration are all denied.
   */
  const { error: mErr } = await db.from('workspace_memberships').insert({
    workspace_id: workspace!.id,
    user_id: setter.userId,
    role: 'setter',
  })
  if (mErr) throw new Error(`membership insert failed: ${mErr.message}`)

  // A contact belonging to the OWNER, never assigned to the setter. `dataScope`
  // says a setter sees only their own assignments, so this must stay invisible.
  const { data: theirs, error: cErr } = await db
    .from('crm_contacts')
    .insert({
      workspace_id: workspace!.id,
      full_name: 'Somebody Elses Prospect',
      job_title: 'Not The Setters Business',
      source: 'manual',
      owner_user_id: owner.userId,
    })
    .select('id')
    .single()
  if (cErr) throw new Error(`crm_contacts insert failed: ${cErr.message}`)

  // And one that IS the setter's, as the positive control.
  const { data: mine } = await db
    .from('crm_contacts')
    .insert({
      workspace_id: workspace!.id,
      full_name: 'Setters Own Prospect',
      source: 'manual',
      owner_user_id: setter.userId,
    })
    .select('id')
    .single()

  return {
    owner,
    setter,
    workspaceId: workspace!.id,
    othersContactId: theirs!.id,
    ownContactId: mine!.id,
  }
}

test.describe('an under-privileged member is refused by the server', () => {
  test.skip(!hasStaging, '.env.staging is required — see ADR-005')
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(180_000)

  let f: Awaited<ReturnType<typeof seed>>

  test.beforeAll(async () => {
    f = await seed()
  })

  test.afterAll(async () => {
    const db = admin()
    if (f?.setter?.userId) await db.auth.admin.deleteUser(f.setter.userId)
    if (f?.owner?.userId) await db.auth.admin.deleteUser(f.owner.userId)
  })

  /** Sign in as the setter AND pin the active workspace to the owner's. */
  async function signInAsSetter(page: Page) {
    await page.goto('/sign-in')
    await page.getByLabel(/email/i).fill(f.setter.email)
    await page.getByLabel(/^password$/i).fill(f.setter.password)
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 20_000 })

    await page.context().addCookies([
      {
        name: 'outlio_workspace',
        value: f.workspaceId,
        domain: '127.0.0.1',
        path: '/',
      },
    ])
  }

  test('the fixture really is a setter in the owner\'s workspace', async ({ page }) => {
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  ⚠️ THE NON-VACUITY CHECK, AND IT RUNS FIRST FOR A REASON. Every        ║
     * ║  assertion below is a DENIAL, and denials pass for boring reasons —    ║
     * ║  a broken session, a wrong workspace, a redirect to sign-in. A suite   ║
     * ║  of denials with no positive control proves only that nothing works.   ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    await signInAsSetter(page)

    const res = await page.goto('/crm/contacts', { waitUntil: 'domcontentloaded' })
    expect(res?.status(), 'the setter cannot even load the contacts list').toBeLessThan(400)

    const html = await page.content()
    // They are inside the OWNER's workspace, not their own — the cookie worked.
    expect(html, 'the setter sees their own assigned contact').toContain('Setters Own Prospect')
  })

  test('data scope: another member\'s contact is not readable by URL', async ({ page }) => {
    /*
     * ⚠️ THE LIST HIDES IT; THE URL MUST TOO. `dataScope('setter')` is
     * 'assigned', and RLS lets any member of a workspace read any contact in
     * it — so this is enforced in the page, and a page that forgot would leak
     * every prospect in the company to the newest hire with a guessed id.
     */
    await signInAsSetter(page)

    await page.goto('/crm/contacts', { waitUntil: 'domcontentloaded' })
    expect(
      await page.content(),
      'the list showed a contact assigned to somebody else',
    ).not.toContain('Somebody Elses Prospect')

    const res = await page.goto(`/crm/contacts/${f.othersContactId}`, {
      waitUntil: 'domcontentloaded',
    })

    expect(
      res?.status(),
      'a setter opened another member\'s contact by typing its id — hiding the ' +
        'row from a list is not access control',
    ).toBe(404)
    expect(await page.content()).not.toContain('Not The Setters Business')
  })

  test('their own contact IS readable by the same route', async ({ page }) => {
    // The control for the test above: proves the 404 is about ownership, not
    // about the route being broken for setters generally.
    await signInAsSetter(page)
    const res = await page.goto(`/crm/contacts/${f.ownContactId}`, {
      waitUntil: 'domcontentloaded',
    })
    expect(res?.status()).toBeLessThan(400)
    expect(await page.content()).toContain('Setters Own Prospect')
  })

  test('privileged controls are not merely hidden — the actions refuse', async ({ page }) => {
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  ⚠️ 61 SERVER ACTIONS CALL `assertWorkspacePermission`, AND A SERVER    ║
     * ║  ACTION IS A PUBLIC HTTP ENDPOINT. The button being absent proves      ║
     * ║  nothing about whether the endpoint behind it asks who is calling.     ║
     * ║                                                                        ║
     * ║  Playwright cannot forge a server action's encrypted id, so this       ║
     * ║  asserts what a browser CAN observe: the privileged control is absent  ║
     * ║  for this role. The server-side half is proven by                      ║
     * ║  `action-authorization.test.ts` (every action establishes a caller)    ║
     * ║  plus `workspace-permissions.test.ts` (the matrix). Stated plainly     ║
     * ║  rather than implied, because a test that cannot make the hostile      ║
     * ║  request should not be written as though it did.                       ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    await signInAsSetter(page)
    await page.goto(`/crm/contacts/${f.ownContactId}`, { waitUntil: 'domcontentloaded' })

    // `crm.contact.assign` is manager+. A setter must not get the owner picker.
    await expect(page.getByRole('button', { name: /save owner/i })).toHaveCount(0)
  })

  test('admin-only settings do not render their contents to a setter', async ({ page }) => {
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  ⚠️ THIS FOUND A REAL LEAK. Before the fix, every one of these needles  ║
     * ║  appeared in the page a `setter` received:                             ║
     * ║                                                                        ║
     * ║      LEAKS   api key NAME                                              ║
     * ║      LEAKS   api key PREFIX                                            ║
     * ║      LEAKS   webhook URL (token-bearing)                                ║
     * ║      safe    webhook signing secret                                     ║
     * ║                                                                        ║
     * ║  ⚠️ THE WEBHOOK URL IS THE SHARP ONE. Slack, Teams and Zapier put a     ║
     * ║  bearer token in the PATH — holding the URL is holding the credential.  ║
     * ║  The API key itself was never at risk: the hash is not selected and a   ║
     * ║  prefix cannot be used. The exposure was the INVENTORY plus one live    ║
     * ║  secret.                                                               ║
     * ║                                                                        ║
     * ║  ⚠️ ASSERTED ON CONTENT, NOT ONLY ON THE REDIRECT. A future refactor    ║
     * ║  could drop the guard and re-render the page at a 200 with a different  ║
     * ║  URL; what must never happen is these strings reaching this role.       ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    const db = admin()
    const { error: kErr } = await db.from('api_keys').insert({
      workspace_id: f.workspaceId,
      name: 'PRODUCTION INTEGRATION KEY',
      // Fabricated: a hash of nothing, and never rendered either way.
      key_hash: 'c'.repeat(64),
      key_prefix: 'olk_live_ZZTOP',
      scopes: [],
    })
    const { error: wErr } = await db.from('webhook_subscriptions').insert({
      workspace_id: f.workspaceId,
      name: 'Slack relay',
      url: 'https://hooks.example.com/services/SECRET-TOKEN-IN-URL',
      events: [],
      signing_secret: 'whsec_FIXTURE_ONLY',
    })
    /*
     * ⚠️ THE SEED ERRORS ARE CHECKED. The first version of this probe discarded
     * them, the webhook insert failed on a missing `signing_secret`, and the
     * result read as "the URL does not leak" when in fact no URL existed. A
     * fixture that fails silently turns a leak test into a green tick.
     */
    expect(kErr?.message ?? null, 'api_keys fixture failed').toBeNull()
    expect(wErr?.message ?? null, 'webhook fixture failed').toBeNull()

    await signInAsSetter(page)
    await page.goto('/dashboard/settings/developers', { waitUntil: 'domcontentloaded' })

    // Redirected away — `workspace.settings.manage` is admin-only.
    expect(
      new URL(page.url()).pathname,
      'a setter loaded the developer settings page',
    ).not.toBe('/dashboard/settings/developers')

    const html = await page.content()
    for (const needle of [
      'PRODUCTION INTEGRATION KEY',
      'olk_live_ZZTOP',
      'SECRET-TOKEN-IN-URL',
      'whsec_FIXTURE_ONLY',
    ]) {
      expect(html, `a setter received "${needle}"`).not.toContain(needle)
    }

    await page.goto('/dashboard/settings/notifications', { waitUntil: 'domcontentloaded' })
    expect(
      new URL(page.url()).pathname,
      'a setter loaded the notification settings page',
    ).not.toBe('/dashboard/settings/notifications')
  })

  test('the OWNER can still use the page the setter was refused', async ({ page }) => {
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  ⚠️ THE CONTROL FOR THE FIX ITSELF. Tightening access is trivially     ║
     * ║  "correct" if it locks everybody out, and the test above would pass    ║
     * ║  just as happily against a page that 500s or redirects unconditionally.║
     * ║  This is the assertion that the guard discriminates by ROLE.           ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    await page.goto('/sign-in')
    await page.getByLabel(/email/i).fill(f.owner.email)
    await page.getByLabel(/^password$/i).fill(f.owner.password)
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 20_000 })

    await page.goto('/dashboard/settings/developers', { waitUntil: 'domcontentloaded' })
    expect(
      new URL(page.url()).pathname,
      'the owner was locked out of their own developer settings',
    ).toBe('/dashboard/settings/developers')

    // And they see the key the setter could not.
    expect(await page.content()).toContain('PRODUCTION INTEGRATION KEY')

    await page.goto('/dashboard/settings/notifications', { waitUntil: 'domcontentloaded' })
    expect(new URL(page.url()).pathname).toBe('/dashboard/settings/notifications')
  })
})
