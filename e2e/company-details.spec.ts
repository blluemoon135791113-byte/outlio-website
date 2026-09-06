import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'

/**
 * The researched detail, end to end — from an evidence row to a rendered link.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE UNIT TESTS PROVE THE FORMATTER READS EACH SHAPE. THIS PROVES THE   ║
 * ║  ROWS REACH THE PAGE AT ALL.                                             ║
 * ║                                                                           ║
 * ║  Those are different claims, and the gap between them is this project's   ║
 * ║  most-repeated defect: code that is correct, tested, and never called.    ║
 * ║  `companyDetails` joins `research_evidence` (user_id-keyed) to a company  ║
 * ║  (workspace_id-keyed) — a filter mismatch there returns zero rows and     ║
 * ║  renders as a company nobody researched. Every unit test still passes.    ║
 * ║                                                                           ║
 * ║  ⚠️ AND IT PROVES THE XSS DEFENCE IN THE DOM, not in a return value. The   ║
 * ║  fixture below stores a `javascript:` news URL, which is exactly what a   ║
 * ║  hostile page we crawled would supply. `safeSourceUrl` dropping it in a   ║
 * ║  unit test does not prove no href in the document carries it.            ║
 * ║                                                                           ║
 * ║  ⚠️ FABRICATED DATA ONLY (CLAUDE.md rule 10) — invented company, invented ║
 * ║  round, example.com links.                                               ║
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

const COMPANY = 'Fabricated Widgets Ltd'

async function seed() {
  const db = admin()
  const token = randomBytes(32).toString('base64url')
  await db.rpc('reserve_signup_ip', {
    p_ip_hash: createHash('sha256').update(`details:${Date.now()}`).digest('hex'),
    p_token_hash: createHash('sha256').update(token).digest('hex'),
    p_reservation_seconds: 600,
  })

  const h = (k: string) =>
    createHash('sha256').update(`${k}:${Date.now()}:${Math.random()}`).digest('hex')

  const email = `outlio-e2e-details-${Date.now()}@example.com`
  const password = `E2e-${randomBytes(9).toString('base64url')}-Aa1!`

  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: 'Details Tester',
      signup_reservation_token: token,
      signup_device_hash: h('d'),
      signup_email_hash: h('e'),
      signup_phone_hash: h('p'),
      signup_linkedin_hash: h('l'),
    },
  })
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`)
  const userId = data.user.id

  // `custom`, not `agency` — the agency plan's limits blob is malformed.
  const { data: plan } = await db.from('plans').select('id').eq('key', 'custom').single()
  await db.from('profiles').update({ role: 'approved_user', plan_id: plan!.id }).eq('id', userId)

  const { data: workspace } = await db
    .from('workspaces')
    .select('id')
    .eq('owner_user_id', userId)
    .single()

  /*
   * ⚠️ THE STRUCTURAL LINK IS THE WHOLE POINT. `crm_companies.source_company_id`
   * → `companies.id` = `research_evidence.entity_id`. If the page looked the
   * evidence up any other way it would be matching on a VALUE, which
   * DECISION-10 rejected as fragile and silently wrong.
   */
  const sourceCompanyId = randomUUID()
  const { error: cErr } = await db.from('companies').insert({
    id: sourceCompanyId,
    user_id: userId,
    name: COMPANY,
    domain: 'fabricated-widgets.example.com',
    // ⚠️ SET EXPLICITLY. `companies_has_identity` requires at least one
    // NORMALIZED identifier and nothing fills them on insert — a fixture that
    // omits them is rejected, which is the constraint doing its job.
    normalized_name: 'fabricated widgets',
    normalized_domain: 'fabricated-widgets.example.com',
  })
  if (cErr) throw new Error(`companies insert failed: ${cErr.message}`)

  const { data: crmCompany, error: ccErr } = await db
    .from('crm_companies')
    .insert({
      workspace_id: workspace!.id,
      name: COMPANY,
      domain: 'fabricated-widgets.example.com',
      // Same identity constraint as `companies` (0071 mirrors 0043).
      normalized_name: 'fabricated widgets',
      normalized_domain: 'fabricated-widgets.example.com',
      employee_count: 240,
      headquarters: 'Manchester, United Kingdom',
      linkedin_url: 'https://www.linkedin.com/company/fabricated-widgets',
      source: 'lead_engine',
      source_company_id: sourceCompanyId,
    })
    .select('id')
    .single()
  if (ccErr) throw new Error(`crm_companies insert failed: ${ccErr.message}`)

  const evidence = (field: string, value_json: unknown, source_url: string | null) => ({
    user_id: userId,
    entity_type: 'company',
    entity_id: sourceCompanyId,
    field,
    value_json,
    source_provider: 'fabricated-provider',
    source_url,
    source_confidence: 'high',
    confidence: 0.91,
  })

  const { error: eErr } = await db.from('research_evidence').insert([
    evidence('funding_round', { round: 'Series A' }, 'https://example.com/funding'),
    evidence('funding_amount', { amount: 4200000, currency: 'GBP' }, 'https://example.com/funding'),
    evidence(
      'tech_stack',
      { coverage: 'vendor_detected', detected: [{ id: 'nextjs', name: 'NextDotJs Fabricated' }] },
      'https://example.com/stack',
    ),
    evidence(
      'social_profiles',
      { profiles: ['https://example.com/social/fabricated-widgets'] },
      'https://example.com/social',
    ),
    /*
     * ⚠️ THE HOSTILE ROW. A crawled page supplied this; it is stored, and until
     * `safeSourceUrl` it would have been rendered into an href that executes
     * for every user who opens this company. The safe article beside it must
     * still appear — dropping the whole list on one bad entry would hide real
     * news because of one attack.
     */
    evidence(
      'recent_news',
      {
        articles: [
          { url: 'javascript:alert(document.cookie)', title: 'Hostile headline' },
          { url: 'https://example.com/news/real', title: 'Fabricated Widgets opens an office' },
        ],
      },
      'https://example.com/news',
    ),
  ])
  if (eErr) throw new Error(`research_evidence insert failed: ${eErr.message}`)

  const { data: contact, error: ctErr } = await db
    .from('crm_contacts')
    .insert({
      workspace_id: workspace!.id,
      full_name: 'Fabricated Person',
      job_title: 'Head of Widgets',
      source: 'lead_engine',
      primary_company_id: crmCompany!.id,
    })
    .select('id')
    .single()
  if (ctErr) throw new Error(`crm_contacts insert failed: ${ctErr.message}`)

  return { userId, email, password, companyId: crmCompany!.id, contactId: contact!.id }
}

