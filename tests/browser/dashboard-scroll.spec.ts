import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { test, expect, type Page } from '@playwright/test'

let bundle: string
let css: string
const root = resolve(__dirname, '../..')

// Replace ONLY framework/server boundaries; render the real product components.
const framework = `
import { useSyncExternalStore } from 'react';
import { jsx } from 'react/jsx-runtime';
const subscribe = (cb) => { window.addEventListener('popstate', cb); return () => window.removeEventListener('popstate', cb); };
export const usePathname = () => useSyncExternalStore(subscribe, () => location.pathname);
const push = (href) => { history.pushState({}, '', href); window.dispatchEvent(new Event('popstate')); };
export const useRouter = () => ({ push, replace: push, refresh() {} });
export function Link({ href, onClick, children, ...props }) {
  return jsx('a', { ...props, href, onClick(e) { onClick?.(e); if (!e.defaultPrevented) { e.preventDefault(); push(href); } }, children });
}
export function Image(props) { return jsx('img', props); }
export function identifyAnalyticsUser() {}
export function resetAnalyticsIdentity() {}
export function syncSessionReplayForPath() {}
export async function signOutAction() {}
`

test.beforeAll(async () => {
  const output = await build({
    absWorkingDir: root,
    entryPoints: ['tests/browser/dashboard.fixture.tsx'],
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    plugins: [{
      name: 'isolated-framework',
      setup(builder) {
        builder.onResolve({ filter: /^(next\/(link|image|navigation)|@\/lib\/(analytics\/client|auth\/actions))$/ }, (args) => ({ path: args.path, namespace: 'fixture' }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents: framework + (args.path === 'next/link' ? '\nexport default Link;' : args.path === 'next/image' ? '\nexport default Image;' : ''),
          resolveDir: root,
          loader: 'js',
        }))
      },
    }],
  })
  bundle = output.outputFiles[0].text
  css = (await postcss([tailwind({ base: root })]).process(await readFile(resolve(root, 'app/globals.css'), 'utf8'), { from: resolve(root, 'app/globals.css') })).css
})

async function openDashboard(page: Page, suffix = '') {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== 'http://outlio.test') return route.abort()
    if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'application/javascript', body: bundle })
    if (url.pathname === '/fixture.css') return route.fulfill({ contentType: 'text/css', body: css })
    if (url.pathname === '/api/crm/quick-search') return route.fulfill({ json: { results: Array.from({ length: 15 }, (_, i) => ({ id: String(i), name: `Test lead ${i + 1}`, subtitle: 'Fabricated result', href: `/crm/contacts/fixture-${i + 1}` })) } })
    if (url.pathname === '/icon.png') return route.fulfill({ status: 204 })
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>' })
  })
  await page.goto(`http://outlio.test/dashboard${suffix}`)
  await expect(page.getByRole('button', { name: 'Open test form' })).toBeVisible()
}

async function openSearch(page: Page) {
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog', { name: 'Search leads' })).toBeVisible()
}

test('desktop navigation scrolls independently and keeps bottom links reachable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 480 })
  await openDashboard(page)
  const nav = page.getByRole('navigation', { name: 'Product', exact: true })
  for (const section of ['Pipeline', 'Outreach', 'LinkedIn', 'Automations']) {
    await nav.getByRole('button', { name: `Expand ${section}`, exact: true }).click()
  }
  await nav.getByRole('link', { name: 'Settings', exact: true }).scrollIntoViewIfNeeded()
  await expect(nav.getByRole('link', { name: 'Settings', exact: true })).toBeInViewport()
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
})

test('mobile menu releases the page scroll lock when resized to desktop', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 })
  await openDashboard(page)
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(page.getByRole('dialog', { name: 'Product navigation' })).toBeVisible()
  expect(await page.evaluate(() => getComputedStyle(document.body).overflowY)).toBe('hidden')
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).overflowY)).not.toBe('hidden')
  await page.setViewportSize({ width: 390, height: 700 })
  await expect(page.getByRole('dialog', { name: 'Product navigation' })).toHaveCount(0)
})

test('mobile navigation closes on browser history/route changes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 })
  await openDashboard(page)
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.evaluate(() => { history.pushState({}, '', '/crm/contacts'); window.dispatchEvent(new Event('popstate')) })
  await expect(page.getByRole('dialog', { name: 'Product navigation' })).toHaveCount(0)
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
})

test('search locks background scrolling and shortcut dismissal resets and restores focus', async ({ page }) => {
  await openDashboard(page)
  const opener = page.getByRole('button', { name: 'Open test form' })
  await opener.focus()
  await openSearch(page)
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).overflowY)).toBe('hidden')
  await page.getByRole('textbox', { name: 'Search leads by name or email' }).fill('Test')
  await expect(page.getByRole('button', { name: 'Test lead 15 Fabricated result', exact: true })).toBeAttached()
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog', { name: 'Search leads' })).toHaveCount(0)
  await expect(opener).toBeFocused()
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
  await openSearch(page)
  await expect(page.getByRole('textbox', { name: 'Search leads by name or email' })).toHaveValue('')
})

