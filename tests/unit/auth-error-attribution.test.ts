/**
 * Which input an auth error is allowed to point at.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ATTRIBUTION IS A UX FEATURE ON SIGN-UP AND A SECURITY BUG ON SIGN-IN.    ║
 * ║                                                                           ║
 * ║  Naming the field that failed turns "Enter a valid phone number" from a   ║
 * ║  banner above five inputs into a message under the one that is wrong.     ║
 * ║  Doing the same on sign-in would undo `GENERIC_CREDENTIALS_ERROR`: a      ║
 * ║  rejection attributed to `email` says "this address exists, the password  ║
 * ║  is wrong" — or the reverse — and the form becomes an account-enumeration ║
 * ║  oracle.                                                                  ║
 * ║                                                                           ║
 * ║  Both are one optional property on one type, so nothing in the compiler   ║
 * ║  distinguishes them. These are the tests that do.                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8')

const ACTIONS = read('lib/auth/actions.ts')

/** The body of one exported action, up to the next top-level `export async`. */
function actionBody(name: string): string {
  const start = ACTIONS.indexOf(`export async function ${name}(`)
  expect(start, `${name} not found in lib/auth/actions.ts`).toBeGreaterThan(-1)
  const next = ACTIONS.indexOf('\nexport async function ', start + 1)
  return ACTIONS.slice(start, next === -1 ? undefined : next)
}

describe('sign-in never attributes an error to a field', () => {
  const body = actionBody('signInAction')

  it('builds its rejections without naming a field', () => {
    /*
     * `signUpAction`'s `reject` takes `(message, field)`. Sign-in's must not:
     * a second parameter here is the whole leak, one argument away.
     */
    expect(body).toContain('const reject = (message: string): ActionState')
    expect(body).not.toMatch(/const reject = \(message: string, field/)
  })

  it('sets no `field` anywhere in the action', () => {
    /*
     * ⚠️ VERIFIED NON-VACUOUS: replacing sign-in's `reject` with sign-up's
     * two-argument form, or adding `field: 'email'` to the returned object,
     * fails this. The sign-up suite below proves the same matcher does find a
     * field when one is present.
     */
    expect(body).not.toMatch(/\bfield\s*[:,]/)
  })

  it('still answers a bad email and a bad password identically', () => {
    // Both paths return the same constant, so the response cannot distinguish
    // "no such account" from "wrong password".
    const returns = body.match(/return reject\(([^)]*)\)/g) ?? []
    expect(returns.length).toBeGreaterThan(1)
    const credentialRejections = returns.filter((r) =>
      r.includes('GENERIC_CREDENTIALS_ERROR'),
    )
    // The invalid-email path and the failed-auth path — two of them, one string.
    expect(credentialRejections.length).toBe(2)
  })
})

describe('sign-up attributes every validation failure to its own field', () => {
  const body = actionBody('signUpAction')

  it('passes a field name with each rejection', () => {
    /*
     * The pairing is what matters: each validator's rejection must carry the
     * name of the input it validated. A mismatch — `phoneResult` rejected as
     * `'email'` — would put the message under the wrong box and focus there.
     */
    const pairs: Array<[RegExp, string]> = [
      [/if \(!nameResult\.ok\) return reject\(nameResult\.reason, 'full_name'\)/, 'full_name'],
      [/if \(!phoneResult\.ok\) return reject\(phoneResult\.reason, 'phone'\)/, 'phone'],
      [
        /if \(!linkedInResult\.ok\) return reject\(linkedInResult\.reason, 'linkedin_url'\)/,
        'linkedin_url',
      ],
      [/return reject\(passwordCheck\.reason, 'password'\)/, 'password'],
    ]

    for (const [pattern, field] of pairs) {
      expect(body, `${field} rejection is not attributed to ${field}`).toMatch(pattern)
    }
  })

  it('names only inputs the form actually renders', () => {
    /*
     * ⚠️ THE FAILURE THIS CATCHES IS SILENT. `FormFeedback` focuses
     * `[name="<field>"]`; a field named after a variable rather than an input
     * — `linkedIn` instead of `linkedin_url` — finds nothing, focuses nothing,
     * and looks exactly like the feature working on a fast machine.
     */
    /*
     * ⚠️ THE FORM FILE ALONE IS NOT THE ANSWER, and the first version of this
     * test assumed it was. `phone` is rendered by `PhoneField`, not by
     * `SignUpForm`, so checking one file reported a correctly-wired field as
     * missing. What has to exist is an input with that name in the DOM the
     * form produces — which spans the shared auth components too.
     */
    const rendered = [
      'app/(auth)/sign-up/SignUpForm.tsx',
      'components/auth/PhoneField.tsx',
      'components/auth/Field.tsx',
      'components/auth/PasswordField.tsx',
    ]
      .map(read)
      .join('\n')

    const attributed = [...body.matchAll(/reject\([^,)]+, '([a-z_]+)',?\s*\)/g)].map(
      (match) => match[1]!,
    )

    expect(attributed.length).toBeGreaterThanOrEqual(4)
    for (const field of attributed) {
      /*
       * `Field` and `PasswordField` pass `name` straight through from props, so
       * a generic component satisfies this via the `{...props}` spread only if
       * the caller supplies the name — which is why the form file is in the
       * list and the components are there for the ones that hardcode it.
       */
      expect(rendered, `nothing renders an input named "${field}"`).toContain(
        `name="${field}"`,
      )
    }
  })

  it('leaves provider and rate-limit failures unattributed', () => {
    // No single input is wrong when the rate limiter or Supabase refuses, and
    // "already registered" must not be inferable from which box is highlighted.
    for (const fragment of [
      'Too many attempts. Please wait and try again.',
      'We could not complete sign-up. Please check your details and try again.',
    ]) {
      const index = body.indexOf(fragment)
      expect(index, fragment).toBeGreaterThan(-1)
      // The reject call wrapping it ends before the next statement; no field
      // argument may appear between the message and the closing paren.
      const tail = body.slice(index + fragment.length, index + fragment.length + 40)
      expect(tail).not.toMatch(/,\s*'[a-z_]+'/)
    }
  })
})

