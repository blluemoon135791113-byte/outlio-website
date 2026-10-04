import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'dotenv'
import { defineConfig } from '@playwright/test'
import base from '../playwright.config'

// Fail before starting Next or creating fixtures, never fall back to production.
const env = parse(readFileSync(resolve(__dirname, '../.env.staging')))
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin !== 'https://ahfyvhibzgxrhfjobbqn.supabase.co') {
  throw new Error('Dashboard smoke tests require the staging project recorded in ADR-005')
}

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: 'dashboard-scroll.spec.ts',
  outputDir: '../test-results/dashboard-staging',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  // WebKit upgrades assets on HTTP localhost under the production CSP. Use
  // HTTPS instead of weakening that CSP; the certificate exists for this run.
  use: { ...base.use, baseURL: 'https://127.0.0.1:3107', ignoreHTTPSErrors: true, trace: 'off' },
  projects: [{
    name: 'dashboard',
    use: {
      browserName: process.env.E2E_BROWSER === 'webkit' ? 'webkit' : 'chromium',
      channel: process.env.E2E_BROWSER === 'webkit' ? undefined : process.env.E2E_BROWSER_CHANNEL || undefined,
    },
  }],
  webServer: {
    // A source snapshot/build cache of its own; never reuse the owner's dev
    // server or .next. Production mode also exercises real route prefetching.
    cwd: resolve(__dirname, '..'),
    command: 'node scripts/dashboard-test-server.mjs',
    url: 'https://127.0.0.1:3107/sign-in',
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
    timeout: 300_000,
    env: {
      NEXT_PUBLIC_APP_URL: 'https://127.0.0.1:3107',
      NEXT_PUBLIC_SITE_URL: 'https://127.0.0.1:3107',
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: '',
      NEXT_PUBLIC_POSTHOG_SYNTHETIC: 'true',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
})
