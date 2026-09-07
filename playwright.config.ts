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
    /*
     * ⚠️ `dev:staging`, NOT `dev`. The tenant-isolation journey signs users in
     * and reads their data; pointed at production it would create real accounts
     * and its fixtures would not exist, so it would "pass" by finding nothing.
     * See scripts/with-staging-env.mjs.
     */
    command: 'npm run dev:staging',
    url: 'http://127.0.0.1:3000/sign-in',
    /*
     * ⚠️ NEVER REUSE. `reuseExistingServer: !CI` DEFEATS THE LINE ABOVE, and it
     * is not a theoretical risk — it happened on 2026-09-07.
     *
     * Playwright reuses ANY listener on the port. It cannot tell `dev:staging`
     * from a plain `npm run dev` left running in another terminal, and a plain
     * `next dev` reads `.env.local` — PRODUCTION. So the fixtures were created
     * in staging while the browser signed in against production, and five specs
     * failed with "email and password did not work": one environment fault
     * wearing the costume of five product bugs.
     *
     * That was the LUCKY shape. The fixtures were simply absent, so it failed
     * loudly. A spec that SIGNS UP rather than reading a fixture would instead
     * have succeeded — against production — creating real accounts in the live
     * database and reporting green. Forty-two `outlio-test-*` accounts had to be
     * deleted from production earlier in this project, and this is the most
     * plausible way they got there.
     *
     * Cost of not reusing: one `next dev` boot per run, against a 2-minute
     * suite. Cost of reusing: silent cross-environment writes. Not close.
     *
     * With this false, a busy port is a hard startup error — loud, and correct.
     */
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
