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
]

/** The body of one exported async function, by bracket depth. */
function functionBody(source: string, start: number): string {
  const open = source.indexOf('{', start)
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

  for (const file of walk('app')) {
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
 * ⚠️ EMPTY, AND IT SHOULD STAY EMPTY. An ungated server action is a public
 * mutation endpoint. If something genuinely belongs here it needs a reason
 * written next to it and an ADR, not a quiet addition.
 */
const ALLOWED = new Set<string>([])

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
