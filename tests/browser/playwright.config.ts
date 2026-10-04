import { defineConfig } from '@playwright/test'

// Isolated component/browser regressions. Unlike the staging E2E suite, this
// needs no credentials, Next server, environment files or external services.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: `../../test-results/dashboard-components-${process.env.E2E_BROWSER === 'webkit' ? 'webkit' : 'chromium'}`,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    browserName: process.env.E2E_BROWSER === 'webkit' ? 'webkit' : 'chromium',
    channel: process.env.E2E_BROWSER === 'webkit' ? undefined : process.env.E2E_BROWSER_CHANNEL || undefined,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
})