test.describe('researched company detail', () => {
  test.skip(!hasStaging, '.env.staging is required — see ADR-005')
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(120_000)

  let fixture: Awaited<ReturnType<typeof seed>>

  test.beforeAll(async () => {
    fixture = await seed()
  })

  test.afterAll(async () => {
    if (fixture?.userId) await admin().auth.admin.deleteUser(fixture.userId)
  })

  async function signIn(page: import('@playwright/test').Page) {
    await page.goto('/sign-in')
    await page.getByLabel(/email/i).fill(fixture.email)
    await page.getByLabel(/^password$/i).fill(fixture.password)
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 20_000 })
  }

  test('the company page shows funding, tech stack, socials and news', async ({ page }) => {
    const supabaseHosts = new Set<string>()
    page.on('request', (request) => {
      const { hostname } = new URL(request.url())
      if (hostname.endsWith('.supabase.co')) supabaseHosts.add(hostname)
    })

    await signIn(page)
    // The dev server must be on staging — Phase 1 had a run silently attach to
    // a server pointed at production.
    expect(
      [...supabaseHosts].filter((h) => h !== new URL(ENV.NEXT_PUBLIC_SUPABASE_URL!).hostname),
      'the dev server is not on staging — use `npm run dev:staging`',
    ).toEqual([])

    await page.goto(`/crm/companies/${fixture.companyId}`, { waitUntil: 'domcontentloaded' })

    // The main fields first, because the two-tier layout is the point: these
    // must be readable without opening anything.
    const html = await page.content()
    expect(html).toContain('240')
    expect(html).toContain('Manchester, United Kingdom')
    expect(html).toContain('fabricated-widgets.example.com')

    /*
     * ⚠️ THE WEBSITE LINK MUST BE ABSOLUTE. A bare `href="acme.com"` resolves
     * RELATIVE to the current page — clicking it navigates to
     * /crm/companies/acme.com, a 404 from markup that looks correct.
     */
    const websiteHref = await page
      .locator('a[href*="fabricated-widgets.example.com"]')
      .first()
      .getAttribute('href')
    expect(websiteHref, 'the website link is relative and would 404').toMatch(/^https?:\/\//)

    // Then the collapsed section, which must be PRESENT in the server HTML —
    // a <details> renders its contents whether open or not.
    const details = page.locator('details')
    await expect(details.getByText('More details')).toBeVisible()

    expect(html, 'the funding round never reached the page').toContain('Series A')
    expect(html, 'the amount lost its observed currency').toContain('£4,200,000')
    expect(html, 'the tech stack never reached the page').toContain('NextDotJs Fabricated')
    expect(html, 'the news article never reached the page').toContain(
      'Fabricated Widgets opens an office',
    )

    // Every item carries its citation — that is what makes a value checkable.
    expect(html, 'the researched values arrived without their provider').toContain(
      'fabricated-provider',
    )
  })

  test('a javascript: URL from a crawled page never becomes an href', async ({ page }) => {
    await signIn(page)
    await page.goto(`/crm/companies/${fixture.companyId}`, { waitUntil: 'domcontentloaded' })

    /*
     * ⚠️ ASSERTED AGAINST THE DOM, NOT THE MARKUP STRING. The question is
     * whether any anchor in the document would execute script when clicked —
     * and the safe sibling must survive, or the defence is just "drop
     * everything", which loses real data on every hostile row.
     */
    const hrefs = await page.locator('a[href]').evaluateAll((els) =>
      els.map((el) => (el as HTMLAnchorElement).getAttribute('href') ?? ''),
    )

    expect(
      hrefs.filter((h) => h.toLowerCase().trim().startsWith('javascript:')),
      'a javascript: URL from a crawled page reached an href — this is stored XSS',
    ).toEqual([])

    expect(
      hrefs,
      'the safe article was dropped along with the hostile one',
    ).toContain('https://example.com/news/real')

    // And the hostile headline's TEXT must be gone too — a dead label reading
    // "Hostile headline" would imply we have a link we refused to give.
    expect(await page.content()).not.toContain('Hostile headline')
  })

  test('the contact page carries its company detail', async ({ page }) => {
    /*
     * ⚠️ THE LEAD'S PAGE IS WHERE THIS GETS USED. Company size, website and
     * company LinkedIn decide whether to write at all, and they lived one click
     * away — which in practice meant not asking.
     */
    await signIn(page)
    await page.goto(`/crm/contacts/${fixture.contactId}`, { waitUntil: 'domcontentloaded' })

    const html = await page.content()
    expect(html).toContain('Fabricated Person')
    expect(html, 'the company employee count is missing').toContain('240')
    expect(html, 'the company website is missing').toContain('fabricated-widgets.example.com')
    expect(html, 'the company LinkedIn is missing').toContain(
      'https://www.linkedin.com/company/fabricated-widgets',
    )
    expect(html, 'the researched detail did not follow the contact').toContain('Series A')
  })
})
