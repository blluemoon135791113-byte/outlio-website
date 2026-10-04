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

import { load } from 'cheerio'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AuthShell } from '@/components/auth/AuthShell'

const ROOT = join(__dirname, '..', '..')
const SHELL = readFileSync(join(ROOT, 'components/auth/AuthShell.tsx'), 'utf8')

function renderShell() {
  const props = {
    title: 'Sign in',
    children: createElement('form', { 'data-testid': 'auth-form' }),
  }
  const $ = load(renderToStaticMarkup(createElement(AuthShell, props)))
  const form = $('[aria-labelledby="auth-title"]')
  const grid = form.parent()
  // The artwork replaced the old pitch section with a div. Select the other
  // grid item, not a tag name or the order class this test is meant to police.
  const brand = form.siblings()

  expect(form).toHaveLength(1)
  expect(form.find('#auth-title').text()).toBe('Sign in')
  expect(form.find('form[data-testid="auth-form"]')).toHaveLength(1)
  expect(grid.hasClass('grid')).toBe(true)
  expect(grid.children()).toHaveLength(2)
  expect(brand).toHaveLength(1)

  return { form, grid, brand }
}

describe('the rendered shell keeps the form and brand in the same grid', () => {
  it('has two panels and a desktop column layout', () => {
    const { grid } = renderShell()
    expect(grid.attr('class')?.split(/\s+/).some((name) => name.startsWith('lg:grid-cols-'))).toBe(true)
  })
})

describe('the form is first on a phone and second on a desktop', () => {
  it('the form panel carries order-1 and lg:order-2', () => {
    /*
     * ⚠️ BOTH HALVES MATTER. `order-1` alone would move the form up on every
     * breakpoint, putting it left of the pitch on a desktop — which reverses a
     * layout nobody asked to change and would read as a regression there.
     */
    const { form } = renderShell()
    // Exact class tokens: lg:order-1 must not satisfy a missing base order-1.
    expect(form.hasClass('order-1')).toBe(true)
    expect(form.hasClass('lg:order-2')).toBe(true)
  })

  it('the brand panel carries order-2 and lg:order-1', () => {
    const { brand } = renderShell()
    expect(brand.hasClass('order-2')).toBe(true)
    expect(brand.hasClass('lg:order-1')).toBe(true)
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
