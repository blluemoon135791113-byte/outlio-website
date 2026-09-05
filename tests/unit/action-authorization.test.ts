/**
 * Every server action must pass through an authorization gate.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  A PERFECT PERMISSION MATRIX IS WORTH NOTHING IF NO ROUTE CONSULTS IT.   ║
 * ║                                                                           ║
 * ║  `workspace-permissions.test.ts` already covers every role × permission,  ║
 * ║  allow AND deny, plus non-members, the setter boundary and entitlements.  ║
 * ║  Those tests are thorough and they all pass.                             ║
 * ║                                                                           ║
 * ║  They also prove exactly nothing about whether a server action calls      ║
 * ║  `assertWorkspacePermission` before writing to the database — and that is ║
 * ║  the same shape as `actorAuthorized`, which this project found being READ ║
 * ║  by the send gate and WRITTEN by nothing, and `userId`, read by every AI  ║
 * ║  step and written nowhere.                                               ║
 * ║                                                                           ║
 * ║  ⚠️ CLAUDE.md: "Authorization is server-side. Hiding a button is not      ║
 * ║  access control." A server action is a PUBLIC HTTP ENDPOINT. Next gives   ║
 * ║  it a generated id and anyone can post to it, whatever the UI shows.      ║
 * ║  An action with no gate is an unauthenticated mutation.                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, entry)
    if (statSync(join(ROOT, rel)).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue
      out.push(...walk(rel))
    } else if (/\.tsx?$/.test(entry)) out.push(rel)
  }
  return out
}

/** Comments removed by whole line, so a blank line is never manufactured. */
const stripComments = (s: string) =>
  s.replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*\n/gm, '').replace(/^[ \t]*\/\/.*\n/gm, '')

/**
 * Anything that establishes who the caller is and what they may do.
 *
 * ⚠️ `requireWorkspace` AND `requireUser` COUNT, EVEN THOUGH THEY CHECK
 * IDENTITY RATHER THAN PERMISSION. They establish an authenticated caller and a
 * tenant, which is the property that stops an anonymous mutation. Whether the
 * right *permission* was then checked is a judgement this scan cannot make —
 * `workspace-permissions.test.ts` covers the matrix, and the gap between them is
 * stated in PHASE_1_EVIDENCE.md rather than hidden.
 */
const GATES = [
  'assertWorkspacePermission',
  'requireWorkspacePermission',
  'assertWorkspaceMembership',
  'requireWorkspace',
  'requireAdmin',
  'assertAdmin',
  'requireUser',
  'assertUser',
  // ⚠️ ENUMERATED FROM lib/, NOT GUESSED. An incomplete list is a scanner that
  // reports correct code: leaving these three out flagged the whole
  // intelligence API and the extension pairing action as public.
  'assertAccess',
  'requireAccess',
  'assertHubbleAccess',
  'requireHubbleAccess',
  /*
   * ⚠️ THE SUPABASE CLIENT IS ITSELF A GATE WHEN THE RESULT IS CHECKED.
   * `updatePasswordAction` has no named helper — it calls
   * `supabase.auth.getUser()` and refuses when there is no user, which is the
   * only thing that can gate a password reset: the caller holds a recovery
   * session and nothing else. Leaving it out reported the reset flow as a
   * public mutation.
   */
  '.auth.getUser',
]

