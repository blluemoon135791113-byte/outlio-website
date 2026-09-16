/**
 * On a phone, the form comes before the pitch.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ MEASURED IN A REAL BROWSER AT 375×812, NOT REASONED ABOUT.            ║
 * ║                                                                           ║
 * ║  Before this order existed, on `/sign-in`:                                ║
 * ║                                                                           ║
 * ║      email field top   726                                                ║
 * ║      SIGN IN BUTTON    920   ← below the 812 fold, on a 1142px page       ║
 * ║                                                                           ║
 * ║  A returning user on a phone landed on the marketing pitch and had to     ║
 * ║  scroll past it to reach the button, every single time. After: 301 and    ║
 * ║  495, both above the fold.                                                ║
 * ║                                                                           ║
 * ║  ⚠️ IT LOOKED FINE ON A DESKTOP, WHICH IS WHY IT SURVIVED. At `lg` the    ║
 * ║  two sit side by side and the pitch is simply on the left. Only the       ║
 * ║  stacked single-column case put it in front.                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * One shell serves all six auth routes, so the ordering is asserted once here
 * and every route inherits it.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const SHELL = readFileSync(join(ROOT, 'components/auth/AuthShell.tsx'), 'utf8')

describe('the scanner sees what it polices', () => {
  it('reads a shell with two stacked sections', () => {
    expect(SHELL).toContain('aria-labelledby="auth-title"')
    expect(SHELL).toMatch(/lg:grid-cols-/)
  })
})

describe('the form is first on a phone and second on a desktop', () => {
  it('the form panel carries order-1 and lg:order-2', () => {
    /*
     * ⚠️ BOTH HALVES MATTER. `order-1` alone would move the form up on every
     * breakpoint, putting it left of the pitch on a desktop — which reverses a
     * layout nobody asked to change and would read as a regression there.
     */
    /*
     * ⚠️ ANCHORED BY WALKING BACK TO THE OPENING TAG. My first attempt sliced a
     * fixed 400 characters before `aria-labelledby` and read to the first `>`,
     * which landed inside earlier markup and failed on correct code — a test
     * reporting its own extraction bug as a product defect.
     */
    const marker = SHELL.indexOf('aria-labelledby="auth-title"')
    expect(marker, 'the form panel lost its label').toBeGreaterThan(-1)
    const tagStart = SHELL.lastIndexOf('<section', marker)
    const opening = SHELL.slice(tagStart, SHELL.indexOf('>', marker) + 1)
    expect(opening).toMatch(/order-1\b/)
    expect(opening).toMatch(/lg:order-2\b/)
  })

  it('the pitch carries order-2 and lg:order-1', () => {
    const pitch = SHELL.slice(SHELL.indexOf('<section className="order-2'))
    const opening = pitch.slice(0, pitch.indexOf('>') + 1)
    expect(opening).toMatch(/order-2\b/)
    expect(opening).toMatch(/lg:order-1\b/)
  })

  it('records why, so the next person does not "tidy" it away', () => {
    /*
     * An `order-2` on a marketing panel reads like an accident. Without the
     * measurement beside it, removing it is a one-word change that looks like
     * cleanup and silently pushes the sign-in button back under the fold.
     */
    expect(SHELL).toMatch(/SECOND ON A PHONE, FIRST ON A DESKTOP/)
    expect(SHELL).toMatch(/920/)
  })
})

describe('every auth route inherits it', () => {
  it('all six use the shell', () => {
    const routes = readdirSync(join(ROOT, 'app/(auth)'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)

    expect(routes.length).toBeGreaterThanOrEqual(6)

    const without = routes.filter(
      (route) =>
        !readFileSync(join(ROOT, 'app/(auth)', route, 'page.tsx'), 'utf8').includes('AuthShell'),
    )
    expect(
      without,
      'These auth routes build their own layout, so the phone ordering fixed in ' +
        'AuthShell does not reach them.',
    ).toEqual([])
  })
})
