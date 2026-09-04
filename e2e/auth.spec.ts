import { expect, test } from '@playwright/test'

/**
 * The three things about auth that can break without anybody noticing.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ NOTHING HERE CREATES AN ACCOUNT, AND THAT IS A CONSTRAINT, NOT A     ║
 * ║  PREFERENCE.                                                             ║
 * ║                                                                           ║
 * ║  `.env.local` points at PRODUCTION. The integration suite already signs   ║
 * ║  up freely there and has left 43 `outlio-test-*` accounts behind. Adding  ║
 * ║  a browser-driven sign-up would add more, to the database serving real    ║
 * ║  customers.                                                               ║
 * ║                                                                           ║
 * ║  So the sign-up → workspace journey the Phase 0.5 brief asks for is NOT   ║
 * ║  here. It is blocked on DECISION-03 (a non-production database), and      ║
 * ║  writing it against production would be trading one silent problem for a  ║
 * ║  louder one. Same for the mailbox journey, which additionally needs       ║
 * ║  DECISION-04.                                                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

test.describe('sign-in', () => {
  test('renders and hydrates', async ({ page }) => {
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  HYDRATION IS THE ASSERTION. IT HAS FAILED SILENTLY HERE BEFORE.      ║
     * ║                                                                       ║
     * ║  Next dev refuses to serve client chunks to an origin missing from    ║
     * ║  `allowedDevOrigins`. When that happens the page still renders — the  ║
     * ║  server component output is fine and a screenshot looks perfect — but ║
     * ║  React never hydrates and NO interactive element works.               ║
     * ║                                                                       ║
     * ║  Three test results earlier in this project were invalidated by that  ║
     * ║  exact failure, and every one of them looked like a UI bug.           ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    const consoleErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })

    await page.goto('/sign-in')
    await expect(page.getByLabel(/email/i)).toBeVisible()

    // The reveal toggle is client-only, so it working at all proves hydration.
    const toggle = page.getByRole('button', { name: /show|hide/i })
    await expect(toggle).toBeVisible()

    const password = page.getByLabel(/^password$/i)
    await password.fill('not-a-real-password')
    await expect(password).toHaveAttribute('type', 'password')
    await toggle.click()
    await expect(
      password,
      'The reveal toggle did not change the input type, which means React never ' +
        'hydrated. Check allowedDevOrigins in next.config.ts before assuming a UI bug.',
    ).toHaveAttribute('type', 'text')

    expect(consoleErrors.join('\n')).not.toMatch(/hydrat/i)
  })

  test('rejects bad credentials without revealing which field was wrong', async ({ page }) => {
    /*
     * ⚠️ THE ABSENCE OF A FIELD NAME IS THE POINT. Sign-UP rejections name the
     * field they are about; sign-IN deliberately does not, because "no account
     * with that email" tells an attacker which addresses are registered. A
     * well-meaning change that adds field-level errors here for consistency
     * would be a user-enumeration hole, and it would look like an improvement.
     */
    await page.goto('/sign-in')
    await page.getByLabel(/email/i).fill('nobody-here@example.com')
    await page.getByLabel(/^password$/i).fill('definitely-not-the-password')
    await page.getByRole('button', { name: /sign in/i }).click()

    const feedback = page.getByRole('alert')
    await expect(feedback).toBeVisible()
    await expect(feedback).not.toHaveText(/email .*(not found|does not exist|unknown)/i)
    await expect(feedback).not.toHaveText(/password is (wrong|incorrect)/i)
  })
})

test.describe('authorization is server-side', () => {
  /*
   * ⚠️ CLAUDE.md: "Hiding a button is not access control."
   *
   * These assert the redirect happens for a request that never renders a UI at
   * all, which is the only way to prove the decision is made on the server.
   */
  for (const path of ['/dashboard', '/crm/contacts', '/email', '/flows']) {
    test(`${path} refuses an unauthenticated visitor`, async ({ page }) => {
      const response = await page.goto(path)

      expect(
        page.url(),
        `${path} did not redirect an unauthenticated visitor. If this page ever ` +
          `renders for a signed-out request, the guard is client-side and the data ` +
          `is already on the wire.`,
      ).toMatch(/\/sign-in|\/welcome|\/access/)

      expect(response?.status()).toBeLessThan(500)
    })
  }
})