describe('the form renders what the action attributes', () => {
  it('sign-up reads state.field for every attributed input', () => {
    const form = read('app/(auth)/sign-up/SignUpForm.tsx')
    // One helper, used by every field — not five ad-hoc comparisons that can
    // disagree about which state shape they are reading.
    expect(form).toContain("state.field === name ? state.message : undefined")
    for (const field of ['full_name', 'email', 'phone', 'linkedin_url', 'password']) {
      expect(form, `${field} does not render its error`).toContain(`errorFor('${field}')`)
    }
  })

  it('sign-in renders no per-field error at all', () => {
    const form = read('app/(auth)/sign-in/SignInForm.tsx')
    expect(form).not.toContain('errorFor')
    expect(form).not.toMatch(/\berror=\{/)
  })

  it('the LinkedIn input accepts what its own placeholder shows', () => {
    /*
     * ⚠️ REGRESSION GUARD, NOT STYLE. The field advertised
     * `linkedin.com/in/your-name` and carried type="url", which the browser
     * rejects for having no scheme — so the placeholder demonstrated a value
     * the field refused, and `normalizeLinkedInUrl`'s deliberate
     * scheme-prepending was unreachable. Restoring type="url" would silently
     * re-block every schemeless address AND every message this suite asserts,
     * because the form would never submit.
     */
    const form = read('app/(auth)/sign-up/SignUpForm.tsx')
    const field = form.slice(
      form.indexOf('id="linkedin_url"'),
      form.indexOf('id="password"'),
    )
    expect(field).toContain('type="text"')
    expect(field).not.toContain('type="url"')
    expect(field).toContain('inputMode="url"')

    // And the server still does the real check, including the scheme it adds.
    const normalizer = read('lib/auth/profile-fields.ts')
    expect(normalizer).toContain('candidate = `https://${candidate}`')
  })
})

/**
 * ⚠️ COMMENTS ARE NOT CODE, AND THIS FILE LEARNED THAT TWICE.
 *
 * `PasswordField`'s doc comment contains the literal `<button type="button">`
 * as an explanation. Two successive versions of the reveal-button test —
 * a whole-file `toContain`, then one scoped to the first `<button` — both
 * passed against a file whose real button had no `type` at all, because both
 * were reading that sentence. Every assertion below runs on source with block
 * and line comments removed, so nothing can be satisfied by prose about it.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('the password field does not defeat password managers', () => {
  const field = stripComments(read('components/auth/PasswordField.tsx'))

  it('never blocks paste', () => {
    // WCAG 2.2 "Accessible Authentication" counts blocking paste as a failure,
    // and it is the fastest way to make strong passwords impossible to use.
    expect(field).not.toMatch(/onPaste/)
    expect(field).not.toMatch(/autoComplete=["']off["']/)
  })

  it('is a button, not a submit', () => {
    /*
     * The default `type` for a <button> inside a form is "submit". A reveal
     * control without an explicit type submits half-typed credentials — and on
     * sign-in that spends a rate-limit attempt.
     *
     * ⚠️ ASSERTED ON THE ELEMENT, IN SOURCE WITH COMMENTS STRIPPED. See the
     * note above `stripComments`: both earlier versions of this guard were
     * reading the doc comment.
     */
    const open = field.indexOf('<button')
    expect(open, 'no <button> in PasswordField').toBeGreaterThan(-1)
    const tag = field.slice(open, field.indexOf('>', open))
    expect(tag).toContain('type="button"')
  })

  it('announces the change it makes', () => {
    // The visible change is to characters a screen-reader user is not reading,
    // so without a live region the toggle does nothing they can perceive.
    expect(field).toContain('aria-pressed={revealed}')
    expect(field).toMatch(/aria-live="polite"/)
  })
})
