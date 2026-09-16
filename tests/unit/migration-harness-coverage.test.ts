/**
 * The migration harness must know about every migration.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ ITS PREREQUISITE LIST STOPPED AT 0106 AND THE PLATFORM DID NOT.       ║
 * ║                                                                           ║
 * ║  Twenty migrations later, anything depending on 0107..0126 got a FALSE     ║
 * ║  FAILURE: 0131 reported "column o.value_amount_base does not exist" (0130  ║
 * ║  creates it) and 0132 reported "relation public.linkedin_senders does not  ║
 * ║  exist" (0122). Both apply perfectly to the real database.                ║
 * ║                                                                           ║
 * ║  ⚠️ A SKIPPED PREREQUISITE DOES NOT WEAKEN THE CHECK — IT INVERTS IT. The  ║
 * ║  migration under test fails for a reason that has nothing to do with the   ║
 * ║  migration, and the only rational response to a tool that cries wolf is to ║
 * ║  stop running it. Which is what happened: 0134 went to the SQL editor      ║
 * ║  unvalidated and failed there on `string_agg(plan_key, unknown)` — an      ║
 * ║  error this harness exists to catch and now does.                         ║
 * ║                                                                           ║
 * ║  CLAUDE.md mandates the harness. Nothing checked the harness.             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * This runs offline in milliseconds. It cannot tell whether a migration APPLIES
 * — only `scripts/check-migration.sh` does that, against real Postgres. It
 * tells you the harness still knows the migration exists, which is the part
 * that rotted silently for twenty releases.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const SCRIPT = readFileSync(join(ROOT, 'scripts/check-migration.sh'), 'utf8')

/** Every migration on disk, by numeric prefix. */
const ALL = readdirSync(join(ROOT, 'supabase', 'migrations'))
  .filter((n) => /^\d{4}_.*\.sql$/.test(n))
  .map((n) => ({ num: Number(n.slice(0, 4)), name: n.replace(/\.sql$/, '') }))
  .sort((a, b) => a.num - b.num)

/**
 * The prerequisite list, read from the `for m in ... ; do` loop.
 *
 * ⚠️ SCOPED TO THE LOOP HEADER. The script's comments name migrations while
 * explaining the skips — 0118, 0119, 0130 and 0132 all appear in prose right
 * beside the list. Matching the whole file would count those as replayed and
 * report coverage the harness does not have.
 */
