import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { parse } from 'dotenv'
import { expect, test } from '@playwright/test'

const env = existsSync('.env.staging') ? parse(readFileSync('.env.staging')) : {}
const hasStaging = Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY)
const STAGING_ORIGIN = 'https://ahfyvhibzgxrhfjobbqn.supabase.co'

function admin() {
  if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin !== STAGING_ORIGIN) {
    throw new Error('Refusing fixture writes outside the ADR-005 staging project')
  }
  return createClient(STAGING_ORIGIN, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

// Do not persist auth credentials in a Playwright trace, including when this
// spec is discovered by the main staging configuration.
test.use({ trace: 'off' })

test.describe('authenticated dashboard scrolling', () => {
  test.skip(!hasStaging, '.env.staging is required')
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(180_000)

  let userId: string | undefined
  let workspaceId: string | undefined
  let email: string
  let password: string
  const contactIds: string[] = []

  test.beforeAll(async () => {
    const db = admin()
    const token = randomBytes(32).toString('base64url')
    const hash = () => createHash('sha256').update(randomUUID()).digest('hex')
    const { error: reservationError } = await db.rpc('reserve_signup_ip', {
      p_ip_hash: hash(),
      p_token_hash: createHash('sha256').update(token).digest('hex'),
      p_reservation_seconds: 600,
    })
    expect(reservationError?.code, 'staging signup reservation').toBeUndefined()
    email = `outlio-e2e-dashboard-${randomUUID()}@example.com`
    password = `E2e-${randomBytes(18).toString('base64url')}-Aa1!`
    const { data, error } = await db.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: {
        full_name: 'Dashboard Test Owner', signup_reservation_token: token,
        signup_device_hash: hash(), signup_email_hash: hash(),
        signup_phone_hash: hash(), signup_linkedin_hash: hash(),
      },
    })
    // Record immediately so afterAll cleans up even if later seeding fails.
    userId = data.user?.id
    expect(error?.code, 'staging fixture creation').toBeUndefined()
    expect(userId).toBeTruthy()
    const { data: plan, error: planError } = await db.from('plans').select('id').eq('key', 'custom').single()
    expect(planError?.code, 'staging custom plan').toBeUndefined()
    const { error: approvalError } = await db.from('profiles').update({ role: 'approved_user', plan_id: plan!.id }).eq('id', userId!)
    expect(approvalError?.code, 'fixture approval').toBeUndefined()
    const { data: workspace, error: workspaceError } = await db.from('workspaces').select('id').eq('owner_user_id', userId!).single()
    expect(workspaceError?.code, 'fixture workspace').toBeUndefined()
    workspaceId = workspace!.id
    const { data: contacts, error: contactsError } = await db.from('crm_contacts').insert(
      Array.from({ length: 6 }, (_, i) => ({ workspace_id: workspaceId, full_name: `Scrolltest Person ${i + 1}`, job_title: 'Fabricated fixture', source: 'manual' })),
    ).select('id')
    expect(contactsError?.code, 'fixture contacts').toBeUndefined()
    contactIds.push(...(contacts ?? []).map((contact) => contact.id))
    expect(contactIds).toHaveLength(6)
  })

  test.afterAll(async () => {
    if (!userId) return
    const db = admin()
    const { error } = await db.auth.admin.deleteUser(userId)
    expect(error?.code, 'temporary staging user cleanup').toBeUndefined()
    // Verify the workspace and seeded data were removed by their cascade.
    for (const [table, id] of [['profiles', userId], ['workspaces', workspaceId]] as const) {
      if (!id) continue
      const result = await db.from(table).select('id', { count: 'exact', head: true }).eq('id', id)
      expect(result.error?.code, `${table} cleanup read`).toBeUndefined()
      expect(result.count, `${table} fixture must not remain`).toBe(0)
    }
    if (contactIds.length) {
      const result = await db.from('crm_contacts').select('id', { count: 'exact', head: true }).in('id', contactIds)
      expect(result.error?.code, 'contact cleanup read').toBeUndefined()
      expect(result.count, 'fixture contacts must not remain').toBe(0)
    }
  })

  test('real sign-in, dashboard, search and settings remain usable across viewports', async ({ page, baseURL }) => {
    const app = new URL(baseURL!)
    expect(['localhost', '127.0.0.1']).toContain(app.hostname)
    const unexpectedSupabaseHosts = new Set<string>()
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url())
      if (url.hostname.endsWith('.supabase.co') && url.origin !== STAGING_ORIGIN) unexpectedSupabaseHosts.add(url.hostname)
      // No marketing analytics, production endpoints or external messages.
      if (url.pathname.startsWith('/ingest') || ![app.origin, STAGING_ORIGIN].includes(url.origin)) return route.abort()
      return route.continue()
    })
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await test.step('sign in through the actual auth UI and load the overview', async () => {
      await page.goto('/sign-in')
      await page.getByLabel(/^email/i).fill(email)
      await page.getByLabel(/^password$/i).fill(password)
      await page.getByRole('button', { name: /^sign in$/i }).click()
      await page.waitForURL((url) => url.pathname.startsWith('/dashboard'), { timeout: 40_000 })
      await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible({ timeout: 30_000 })
      await expect(page.locator('section[aria-label="Usage this period"]')).toBeVisible()
    })

    await test.step('mobile drawer closes cleanly on desktop resize and preserves scroll', async () => {
      await page.setViewportSize({ width: 390, height: 700 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
      await page.evaluate(() => window.scrollTo(0, 300))
      const scrollY = await page.evaluate(() => window.scrollY)
      expect(scrollY).toBeGreaterThan(0)
      await page.getByRole('button', { name: 'Open navigation' }).click()
      await expect(page.getByRole('dialog', { name: 'Product navigation' })).toBeVisible()
      await page.keyboard.press('Escape')
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollY)
      await page.getByRole('button', { name: 'Open navigation' }).click()
      await page.setViewportSize({ width: 1280, height: 480 })
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).overflowY)).not.toBe('hidden')
      await page.setViewportSize({ width: 390, height: 500 })
      await expect(page.getByRole('dialog', { name: 'Product navigation' })).toHaveCount(0)
    })

    await test.step('settings stay within mobile width and scroll on short desktops', async () => {
      // Exercise the real App Router navigation. A second page.goto tears down
      // the dashboard while it is prefetching; WebKit reports those cancelled
      // old-document fetches as access-control errors, not a failed app route.
      await page.getByRole('button', { name: 'Open navigation' }).click()
      await page.getByRole('dialog', { name: 'Product navigation' })
        .getByRole('link', { name: 'Settings', exact: true }).click()
      await expect(page).toHaveURL(`${app.origin}/dashboard/settings`, { timeout: 30_000 })
      const nav = page.getByRole('navigation', { name: 'Settings sections' })
      await expect(nav).toBeVisible()
      await nav.getByRole('link', { name: 'Developers', exact: true }).click()
      await expect(page).toHaveURL(`${app.origin}/dashboard/settings/developers`, { timeout: 30_000 })
      await expect(page.getByRole('heading', { name: 'Developers', exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
      await page.setViewportSize({ width: 1280, height: 480 })
      await nav.hover()
      await page.mouse.wheel(0, 600)
      await expect(nav.getByRole('link', { name: 'Delete account' })).toBeInViewport()
    })

    await test.step('real quick-search results scroll and navigate using the keyboard', async () => {
      await page.setViewportSize({ width: 390, height: 500 })
      await page.getByRole('button', { name: 'Search leads', exact: true }).click()
      const palette = page.getByRole('dialog', { name: 'Search leads' })
      await page.getByRole('textbox', { name: 'Search leads by name or email' }).fill('Scrolltest')
      await expect(palette.getByRole('button')).toHaveCount(6, { timeout: 30_000 })
      await page.keyboard.press('ArrowUp')
      await expect(palette.locator('button[aria-current="true"]')).toBeInViewport({ ratio: 0.98 })
      await page.keyboard.press('Enter')
      await page.waitForURL(/\/crm\/contacts\/[^/]+$/, { timeout: 30_000 })
      await expect(page.getByRole('dialog', { name: 'Search leads' })).toHaveCount(0)
      expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
      // Soft so the safety/error assertions below still run on a broken route.
      await expect.soft(page.getByRole('heading', { name: /Scrolltest Person/ }).first()).toBeVisible({ timeout: 15_000 })
    })

    expect([...unexpectedSupabaseHosts], 'browser must never contact production Supabase').toEqual([])
    expect(pageErrors, 'uncaught dashboard browser errors').toEqual([])

    await test.step('a fresh direct settings URL also renders', async () => {
      // Keep deep-link coverage without destroying an actively streaming page.
      const direct = await page.context().newPage()
      const errors: string[] = []
      direct.on('pageerror', (error) => errors.push(error.message))
      await direct.route('**/*', (route) => {
        const url = new URL(route.request().url())
        if (url.pathname.startsWith('/ingest') || ![app.origin, STAGING_ORIGIN].includes(url.origin)) return route.abort()
        return route.continue()
      })
      try {
        const response = await direct.goto('/dashboard/settings/developers')
        expect(response?.status()).toBe(200)
        await expect(direct.getByRole('heading', { name: 'Developers', exact: true })).toBeVisible()
        expect(errors, 'uncaught deep-link browser errors').toEqual([])
      } finally {
        await direct.close()
      }
    })
  })
})
