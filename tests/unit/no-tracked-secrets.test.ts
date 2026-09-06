/**
 * No file that can hold a credential may be tracked by git.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS EXISTS BECAUSE I COMMITTED A DATABASE PASSWORD ON 2026-09-04.      ║
 * ║                                                                           ║
 * ║  Setting up the staging project, I added `.staging-db-password` and       ║
 * ║  `.env.staging` to `.gitignore` — and not `.staging-db-url`, which        ║
 * ║  embeds the same password inside a connection string. `git add -A` took   ║
 * ║  it. It was caught by reading `git show --stat` after the commit, removed ║
 * ║  by amend, and never pushed.                                             ║
 * ║                                                                           ║
 * ║  ⚠️ THE NEAR-MISS IS THE POINT. Nothing would have failed. Not `tsc`, not ║
 * ║  lint, not 2,797 tests. The next `git push` would have published a live   ║
 * ║  credential, and the only thing that stopped it was noticing a filename   ║
 * ║  in a stat output.                                                        ║
 * ║                                                                           ║
 * ║  Ignoring the file you thought of is not a control. This checks the       ║
 * ║  property directly: is anything credential-shaped actually TRACKED?      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')

/** Everything git currently tracks. The real question, not what .gitignore says. */
function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
}

/**
 * Filename shapes that carry credentials.
 *
 * ⚠️ MATCHES ON SHAPE, NOT ON A LIST OF KNOWN FILES. A list would have
 * contained `.staging-db-password` and missed `.staging-db-url`, which is
 * exactly what happened.
 */
const SECRET_SHAPED = [
  /(^|\/)\.env($|\.)/, // .env, .env.local, .env.staging …
  /(^|\/)[^/]*(password|passwd|secret|credential)[^/]*$/i,
  /(^|\/)[^/]*(db-url|database-url|conn(ection)?-string)[^/]*$/i,
  /\.(pem|key|p12|pfx|keystore)$/i,
  /(^|\/)service[-_]?account.*\.json$/i,
  /(^|\/)id_(rsa|ed25519|ecdsa)$/,
]

/**
 * Extensions that mean "this is code or documentation about a secret", not a
 * secret.
 *
 * ⚠️ NAME-ONLY MATCHING IS TOO BROAD IN ONE DIRECTION AND THAT MATTERS. The
 * first version flagged `lib/auth/password.ts`, `components/auth/
 * PasswordField.tsx` and four others — all source files that READ a secret from
 * the environment and contain none. A guard that names six innocent files on
 * its first run is one somebody mutes, and then it protects nothing.
 *
 * A real credential file is extensionless, or `.env*`, `.pem`, `.key`, `.json`
 * — never `.tsx`.
 */
const SOURCE_EXTENSIONS = /\.(tsx?|jsx?|mts|cts|md|css|scss|html|svg|snap|lock|yml|yaml|toml)$/i

/** `.env.example` and friends are templates and SHOULD be committed. */
const TEMPLATE = /\.(example|sample|template|dist)$/i

function looksLikeSecret(file: string): boolean {
  if (TEMPLATE.test(file)) return false
  if (SOURCE_EXTENSIONS.test(file)) return false
  return SECRET_SHAPED.some((p) => p.test(file))
}

/**
 * Tracked files that look like secrets but are not.
 *
 * ⚠️ EVERY ENTRY MUST BE A FILE THAT CANNOT CONTAIN A LIVE VALUE — a template,
 * an example, or source code whose NAME mentions a secret while its contents
 * only read one from the environment.
 */
const ALLOWED = new Set<string>([
  '.env.example',
  'lib/fastspring/server.ts', // reads getFastSpringWebhookSecret from env
  'lib/integrations/crypto.ts', // reads INTEGRATION_ENCRYPTION_KEY from env
  'lib/email/unsubscribe.ts', // reads UNSUBSCRIBE_TOKEN_SECRET from env
  'lib/extension/tokens.ts', // reads TRIAL_IP_HASH_SECRET from env
  'tests/unit/no-tracked-secrets.test.ts', // this file
])

describe('the scanner itself', () => {
  it('can see the repository', () => {
    // Without this a git failure makes every assertion below vacuous.
    const files = trackedFiles()
    expect(files.length).toBeGreaterThan(300)
    expect(files).toContain('package.json')
  })

  it('recognises the shape that was actually missed', () => {
    /*
     * `.staging-db-url` is the file that got committed. A guard that would not
     * have caught the incident it was written for is decoration.
     */
    expect(looksLikeSecret('.staging-db-url')).toBe(true)
    expect(looksLikeSecret('.staging-db-password')).toBe(true)
    expect(looksLikeSecret('.env.staging')).toBe(true)
    expect(looksLikeSecret('config/serviceAccount.json')).toBe(true)
    expect(looksLikeSecret('certs/private.pem')).toBe(true)
  })

  it('does not flag a template, at any depth', () => {
    // A template with placeholder values SHOULD be committed. The first version
    // missed the nested one.
    expect(looksLikeSecret('.env.example')).toBe(false)
    expect(looksLikeSecret('services/web-research-mcp/.env.example')).toBe(false)
  })

  it('does not flag source code that merely mentions a secret', () => {
    // Six innocent files were named by the first version of this guard.
    expect(looksLikeSecret('lib/auth/password.ts')).toBe(false)
    expect(looksLikeSecret('components/auth/PasswordField.tsx')).toBe(false)
    expect(looksLikeSecret('lib/integrations/crypto.ts')).toBe(false)
  })
})

describe('no credential-shaped file is tracked', () => {
  it('git tracks nothing that looks like a secret', () => {
    const offenders = trackedFiles().filter((f) => !ALLOWED.has(f) && looksLikeSecret(f))

    expect(
      offenders,
      `These files are TRACKED BY GIT and look like they hold credentials. ` +
        `Nothing else in this repo would notice — not tsc, not lint, not the ` +
        `test suite — and the next push publishes them. Remove with ` +
        `\`git rm --cached <file>\`, add it to .gitignore, and rotate whatever ` +
        `it contained if the commit was ever pushed.`,
    ).toEqual([])
  })
})