test('keyboard search selection scrolls into view without scrolling the dashboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 })
  await openDashboard(page)
  await openSearch(page)
  await page.getByRole('textbox', { name: 'Search leads by name or email' }).fill('Test')
  await expect(page.getByRole('button', { name: 'Test lead 15 Fabricated result', exact: true })).toBeAttached()
  // Up from the first result wraps to the last, beyond the scrolling list.
  await page.keyboard.press('ArrowUp')
  const selected = page.getByRole('dialog', { name: 'Search leads' }).locator('button[aria-current="true"]')
  await expect(selected).toContainText('Test lead 15')
  await expect(selected).toBeInViewport()
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
})

test('Tab then Enter activates the focused search result, not the previous selection', async ({ page, browserName }) => {
  await openDashboard(page)
  await openSearch(page)
  await page.getByRole('textbox', { name: 'Search leads by name or email' }).fill('Test')
  await expect(page.getByRole('button', { name: 'Test lead 2 Fabricated result', exact: true })).toBeAttached()
  // WebKit follows macOS's default Tab policy; Option+Tab includes buttons.
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
  await page.keyboard.press(tab)
  await page.keyboard.press(tab)
  await expect(page.getByRole('button', { name: 'Test lead 2 Fabricated result', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL('http://outlio.test/crm/contacts/fixture-2')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('search never opens another focus trap over a form', async ({ page }) => {
  await openDashboard(page)
  // Keyboard activation gives both engines a focused opener to restore;
  // unlike Chrome, Safari does not focus buttons on a pointer click.
  await page.getByRole('button', { name: 'Open test form' }).focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(page.getByRole('dialog', { name: 'Test form' })).toBeVisible()
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
  await expect(page.getByRole('button', { name: 'Open test form' })).toBeFocused()
})

test('mobile search has an accessible trigger and fits a short viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 320 })
  await openDashboard(page)
  await page.getByRole('button', { name: 'Search leads', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Search leads' })
  await expect(dialog).toBeInViewport({ ratio: 1 })
  await page.getByRole('textbox', { name: 'Search leads by name or email' }).fill('Test')
  await expect(page.getByRole('button', { name: 'Test lead 15 Fabricated result', exact: true })).toBeAttached()
  await expect(dialog).toBeInViewport({ ratio: 1 })
  await page.keyboard.press('ArrowUp')
  // WebKit rounds intersection geometry at the panel's curved edge.
  await expect(dialog.locator('button[aria-current="true"]')).toBeInViewport({ ratio: 0.98 })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Search leads', exact: true })).toBeFocused()
})

test('closing mobile navigation restores focus and the original page scroll position', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 })
  await openDashboard(page)
  await page.evaluate(() => window.scrollTo(0, 800))
  const opener = page.getByRole('button', { name: 'Open navigation' })
  await opener.click()
  await expect(page.getByRole('dialog', { name: 'Product navigation' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(opener).toBeFocused()
  expect(await page.evaluate(() => window.scrollY)).toBe(800)
  await page.getByRole('button', { name: 'End of dashboard' }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: 'End of dashboard' })).toBeInViewport()
})

test('a settings table scrolls locally instead of widening the page on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 })
  await openDashboard(page, '?settings')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  const table = page.getByTestId('wide-table')
  expect(await table.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
})

test('all settings links remain reachable on a short desktop viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 480 })
  await openDashboard(page, '?settings')
  await page.evaluate(() => window.scrollTo(0, 800))
  const nav = page.getByRole('navigation', { name: 'Settings sections' })
  await nav.hover()
  await page.mouse.wheel(0, 600)
  await expect(nav.getByRole('link', { name: 'Delete account' })).toBeInViewport()
})

test('form focus and tab wrapping skip hidden and disabled fields', async ({ page }) => {
  await openDashboard(page)
  await page.getByRole('button', { name: 'Open test form' }).click()
  const first = page.getByRole('textbox', { name: 'First form field' })
  await expect(first).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: 'Close test form' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(first).toBeFocused()
})

test('form rerenders do not reset focus or jump a long dialog to the top', async ({ page }) => {
  await openDashboard(page)
  await page.getByRole('button', { name: 'Open test form' }).focus()
  await page.keyboard.press('Enter')
  const update = page.getByRole('button', { name: 'Update form (0)' })
  await update.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Update form (1)' })).toBeFocused()
  const lastField = page.getByRole('textbox', { name: 'Last form field' })
  // fill() need not scroll in WebKit; explicitly reach the end of the form.
  await lastField.scrollIntoViewIfNeeded()
  await lastField.fill('last')
  await expect(lastField).toBeInViewport()
  await page.getByRole('button', { name: 'Close test form' }).click()
  await expect(page.getByRole('button', { name: 'Open test form' })).toBeFocused()
})

test('failed referral copy keeps the mobile fallback visible and usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 })
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('Clipboard blocked')) } }))
  await openDashboard(page)
  await page.getByRole('button', { name: 'Open navigation' }).click()
  const dialog = page.getByRole('dialog', { name: 'Product navigation' })
  await dialog.getByRole('button', { name: /Refer & get/ }).click()
  await expect(dialog.getByRole('textbox', { name: 'Your referral link' })).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Your referral link' })).toBeFocused()
})