/** The body of one exported async function, by bracket depth. */
/**
 * The body of the function declared at `start`.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ "THE FIRST `{` AFTER THE NAME" IS THE TYPE ANNOTATION, NOT THE BODY.  ║
 * ║                                                                           ║
 * ║  This used to take the first brace it found, which for a signature like    ║
 * ║                                                                           ║
 * ║    export async function f(i: { a: string }): Promise<{ b?: string }>     ║
 * ║                                                                           ║
 * ║  is the PARAMETER type — so the scan examined `{ a: string }`, found no    ║
 * ║  gate in it, and reported a correctly-gated action as a public endpoint.   ║
 * ║  Caught when the walk was widened to `lib/`, where three such actions      ║
 * ║  (`exportSelectedLeadsToGoogleAction`, `createUploadSessionAction`,        ║
 * ║  `finalizeUploadAction`) were flagged despite each calling                 ║
 * ║  `assertAccess()` on its first line.                                      ║
 * ║                                                                           ║
 * ║  ⚠️ THE ERROR DIRECTION WAS SAFE — a truncated body finds no gate, so it   ║
 * ║  over-reports rather than under-reports. That is the only reason this      ║
 * ║  never shipped a false clean bill of health.                              ║
 * ║                                                                           ║
 * ║  The body brace is the first `{` at angle-bracket depth 0 after the        ║
 * ║  parameter list closes: `Promise<{ … }>` keeps its brace inside `<>`, and  ║
 * ║  a parameter's braces are consumed with the parameter list itself.         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
function functionBody(source: string, start: number): string {
  // Step past the parameter list by matching its parentheses.
  const paren = source.indexOf('(', start)
  if (paren === -1) return ''
  let parenDepth = 0
  let afterParams = -1
  for (let i = paren; i < source.length; i += 1) {
    if (source[i] === '(') parenDepth += 1
    else if (source[i] === ')') {
      parenDepth -= 1
      if (parenDepth === 0) {
        afterParams = i + 1
        break
      }
    }
  }
  if (afterParams === -1) return ''

  // Then the first brace that is not inside a generic type argument.
  let angle = 0
  let open = -1
  for (let i = afterParams; i < source.length; i += 1) {
    const c = source[i]!
    if (c === '<') angle += 1
    else if (c === '>') angle = Math.max(0, angle - 1)
    else if (c === '{' && angle === 0) {
      open = i
      break
    }
  }
  if (open === -1) return ''

  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    const c = source[i]!
    if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open, i)
    }
  }
  return source.slice(open)
}


type Action = { file: string; name: string; gated: boolean }

function serverActions(): Action[] {
  const out: Action[] = []

  for (const file of [...walk('app'), ...walk('lib')]) {
    const raw = readFileSync(join(ROOT, file), 'utf8')
    if (!raw.includes("'use server'")) continue
    const src = stripComments(raw)

    /*
     * ⚠️ A GATE ONE CALL DEEP STILL COUNTS, and missing that flagged three
     * correct actions. `email/inbox/actions.ts` centralises its check in a
     * local `found()` helper that calls `requireWorkspace()` and also applies
     * the assignee rule — which is BETTER than repeating the gate three times,
     * and a scan that only reads the action's own body calls it public.
     *
     * One level of indirection, within the same file. Deeper than that and the
     * gate is too far from the endpoint to be obvious to a reader, which is its
     * own problem.
     */
    const localHelpers = new Map<string, string>()
    for (const h of src.matchAll(/(?:async function|const)\s+(\w+)\s*(?:=|\()/g)) {
      localHelpers.set(h[1]!, functionBody(src, h.index!))
    }

    const hasGate = (body: string): boolean => {
      if (GATES.some((g) => body.includes(`${g}(`))) return true
      for (const [name, helperBody] of localHelpers) {
        if (!body.includes(`${name}(`)) continue
        if (GATES.some((g) => helperBody.includes(`${g}(`))) return true
      }
      return false
    }

    for (const m of src.matchAll(/export async function (\w+)\s*\(/g)) {
      out.push({ file, name: m[1]!, gated: hasGate(functionBody(src, m.index!)) })
    }
  }
  return out
}

/**
 * Actions that legitimately run without a gate.
 *
 * ⚠️ IT WAS EMPTY WHILE THE SCAN ONLY WALKED `app/`. Widening it to `lib/`
 * brought in the AUTHENTICATION surface, which is categorically different from
 * every other action: it is what a caller uses when they have no session yet.
 * Requiring a gate on sign-in is circular.
 *
 * ⚠️ EACH ENTRY IS PUBLIC BY NECESSITY, NOT BY OVERSIGHT, and each is defended
 * by something other than a gate — `lib/auth/rate-limit.ts` bounds every one of
 * them, and the signup gate additionally applies to registration. Anything
 * added here later needs the same standard: a reason it CANNOT be gated, not a
 * reason nobody got round to it.
 */
const ALLOWED = new Set<string>([
  // No session exists yet; these create or resume one.
  'lib/auth/actions.ts:signUpAction',
  'lib/auth/actions.ts:signInAction',
  // Ends a session. Takes no input and can only affect the caller's own cookie.
  'lib/auth/actions.ts:signOutAction',
  // Both are the "I cannot get in" path, so requiring a session defeats them.
  'lib/auth/actions.ts:requestPasswordResetAction',
  'lib/auth/actions.ts:resendVerificationAction',
  /*
   * Reads one environment flag and returns a boolean. No tenant data, no
   * mutation, and the answer is already visible in the sign-up UI.
   */
  'lib/access/actions.ts:invitationsEnabled',
])

