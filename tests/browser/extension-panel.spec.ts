import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { test, expect, type Page } from '@playwright/test'
import type { ExtensionMessage, ExtensionState } from '../../extensions/core/types'

declare global {
  interface Window {
    extensionFixture: { state: ExtensionState; messages: ExtensionMessage[]; fail: boolean }
  }
}
let bundle: string
let html: string
let css: string
const account = { email: 'fabricated-test-account-with-a-long-name@example.test', plan: 'Test', deviceLabel: 'Fixture' }
const ready: ExtensionState = { kind: 'ready', account, supported: true, ready: true }
const session = { id: 'fixture', pagesProcessed: 2, leadsFound: 50, leadsImported: 45, duplicatesSkipped: 5 }

test.beforeAll(async () => {
  const output = await build({ absWorkingDir: resolve(__dirname, '../..'), entryPoints: ['extensions/ui/popup/popup.ts'], bundle: true, write: false, format: 'iife' })
  bundle = output.outputFiles[0].text
  html = (await readFile('extensions/ui/popup/popup.html', 'utf8')).replace('<body>', '<body data-layout="panel">')
  css = await readFile('extensions/ui/popup/popup.css', 'utf8')
})
async function openPanel(page: Page, state: ExtensionState = ready) {
  await page.addInitScript((initialState) => {
    window.extensionFixture = { state: initialState, messages: [], fail: false }
    Object.defineProperty(window, 'chrome', { value: { runtime: { sendMessage: async (message: ExtensionMessage) => {
      const fixture = window.extensionFixture
      fixture.messages.push(message)
      if (fixture.fail) throw new Error('Fixture unavailable')
      if (message.type === 'START_CAPTURE') fixture.state = { kind: 'capturing', account: { email: 'fixture@example.test', plan: 'Test', deviceLabel: 'Test' }, supported: true, ready: true, session: { id: 'test', pagesProcessed: 0, leadsFound: 0, leadsImported: 0, duplicatesSkipped: 0 } }
      if (message.type === 'FINISH_CAPTURE') fixture.state = { kind: 'ready', account: { email: 'fixture@example.test', plan: 'Test', deviceLabel: 'Test' }, supported: true, ready: true }
      return message.type === 'GET_STATE' ? fixture.state : { ok: true }
    } } } })
  }, state)
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== 'http://extension.test') return route.abort()
    if (url.pathname === '/popup.js') return route.fulfill({ contentType: 'application/javascript', body: bundle })
    if (url.pathname === '/popup.css') return route.fulfill({ contentType: 'text/css', body: css })
    if (url.pathname.startsWith('/icons/')) return route.fulfill({ status: 204 })
    return route.fulfill({ contentType: 'text/html', body: html })
  })
  await page.goto('http://extension.test/panel.html')
  await expect(page.locator('#connection')).not.toHaveText('Checking…')
}
async function refreshPanel(page: Page) { await page.evaluate(() => window.dispatchEvent(new Event('focus'))) }

test('persistent sidebar preserves duplicate choices and keyboard focus across polls', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 650 })
  await openPanel(page)
  await page.getByLabel('Lead duplicate handling').selectOption('review')
  const websites = page.getByLabel('Include company details already visible on the page')
  await websites.check(); await websites.focus()
  await refreshPanel(page)
  await expect(websites).toBeFocused()
  await expect(websites).toBeChecked()
  await expect(page.getByLabel('Lead duplicate handling')).toHaveValue('review')
  await page.evaluate(() => { if (window.extensionFixture.state.kind === 'ready') window.extensionFixture.state.account.plan = 'Updated test plan' })
  await refreshPanel(page)
  await expect(page.getByText('Updated test plan plan')).toBeVisible()
  await expect(websites).toBeFocused()
  await expect(websites).toBeChecked()
  await page.getByRole('button', { name: 'Start capture', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Capture is active' })).toBeVisible()
  expect(await page.evaluate(() => window.extensionFixture.messages.find((m) => m.type === 'START_CAPTURE'))).toMatchObject({ dedupeMode: 'review', includeCompanyWebsites: true })
  await page.getByRole('button', { name: 'Finish capture', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Start capture', exact: true })).toBeEnabled()
})

test('narrow short sidebar has no horizontal overflow and every action remains reachable', async ({ page }) => {
  await page.setViewportSize({ width: 280, height: 360 })
  await openPanel(page, { kind: 'capturing', account, session, supported: true, ready: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.getByText('Records', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'View captures in Outlio' }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: 'View captures in Outlio' })).toBeInViewport()
  await page.getByRole('button', { name: 'View captures in Outlio' }).click()
  expect(await page.evaluate(() => window.extensionFixture.messages.some((m) => m.type === 'OPEN_DASHBOARD'))).toBe(true)
})

test('empty/loading lists cannot start and explain the reload after an update', async ({ page }) => {
  await openPanel(page, { ...ready, ready: false })
  await expect(page.getByRole('button', { name: 'Start capture', exact: true })).toBeDisabled()
  await expect(page.getByText('Waiting for list rows…')).toBeVisible()
  await expect(page.getByText(/Refresh that tab once/)).toBeVisible()
})

test('connection keeps the panel open while the worker opens the pairing tab', async ({ page }) => {
  await openPanel(page, { kind: 'not_connected' })
  await page.getByRole('button', { name: 'Connect account', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your lists, in Outlio' })).toBeVisible()
  expect(await page.evaluate(() => window.extensionFixture.messages.some((m) => m.type === 'CONNECT'))).toBe(true)
})

test('network errors leave a working stop control for an active capture', async ({ page }) => {
  await openPanel(page, { kind: 'error', message: 'Fixture network unavailable', retryable: true, sessionActive: true })
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Finish capture', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Start capture', exact: true })).toBeEnabled()
})

test('a disconnected worker is reported without an unhandled page error', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openPanel(page)
  await page.evaluate(() => { window.extensionFixture.fail = true })
  await refreshPanel(page)
  await expect(page.getByText(/Cannot reach the extension/)).toBeVisible()
  expect(errors).toEqual([])
})
