import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'

/**
 * Phase 2's acceptance journey: filter, sort, page — without losing the filter.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE UNIT GUARD CHECKS THAT `contactsHref` MENTIONS EVERY FIELD. THIS  ║
 * ║  CHECKS THAT THE ROUND TRIP ACTUALLY WORKS.                              ║
 * ║                                                                           ║
 * ║  Those are different claims. The builder can emit a parameter the page    ║
 * ║  never parses, or parse one it never passes to `listContacts` — and every ║
 * ║  unit test still passes, because each half is correct in isolation. This  ║
 * ║  project's worst bugs have all lived in exactly that gap.                 ║
 * ║                                                                           ║
 * ║  ⚠️ RUNS AGAINST STAGING ONLY, and verifies that from network traffic     ║
 * ║  rather than trusting the script name — Phase 1 had a Playwright run      ║
 * ║  silently attach to a dev server pointed at production.                   ║
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

/** An approved, CRM-entitled owner of a workspace holding known contacts. */
async function makeUser() {
  const db = admin()
  const token = randomBytes(32).toString('base64url')
  await db.rpc('reserve_signup_ip', {
    p_ip_hash: createHash('sha256').update(`filters:${Date.now()}`).digest('hex'),
    p_token_hash: createHash('sha256').update(token).digest('hex'),
    p_reservation_seconds: 600,
  })

  const h = (k: string) =>
    createHash('sha256').update(`${k}:${Date.now()}:${Math.random()}`).digest('hex')

  const email = `outlio-e2e-filters-${Date.now()}@example.com`
  const password = `E2e-${randomBytes(9).toString('base64url')}-Aa1!`

  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: 'Filter Tester',
      signup_reservation_token: token,
      signup_device_hash: h('d'),
      signup_email_hash: h('e'),
      signup_phone_hash: h('p'),
      signup_linkedin_hash: h('l'),
    },
  })
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`)

  // `custom`, not `agency` — the agency plan's limits blob is malformed and
  // getPlanById throws on it. See PHASE_1_EVIDENCE.
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

  /*
   * Two contacts that differ in EVERY dimension the filters use, so each filter
   * has something to include and something to exclude. A fixture where both
   * rows match is a fixture that cannot fail.
   */
  await db.from('crm_contacts').insert([
    {
      workspace_id: workspace!.id,
      full_name: 'Aardvark Filtertest',
      job_title: 'Head of Sales',
      source: 'manual',
    },
    {
      workspace_id: workspace!.id,
      full_name: 'Zebra Filtertest',
      job_title: 'SDR',
      source: 'csv_import',
    },
  ])

  return { userId: data.user.id, email, password }
}

test.describe('contact filters', () => {
  test.skip(!hasStaging, '.env.staging is required — see ADR-005')
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(120_000)

  let user: Awaited<ReturnType<typeof makeUser>>

  test.beforeAll(async () => {
    user = await makeUser()
  })

  test.afterAll(async () => {
    if (user?.userId) await admin().auth.admin.deleteUser(user.userId)
  })

  test('a filter survives sorting and paging', async ({ page }) => {
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
      'the dev server is not on staging — use `npm run dev:staging`',
    ).toEqual([])

    await page.getByLabel(/email/i).fill(user.email)
    await page.getByLabel(/^password$/i).fill(user.password)
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 20_000 })

    // POSITIVE CONTROL: both contacts are visible before any filter, or the
    // exclusions below would prove only that the page is broken.
    await page.goto('/crm/contacts', { waitUntil: 'domcontentloaded' })
    let html = await page.content()
    expect(html, 'the unfiltered list is missing its contacts').toContain('Aardvark Filtertest')
    expect(html).toContain('Zebra Filtertest')

    // Filter by source: one in, one out.
    await page.goto('/crm/contacts?source=manual', { waitUntil: 'domcontentloaded' })
    html = await page.content()
    expect(html).toContain('Aardvark Filtertest')
    expect(html, 'the source filter did not exclude the other contact').not.toContain(
      'Zebra Filtertest',
    )

    /*
     * ⚠️ THE ACTUAL REGRESSION THIS JOURNEY EXISTS FOR. Sorting a filtered list
     * used to drop the filter and silently return the whole workspace, under a
     * heading that still described the filter.
     */
    await page.goto('/crm/contacts?source=manual&sort=name&dir=asc', {
      waitUntil: 'domcontentloaded',
    })
    html = await page.content()
    expect(html).toContain('Aardvark Filtertest')
    expect(html, 'sorting a filtered list widened it back out').not.toContain('Zebra Filtertest')

    // And the sort link the page renders must itself carry the filter.
    const sortHref = await page
      .locator('a[href*="/crm/contacts?"]')
      .filter({ hasText: /name/i })
      .first()
      .getAttribute('href')

    if (sortHref) {
      expect(
        sortHref,
        'a sort link on a filtered list does not carry the filter — clicking it widens the list',
      ).toContain('source=manual')
    }
  })

  test('an unknown filter value degrades to the ordinary list', async ({ page }) => {
    /*
     * ⚠️ A URL IS USER INPUT. `source` reaches a database query, so a value
     * outside the enum must produce the unfiltered list rather than a 500 —
     * which is the same rule `isContactSort` has always followed for `sort`.
     */
    await page.goto('/sign-in')
    await page.getByLabel(/email/i).fill(user.email)
    await page.getByLabel(/^password$/i).fill(user.password)
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 20_000 })

    const response = await page.goto(
      "/crm/contacts?source=' OR 1=1 --&sort=nonsense&company=notauuid",
      { waitUntil: 'domcontentloaded' },
    )

    expect(response?.status(), 'a hand-edited URL produced a server error').toBeLessThan(500)
    const html = await page.content()
    expect(html).toContain('Aardvark Filtertest')
    expect(html).toContain('Zebra Filtertest')
  })
})