describe('the scanner itself', () => {
  it('finds the server actions', () => {
    // Without this a convention change empties the scan and every assertion
    // below passes against nothing.
    const actions = serverActions()
    expect(actions.length).toBeGreaterThan(30)
    expect(actions.map((a) => a.name)).toContain('launchCampaign')
  })

  it('reads a whole function body', () => {
    const src = 'export async function f() {\n  if (x) { y() }\n  gate()\n}'
    expect(functionBody(src, 0)).toContain('gate()')
  })

  it('would notice an ungated action', () => {
    // Proves the gate detection can return false at all.
    const src = "'use server'\nexport async function leak() {\n  return db.write()\n}"
    const body = functionBody(stripComments(src), src.indexOf('export'))
    expect(GATES.some((g) => body.includes(`${g}(`))).toBe(false)
  })
})

describe('no server action is reachable without authorization', () => {
  const ungated = serverActions().filter(
    (a) => !a.gated && !ALLOWED.has(`${a.file}:${a.name}`),
  )

  it('every exported server action calls an auth gate', () => {
    expect(
      ungated.map((a) => `${a.file} → ${a.name}()`),
      `These server actions never establish who is calling. A server action is a ` +
        `PUBLIC endpoint — Next assigns it an id and anyone can post to it, ` +
        `regardless of what the UI renders. Hiding the button is not access ` +
        `control (CLAUDE.md). Add a gate, or justify it in an ADR.`,
    ).toEqual([])
  })
})

/**
 * Routes whose job is to ACCEPT a credential rather than require one.
 *
 * ⚠️ THESE CANNOT BE GATED, IN THE SAME SENSE A LOGIN ENDPOINT CANNOT BE. The
 * credential presented is the authentication. What protects them instead is
 * rate limiting, short expiry, hashing at rest, and — for refresh — single-use
 * rotation with reuse detection.
 *
 * Adding to this list means asserting an endpoint has no caller to check yet.
 * Anything already holding a session or a token does NOT belong here.
 */
const CREDENTIAL_EXCHANGE: Record<string, string> = {
  'app/api/extension/pair/route.ts':
    'exchanges a one-time pairing code minted by a signed-in session; the code is the credential',
  'app/api/extension/refresh/route.ts':
    'rotates a refresh token, single-use with reuse detection; the token is the credential',
}

describe('API route handlers are gated too', () => {
  const ungated: string[] = []

  for (const file of walk('app').filter((f) => /app[\\/]api[\\/].*route\.tsx?$/.test(f))) {
    const src = stripComments(readFileSync(join(ROOT, file), 'utf8'))
    if (!/export (?:const|async function) (GET|POST|PUT|PATCH|DELETE)/.test(src)) continue

    /*
     * ⚠️ `apiRoute(...)` COUNTS AS A GATE, and it is the strongest one here:
     * it authenticates the key, checks scope, rate-limits and hands the handler
     * a workspace it cannot override. Webhooks verify a provider signature
     * instead — a different mechanism for a caller that is not a user.
     */
    const gated =
      GATES.some((g) => src.includes(`${g}(`)) ||
      // An API key, authenticated and scope-checked, workspace not overridable.
      src.includes('apiRoute(') ||
      // A signed provider callback: the signature IS the authentication.
      /verify\w*Signature|verifyWebhook|timingSafeEqual|constantTimeEqual/.test(src) ||
      // The extension's own bearer token, issued at pairing.
      /resolveExtensionAuth|requireExtensionAuth/.test(src) ||
      // An OAuth callback carrying signed state.
      /verifyOAuthState|consumeOAuthTransaction|isApprovedOutlioAppOrigin/.test(src) ||
      /*
       * ⚠️ `@/lib/supabase/server` IS A GATE, and the one most easily missed.
       * Unlike `admin.ts` it RESPECTS RLS and reads the caller's session, so an
       * unauthenticated request sees nothing. Routes using it are authorized by
       * the database rather than by an explicit call, which is why a scan for
       * gate FUNCTIONS alone reported them public.
       */
      /from '@\/lib\/supabase\/server'/.test(src)

    if (!gated && !(file in CREDENTIAL_EXCHANGE)) ungated.push(file)
  }

  it('the credential-exchange exceptions are still rate limited', () => {
    /*
     * The only thing standing between these and brute force. If a future edit
     * removes the limiter, the exemption above stops being defensible — so the
     * exemption asserts its own precondition.
     */
    for (const file of Object.keys(CREDENTIAL_EXCHANGE)) {
      const src = readFileSync(join(ROOT, file), 'utf8')
      expect(src, `${file} is exempt from the auth gate but no longer rate limits`).toMatch(
        /consume\(/,
      )
    }
  })

  it('every API route authenticates its caller somehow', () => {
    expect(
      ungated,
      `These route handlers neither authenticate a user, nor use apiRoute, nor ` +
        `verify a provider signature. Anything reachable at a URL with no caller ` +
        `check is public.`,
    ).toEqual([])
  })
})
