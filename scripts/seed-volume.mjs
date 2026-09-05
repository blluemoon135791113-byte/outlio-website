/**
 * Seed §7's volume fixture into STAGING.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THIS SCRIPT REFUSES TO RUN AGAINST PRODUCTION, AND THE CHECK IS THE   ║
 * ║  MOST IMPORTANT LINE IN IT.                                              ║
 * ║                                                                           ║
 * ║  It writes 150,000 rows. Pointed at the wrong database that is not a      ║
 * ║  test, it is an incident — and this project has already had a Playwright  ║
 * ║  run silently attach to a production dev server (Phase 1 evidence). The   ║
 * ║  target is therefore compared against the KNOWN staging ref, not merely   ║
 * ║  read from whichever env file happened to load.                          ║
 * ║                                                                           ║
 * ║  DECISION-08 option A: contacts, companies and opportunities only.        ║
 * ║  §7 also lists 1M activities. Measured row widths put the full set at     ║
 * ║  400–550 MB against Supabase's 500 MB free-tier cap, past which the       ║
 * ║  project goes READ-ONLY. Activities are a Phase 14 figure (dashboard      ║
 * ║  rollups); Phase 2 is judged on list latency, which needs contacts.       ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Usage:  node scripts/seed-volume.mjs [--contacts 100000] [--clean]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const STAGING_REF = 'ahfyvhibzgxrhfjobbqn'

function fail(message) {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}

if (!existsSync('.staging-db-url')) fail('.staging-db-url is missing — see ADR-005.')
const dbUrl = readFileSync('.staging-db-url', 'utf8').trim()

/*
 * ⚠️ MATCH THE PROJECT REF, NOT THE WORD "staging". A file named
 * `.staging-db-url` containing a production connection string would pass any
 * name-based check, and would be exactly the mistake worth catching.
 */
if (!dbUrl.includes(STAGING_REF)) {
  fail(
    `.staging-db-url does not point at ${STAGING_REF}. Refusing to seed 150k rows ` +
      `into an unknown database.`,
  )
}

const args = process.argv.slice(2)
const clean = args.includes('--clean')
const contacts = Number(args[args.indexOf('--contacts') + 1]) || 100_000
const companies = Math.round(contacts * 0.3)
const opportunities = Math.round(contacts * 0.2)

/**
 * ⚠️ A FAILURE HERE MUST NOT ECHO THE CONNECTION STRING.
 *
 * `execFileSync` puts the full argv into the Error it throws, and argv[0] is a
 * URL containing the database password. An unhandled throw printed it to the
 * terminal on 2026-09-04 — a staging credential, but the same code shape would
 * leak a production one, and terminal output ends up in logs, screenshots and
 * transcripts.
 *
 * The URL is passed via PGPASSWORD-style env instead, and any error is
 * re-thrown with only the database's message.
 */
function sql(statement) {
  try {
    return execFileSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-tAc', statement], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    const detail = String(error.stderr ?? '').trim() || 'psql failed'
    throw new Error(`seed step failed: ${detail}`)
  }
}

/*
 * ⚠️ ONE DEDICATED WORKSPACE, TAGGED IN ITS NAME. The fixture must be
 * removable without touching anything a test created, and must never be the
 * workspace a test happens to pick up. Seeded rows outliving their purpose is
 * how 43 accounts accumulated in production.
 */
const WORKSPACE_NAME = 'VOLUME FIXTURE (§7)'

if (clean) {
  console.log('Removing the volume fixture…')
  sql(`
    do $$
    declare w uuid;
    begin
      select id into w from public.workspaces where name = '${WORKSPACE_NAME}';
      if w is null then raise notice 'no fixture workspace'; return; end if;
      delete from public.crm_opportunities where workspace_id = w;
      delete from public.crm_contacts      where workspace_id = w;
      delete from public.crm_companies     where workspace_id = w;
      raise notice 'fixture rows deleted';
    end $$;`)
  console.log('✓ removed (the workspace itself is kept, so a re-seed is cheap)')
  process.exit(0)
}

console.log(`\nSeeding ${contacts.toLocaleString()} contacts, ` +
  `${companies.toLocaleString()} companies, ${opportunities.toLocaleString()} opportunities`)
console.log(`→ ${STAGING_REF}\n`)

const owner = sql(`select id from auth.users order by created_at limit 1`)
if (!owner) fail('staging has no users; create one before seeding (the workspace needs an owner)')

/*
 * ⚠️ LOOK BEFORE INSERTING. `on conflict do nothing` needs a conflict TARGET,
 * and `workspaces.name` has no unique constraint — so the first version created
 * a NEW fixture workspace on every run. Seven accumulated, six of them empty,
 * and the measurement script's `.single()` then failed with "no volume fixture"
 * while 100,000 contacts sat in one of them.
 *
 * An "idempotent" step that silently is not is worse than one that errors.
 */