function prerequisites(): string[] {
  const open = SCRIPT.indexOf('for m in 0070_workspaces')
  expect(open, 'the prerequisite loop was renamed or removed').toBeGreaterThan(-1)
  const close = SCRIPT.indexOf('; do', open)
  expect(close, 'the prerequisite loop is no longer closed with `; do`').toBeGreaterThan(open)

  // Inline `# ...` comment words are spliced in as `` `# ...` `` continuations;
  // drop them before reading names.
  const body = SCRIPT.slice(open, close).replace(/`#[^`]*`/g, ' ')
  return [...body.matchAll(/\b(\d{4}_[a-z0-9_]+)/g)].map((m) => m[1]!)
}

/**
 * Migrations the harness cannot replay, with the reason.
 *
 * ⚠️ AN ALLOW-LIST, NOT A THRESHOLD. Each entry is a specific environmental
 * limit of stock `postgres:16`, not a judgement that the migration is
 * unimportant. Anything added here should name what is unavailable.
 */
const UNREPLAYABLE: Record<string, string> = {
  '0118_pg_cron_tick': 'needs the pg_cron extension, which Supabase provides and postgres:16 does not',
  '0119_scheduler_diagnostics': 'reads cron.job and net._http_response, neither of which exists without pg_cron',
}

describe('the scanner sees what it polices', () => {
  it('finds migrations and a prerequisite list', () => {
    // Vacuity: an empty list on either side makes the coverage check pass over
    // nothing, which is precisely how the list rotted unnoticed.
    expect(ALL.length).toBeGreaterThan(120)
    expect(prerequisites().length).toBeGreaterThan(50)
  })

  it('reads the loop, not the prose around it', () => {
    /*
     * ⚠️ PROVES THE SCOPING IS LOAD-BEARING. The script's own comments name
     * 0118 and 0119 while explaining why they are skipped. If the extractor
     * read the whole file it would count them as replayed and this suite would
     * be green about coverage the harness does not have.
     */
    expect(SCRIPT, 'the skip rationale was removed').toContain('0118')
    expect(prerequisites(), '0118 is being read out of a comment').not.toContain(
      '0118_pg_cron_tick',
    )
  })
})

describe('the prerequisite list keeps up with the platform', () => {
  it('replays every migration it can, up to the newest', () => {
    const newest = ALL[ALL.length - 1]!.num
    const listed = new Set(prerequisites())

    // Below 0070 the harness scaffolds by hand instead of replaying, which is
    // deliberate and documented in the script.
    const missing = ALL.filter(
      (m) =>
        m.num >= 70 &&
        m.num < newest &&
        !listed.has(m.name) &&
        !(m.name in UNREPLAYABLE),
    ).map((m) => m.name)

    expect(
      missing,
      'These migrations are not replayed before the one under test, so any ' +
        'migration depending on them fails here for a reason unrelated to ' +
        'itself. That false failure is worse than no harness: it trains ' +
        'everyone to skip the check, which is how 0134 reached the SQL editor ' +
        'unvalidated. Add them to the `for m in ...` list, or to UNREPLAYABLE ' +
        'with the specific reason stock postgres:16 cannot run them.',
    ).toEqual([])
  })

  it('lists them in ascending order, since it replays them in order', () => {
    const nums = prerequisites().map((n) => Number(n.slice(0, 4)))
    expect(nums, 'a prerequisite is replayed before something it depends on').toEqual(
      [...nums].sort((a, b) => a - b),
    )
  })

  it('every skip names what is actually unavailable', () => {
    // A skip list is where a harness goes to die quietly. Requiring a reason
    // that names the missing object makes adding one a decision, not a reflex.
    for (const [name, reason] of Object.entries(UNREPLAYABLE)) {
      expect(ALL.some((m) => m.name === name), `${name} no longer exists`).toBe(true)
      expect(reason, `${name}'s skip reason does not say what is missing`).toMatch(
        /pg_cron|cron\.|net\._http_response/,
      )
    }
  })
})

describe('the scaffold is not looser than production', () => {
  it('models plans.key as the enum, not as text', () => {
    /*
     * ⚠️ THE BUG THAT STARTED THIS. `plans.key` is `public.plan_key` (0001),
     * and the scaffold declared it `text` — which accepts every expression the
     * enum accepts AND every one it rejects. So the harness reported "applies
     * cleanly" for SQL the real database refused with
     * "function string_agg(plan_key, unknown) does not exist".
     *
     * A scaffold looser than production is the one failure mode a pre-flight
     * check must not have: it passes what production rejects.
     */
    const scaffold = SCRIPT.slice(
      SCRIPT.indexOf('create table public.plans ('),
      SCRIPT.indexOf(');', SCRIPT.indexOf('create table public.plans (')),
    )
    expect(scaffold).toMatch(/key\s+public\.plan_key/)
    expect(scaffold, 'plans.key is text again; enum errors will go undetected').not.toMatch(
      /key\s+text/,
    )
    expect(SCRIPT, 'the plan_key enum is no longer created').toMatch(
      /create type public\.plan_key as enum/,
    )
  })

  it('the enum carries the same values as 0001', () => {
    // A scaffold enum missing a value would reject a plan the real database
    // accepts — the opposite error, equally wrong.
    const source = readFileSync(
      join(ROOT, 'supabase/migrations/0001_extensions_enums_functions.sql'),
      'utf8',
    )
    const real = source.slice(source.indexOf('create type public.plan_key as enum'))
    for (const key of ['trial', 'starter', 'professional', 'agency', 'custom']) {
      expect(real, `0001 no longer defines ${key}`).toContain(`'${key}'`)
      expect(SCRIPT, `the scaffold enum is missing ${key}`).toContain(`'${key}'`)
    }
  })
})
