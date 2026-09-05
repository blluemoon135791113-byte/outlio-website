/**
 * The last definition of `handle_new_user` must do all four of its jobs.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  `create or replace function` DOES NOT MERGE. IT REPLACES.               ║
 * ║                                                                           ║
 * ║  `0070_workspaces.sql` — a migration about workspaces — redefined         ║
 * ║  `handle_new_user()` to create a profile and a workspace. In doing so it  ║
 * ║  deleted, with no error and no diff anybody read as a deletion:           ║
 * ║                                                                           ║
 * ║    • the one-time signup reservation check          (0018)                ║
 * ║    • the device fingerprint claim                   (0019)                ║
 * ║    • the email / phone / linkedin reuse block       (0019)                ║
 * ║    • full_name, phone and linkedin_url on profiles  (0009)                ║
 * ║                                                                           ║
 * ║  MEASURED IN PRODUCTION ON 2026-09-04, eleven days later: 915 signup      ║
 * ║  reservations created, 19 ever consumed. 39 of 60 profiles with a null    ║
 * ║  name, phone and LinkedIn URL. Zero errors, on either side.               ║
 * ║                                                                           ║
 * ║  ⚠️ WHAT MAKES THIS CLASS OF BUG SURVIVE: the server never stopped        ║
 * ║  sending the data. `lib/auth/actions.ts` still computes four hashes and   ║
 * ║  reserves an IP on every attempt, and the comment above it still claims   ║
 * ║  the trigger consumes the token. The producer was fine. The consumer was  ║
 * ║  gone. No type, lint or build step can see across that gap, and neither   ║
 * ║  can a test that calls the gate directly — only one that asks whether the ║
 * ║  gate is still installed.                                                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const MIGRATIONS = join(__dirname, '..', '..', 'supabase', 'migrations')

/**
 * ⚠️ COMMENTS ARE STRIPPED BEFORE ANYTHING IS SCANNED.
 *
 * 0110's own header comment quotes the declaration it repairs, and this file's
 * `RESPONSIBILITIES` markers are ordinary words like `full_name` that appear in
 * prose constantly. Two guards written earlier in this project matched their
 * own explanatory comments and passed against broken SQL. Strip first, then
 * assert only against executable text.
 */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '')
}

const files = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => ({
    file: f,
    body: stripSqlComments(readFileSync(join(MIGRATIONS, f), 'utf8')),
  }))

/**
 * Every migration that redefines the trigger, in application order.
 *
 * ⚠️ ORDER IS THE WHOLE POINT. Only the LAST definition is live; an earlier
 * migration containing a perfect gate proves nothing about today's database.
 * 0019 has the gate and 0070 came after it.
 */
function definitions(): { file: string; body: string }[] {
  return files.filter(({ body }) =>
    /create or replace function public\.handle_new_user/.test(body),
  )
}

/** The body of the trigger function as that migration installs it. */
function functionBody(migration: string): string {
  const start = migration.indexOf('create or replace function public.handle_new_user')
  const open = migration.indexOf('as $$', start)
  const close = migration.indexOf('$$;', open)
  return migration.slice(open, close)
}

describe('the migration scanner itself', () => {
  it('finds every definition of handle_new_user', () => {
    /*
     * Without this, a change in how the function is declared would make every
     * assertion below vacuous against an empty list.
     *
     * ⚠️ THE THRESHOLD IS THE PRE-REPAIR COUNT (5), NOT THE CURRENT ONE. If it
     * were 6, this test would fail whenever 0110 is absent — which is the
     * `0110 exists` test's job, and having two tests fail for one cause makes
     * the scanner's own health unreadable.
     */
    const found = definitions()
    expect(found.length).toBeGreaterThanOrEqual(5)
    expect(found.map((f) => f.file)).toContain('0070_workspaces.sql')
  })

  it('extracts a body, not an empty string', () => {
    const last = definitions().at(-1)!
    expect(functionBody(last.body).length).toBeGreaterThan(200)
  })
})

describe('the live definition of handle_new_user', () => {
  const last = definitions().at(-1)!
  const body = functionBody(last.body)

  /**
   * Each responsibility, with the migration that introduced it and a marker
   * that cannot plausibly appear for another reason.
   */
  const RESPONSIBILITIES: { job: string; since: string; markers: string[] }[] = [
    {
      job: 'consumes the one-time signup reservation',
      since: '0018_signup_ip_gate.sql',
      markers: ['signup_ip_claims', 'Signup is not authorized'],
    },
    {
      job: 'claims the device fingerprint',
      since: '0019_signup_device_identity_claims.sql',
      markers: ['signup_device_claims'],
    },
    {
      job: 'blocks email / phone / linkedin reuse',
      since: '0019_signup_device_identity_claims.sql',
      markers: ['signup_identity_claims'],
    },
    {
      job: 'writes the profile contact fields',
      since: '0009_profile_contact_fields.sql',
      markers: ['full_name', 'phone', 'linkedin_url'],
    },
    {
      job: 'creates the workspace and owner membership',
      since: '0070_workspaces.sql',
      markers: ['workspaces', 'workspace_memberships'],
    },
  ]

  for (const { job, since, markers } of RESPONSIBILITIES) {
    it(`${job} (added by ${since})`, () => {
      for (const marker of markers) {
        expect(
          body,
          `${last.file} installs a handle_new_user that never mentions "${marker}", so it no longer ${job}. ` +
            `\`create or replace function\` REPLACES — a migration that redefines this trigger must carry ` +
            `every responsibility forward, not just the one it came to add. This is the 0070 regression, ` +
            `which ran unnoticed in production for eleven days.`,
        ).toContain(marker)
      }
    })
  }

  it('validates all four hashes before doing any work', () => {
    // A gate that runs after the profile insert is not a gate; the row exists
    // by the time it raises, and only the transaction rollback saves it.
    const gateAt = body.indexOf('Signup is not authorized')
    const profileAt = body.indexOf('insert into public.profiles')
    expect(gateAt).toBeGreaterThan(-1)
    expect(profileAt).toBeGreaterThan(-1)
    expect(gateAt, 'the gate must be reached before the profile is written').toBeLessThan(
      profileAt,
    )
  })

  it('requires each hash to be 64 hex characters', () => {
    // Accepting a short or non-hex hash would let a caller supply a value that
    // cannot collide with a real one, which defeats the uniqueness gate
    // without failing anything.
    for (const key of [
      'signup_device_hash',
      'signup_email_hash',
      'signup_phone_hash',
      'signup_linkedin_hash',
    ]) {
      expect(body, `${key} is not read`).toContain(key)
    }
    expect(body).toContain('^[0-9a-f]{64}$')
  })
})

describe('0110 repairs the 0070 regression', () => {
  const repair = files.find((f) => f.file.startsWith('0110'))

  it('exists', () => {
    expect(repair, '0110 is missing').toBeDefined()
  })

  it('verifies its own result against pg_proc', () => {
    /*
     * The bug being repaired is a function silently replaced by a migration
     * about something else. A repair that asserts nothing about what it just
     * installed could be undone the same way tomorrow.
     */
    expect(repair!.body).toContain('pg_proc')
    expect(repair!.body).toContain('raise exception')
    expect(repair!.body).toContain('0110 failed')
  })

  it('leaves a comment on the function warning the next author', () => {
    expect(repair!.body).toContain('comment on function public.handle_new_user()')
  })
})