let workspaceId = sql(
  `select id from public.workspaces where name = '${WORKSPACE_NAME}' order by created_at limit 1`,
)

if (!workspaceId) {
  // INSERT then SELECT, not RETURNING: psql's -tAc emits the command status
  // ("INSERT 0 1") alongside the value, producing a uuid with a status line
  // glued to it that fails three statements later, far from the cause.
  sql(`
    insert into public.workspaces (owner_user_id, name)
    values ('${owner}', '${WORKSPACE_NAME}');`)
  workspaceId = sql(
    `select id from public.workspaces where name = '${WORKSPACE_NAME}' order by created_at limit 1`,
  )
}
if (!workspaceId) fail('could not create or find the fixture workspace')

console.log(`workspace: ${workspaceId}`)

/*
 * ⚠️ CLEAR FIRST, ALWAYS. A partial run leaves rows behind, and re-running then
 * fails on a unique constraint (crm_companies_domain_uniq) with an error that
 * says nothing about the real problem. A fixture seeder must be re-runnable:
 * running it twice should produce the stated volume, not double it and not
 * abort.
 *
 * Scoped to the fixture workspace, so nothing a test created is touched.
 */
/*
 * ⚠️ RAISE THE STATEMENT TIMEOUT FIRST. Deleting 100,000 contacts and their
 * index entries exceeds the pooler's default timeout, and the failure — 
 * "canceling statement due to statement timeout" — arrives on a RE-RUN, long
 * after the script appeared to work. Bulk maintenance needs a bulk budget.
 */
sql(`
  set statement_timeout = '600s';
  delete from public.crm_opportunities where workspace_id = '${workspaceId}';
  delete from public.crm_contacts      where workspace_id = '${workspaceId}';
  delete from public.crm_companies     where workspace_id = '${workspaceId}';`)

const started = Date.now()

/*
 * ⚠️ GENERATED IN POSTGRES, NOT IN NODE. 150,000 rows over the network as
 * individual inserts would take longer than the measurement they exist to
 * support, and would measure the client rather than the database.
 */
console.log('companies…')
sql(`
  set statement_timeout = '600s';
  insert into public.crm_companies (workspace_id, name, normalized_name, normalized_domain)
  select '${workspaceId}',
         'Fixture Company ' || g,
         'fixture company ' || g,
         'fixture-' || g || '.example.com'
  from generate_series(1, ${companies}) g;`)

console.log('contacts…')
sql(`
  set statement_timeout = '600s';
  insert into public.crm_contacts (workspace_id, full_name, job_title, location, created_at)
  select '${workspaceId}',
         'Fixture Person ' || g,
         (array['Head of Sales','SDR','Account Executive','Founder','Operations Lead'])[1 + (g % 5)],
         (array['London','Berlin','New York','Toronto','Singapore'])[1 + (g % 5)],
         now() - (g || ' minutes')::interval
  from generate_series(1, ${contacts}) g;`)

console.log('opportunities…')
sql(`
  set statement_timeout = '600s';
  do $$
  declare p uuid; s uuid;
  begin
    select id into p from public.crm_pipelines where workspace_id = '${workspaceId}' limit 1;
    if p is null then
      insert into public.crm_pipelines (workspace_id, name) values ('${workspaceId}', 'Fixture Pipeline')
      returning id into p;
      -- sort_order and kind, not position: read from information_schema
      -- rather than assumed. kind is NOT NULL with no default.
      -- (No backticks in here: this is inside a JS template literal.)
      insert into public.crm_pipeline_stages
        (workspace_id, pipeline_id, name, kind, sort_order, default_probability)
      values ('${workspaceId}', p, 'Fixture Stage', 'open', 1, 10)
      returning id into s;
    else
      select id into s from public.crm_pipeline_stages where pipeline_id = p limit 1;
    end if;

    insert into public.crm_opportunities (workspace_id, title, pipeline_id, stage_id, value_amount)
    select '${workspaceId}', 'Fixture Deal ' || g, p, s, (g % 50000)
    from generate_series(1, ${opportunities}) g;
  end $$;`)

console.log('analyze…')
// Without this the planner has stale statistics and the measurement is noise.
sql('analyze public.crm_contacts; analyze public.crm_companies; analyze public.crm_opportunities;')

const elapsed = ((Date.now() - started) / 1000).toFixed(1)
const size = sql('select pg_size_pretty(pg_database_size(current_database()))')

console.log(`\n✓ seeded in ${elapsed}s`)
console.log(`database size: ${size}`)
console.log(`workspace id : ${workspaceId}\n`)
