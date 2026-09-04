import { defineConfig, devices } from '@playwright/test'

/**
 * The E2E harness — Phase 0.5 item 2.3, DECISION-01.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS IS A TRIPWIRE, NOT A TEST SUITE.                                   ║
 * ║                                                                           ║
 * ║  §4 of the build contract requires "Playwright test file path + passing   ║
 * ║  run output" for any UI claim. Without it, every `ui=YES` row in the gap  ║
 * ║  matrix rests on somebody having read the code — which is exactly the     ║
 * ║  standard of evidence that let Phase 0's findings survive.               ║
 * ║                                                                           ║
 * ║  ⚠️ IT COVERS THE PATHS WHERE A SILENT FAILURE IS INVISIBLE TO THE OWNER, ║
 * ║  and deliberately nothing else. Broad UI coverage here would be slow,     ║
 * ║  flaky, and — on the evidence of this codebase — would still not have     ║
 * ║  caught a single Phase 0 finding, because those were composition bugs     ║
 * ║  behind screens that render perfectly.                                    ║
 * ║                                                                           ║
 * ║  A suite that takes 25 minutes is a suite nobody runs. That is not an     ║
 * ║  aphorism here; it is what happened, and it cost eleven days of a broken  ║
 * ║  signup gate. Keep this fast.                                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export default defineConfig({
  testDir: './e2e',
  /*
   * ⚠️ FULLY PARALLEL IS SAFE ONLY WHILE THESE TESTS DO NOT SIGN UP.
   *
   * The integration suite runs serially because two files racing on the same
   * device or identity hash produce failures that look like the gate
   * misbehaving. Any test added here that CREATES AN ACCOUNT must be serialised
   * the same way, or it will be flaky in a manner that wastes a lot of time.
   */
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  /*
   * ⚠️ `127.0.0.1`, NOT `localhost`, AND THAT IS NOT COSMETIC. Next dev rejects
   * cross-origin requests for client chunks unless the origin is in
   * `allowedDevOrigins` (next.config.ts lists 127.0.0.1). When it rejects them,
   * the page renders server-side and React NEVER HYDRATES — so every
   * interaction test fails while the screenshot looks perfect. Three test
   * results earlier in this project were invalidated by exactly that.
   */
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3000/sign-in',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
