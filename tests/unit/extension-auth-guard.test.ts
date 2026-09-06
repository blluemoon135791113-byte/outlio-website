/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE EXTENSION'S ONLY AUTH BOUNDARY HAD NO TEST AT ALL.                  ║
 * ║                                                                           ║
 * ║  Found by mutation testing: making `resolveExtensionAuth` accept a        ║
 * ║  REVOKED device left all 3,034 unit tests green — and unlike the          ║
 * ║  suppression gate, no integration test covered it either. Nothing         ║
 * ║  anywhere exercised it.                                                   ║
 * ║                                                                           ║
 * ║  It guards /api/extension/{capture,company,me,session}. The file's own    ║
 * ║  banner states the threat: "The extension is public code. Assume an       ║
 * ║  attacker has read it, copied it, and is now sending handcrafted          ║
 * ║  requests." Revoking a device is the one control a user has when a        ║
 * ║  browser is lost or shared.                                               ║
 * ║                                                                           ║
 * ║  ⚠️ STRUCTURAL, AND THAT IS A COMPROMISE. `resolveExtensionAuth` makes    ║
 * ║  several sequential service-role queries, so a behavioural test needs a   ║
 * ║  live database. These assertions prove the checks are PRESENT and ORDERED,║
 * ║  not that they behave correctly. That is strictly weaker — and strictly   ║
 * ║  better than the nothing that was here before.                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const AUTH = join(ROOT, 'lib/extension/auth.ts')
const ROUTES = join(ROOT, 'app/api/extension')

/** Comments describe the checks in prose; only code enforces them. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
}

const source = code(AUTH)

describe('resolveExtensionAuth keeps all seven checks', () => {
  it('refuses a device that is disabled or revoked', () => {
    expect(
      /if \(!deviceRow\.enabled \|\| deviceRow\.revoked_at\)/.test(source),
      'a revoked or disabled device would keep capturing pages — this is the only ' +
        'control a user has when a browser is lost, shared, or stolen.',
    ).toBe(true)
    expect(source).toContain("fail('DEVICE_REVOKED'")
  })

  it('refuses a token superseded by a rotation', () => {
    // Revoking nulls/replaces the jti so tokens issued earlier die immediately
    // rather than lingering until they expire on their own.
    expect(/deviceRow\.access_token_jti !== claims\.jti/.test(source)).toBe(true)
  })

  it('scopes the device lookup to the token subject', () => {
    /*
     * ⚠️ THE SERVICE ROLE BYPASSES RLS. Without `.eq('user_id', claims.sub)`
     * a valid token for device A would resolve device B — the two live tenancy
     * models make this a silent wrong-row read, not an error.
     */
    /*
     * ⚠️ BOUNDED AT `.maybeSingle()`, NOT AT END OF FILE. `extension_devices`
     * is touched twice — the lookup here and the heartbeat update at the end,
     * which carries its own `.eq('user_id', claims.sub)`. Slicing to the end of
     * the file therefore passed on the HEARTBEAT's scope while the lookup had
     * none: this assertion was vacuous until a mutation proved it.
     */
    const start = source.indexOf("from('extension_devices')")
    const lookup = source.slice(start, source.indexOf('.maybeSingle()', start))
    expect(start).toBeGreaterThan(-1)
    expect(lookup).toContain("eq('user_id', claims.sub)")
  })

  it('honours the admin kill-switch before the entitlement branch', () => {
    /*
     * Order matters: an admin disabling the extension must win over any plan
     * state, so a paying customer can still be switched off.
     */
    const killSwitch = source.indexOf('EXTENSION_DISABLED')
    const entitlement = source.indexOf('ctx.canUseScraper')
    expect(killSwitch).toBeGreaterThan(-1)
    expect(entitlement).toBeGreaterThan(-1)
    expect(killSwitch).toBeLessThan(entitlement)
  })

  it('checks the subscription independently of the plan', () => {
    expect(source).toContain('subscriptionAllows(claims.sub)')
    expect(source).toContain("fail('SUBSCRIPTION_REQUIRED'")
  })

  it('verifies the token before doing any I/O', () => {
    /*
     * Cheapest check first: an unauthenticated request must not be able to make
     * us query the database at all.
     *
     * ⚠️ SCOPED TO THE FUNCTION BODY. Searching the whole file finds the
     * `createAdminClient()` inside `subscriptionAllows`, which is DEFINED
     * earlier and CALLED later — so a file-wide indexOf reports the I/O
     * happening before the verify it actually follows. Same shape as taking
     * the first `{` of a function and calling it the body.
     */
    const body = source.slice(source.indexOf('export async function resolveExtensionAuth'))
    const verify = body.indexOf('verifyAccessToken(token)')
    const firstQuery = body.indexOf('createAdminClient()')
    expect(verify).toBeGreaterThan(-1)
    expect(firstQuery).toBeGreaterThan(-1)
    expect(verify).toBeLessThan(firstQuery)
  })
})

describe('every extension route goes through it', () => {
  const routes = readdirSync(ROUTES, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(ROUTES, e.name, 'route.ts'))
    .filter((p) => {
      try {
        readFileSync(p)
        return true
      } catch {
        return false
      }
    })

  it('finds the routes at all', () => {
    expect(routes.length).toBeGreaterThanOrEqual(4)
  })

  /*
   * `pair` and `refresh` legitimately do not: pairing is how a device is
   * created in the first place, and refresh authenticates on the refresh token.
   * Both compare a HASHED token via `hashToken` rather than resolving a
   * session. Named explicitly so a THIRD exception has to be added
   * deliberately rather than appearing by omission.
   */
  const SELF_AUTHENTICATING = new Set(['pair', 'refresh'])

  for (const route of routes) {
    const name = relative(ROOT, route)
    const segment = route.split('/').slice(-2)[0]!

    it(`${name} resolves auth before acting`, () => {
      if (SELF_AUTHENTICATING.has(segment)) {
        // Still must not be silently unguarded — assert it authenticates somehow.
        const src = code(route)
        expect(
          /hashToken|resolveExtensionAuth|verifyAccessToken/.test(src),
          `${name} is exempt from resolveExtensionAuth but authenticates nothing.`,
        ).toBe(true)
        return
      }

      expect(
        code(route).includes('resolveExtensionAuth('),
        `${name} does not call resolveExtensionAuth. The extension is public code; ` +
          'a route that re-derives entitlement itself is a route that gets it wrong.',
      ).toBe(true)
    })
  }
})
