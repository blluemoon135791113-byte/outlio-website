/**
 * §7: "Contact list p95, 100k rows, filtered — < 800 ms server".
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE FIRST VERSION OF THIS SCRIPT MEASURED MY HOME INTERNET AND        ║
 * ║  REPORTED IT AS A §7 RESULT.                                             ║
 * ║                                                                           ║
 * ║  It timed `supabase-js` calls from a laptop to us-east-2 and compared     ║
 * ║  the total against a budget written for SERVER latency. Measured floor    ║
 * ║  for a trivial one-row query on that path:                                ║
 * ║                                                                           ║
 * ║      p50 312 ms · p95 749 ms · min 290 ms                                 ║
 * ║                                                                           ║
 * ║  So every "measurement" was ~300 ms of round trip plus noise, and the     ║
 * ║  p95 tail was ENTIRELY network. It reported PASS at 766 ms and FAIL at    ║
 * ║  1149 ms for the same query on the same data, an hour apart, having       ║
 * ║  changed nothing. A Vercel server in-region sees single-digit RTT.        ║
 * ║                                                                           ║
 * ║  ⚠️ SO THE VERDICT IS TAKEN FROM `EXPLAIN (ANALYZE, BUFFERS)` — the time   ║
 * ║  and pages the DATABASE actually spends, which is what §7's budget is     ║
 * ║  about and what holds on any hardware. Client RTT is reported alongside   ║
 * ║  as context and explicitly EXCLUDED from the judgement.                   ║
 * ║                                                                           ║
 * ║  `scripts/volume-test.sh` reached this conclusion first: "The assertion   ║
 * ║  is on the PLAN, not the clock." It was right and I had to rediscover it. ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const STAGING_REF = 'ahfyvhibzgxrhfjobbqn'

if (!existsSync('.staging-db-url')) {
  console.error('.staging-db-url is missing — see ADR-005.')
  process.exit(1)
}
const dbUrl = readFileSync('.staging-db-url', 'utf8').trim()
if (!dbUrl.includes(STAGING_REF)) {
  console.error(`.staging-db-url does not point at ${STAGING_REF}.`)
  process.exit(1)
}

function sql(statement) {
  try {
    return execFileSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-tAc', statement], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    // Never echo the connection string: execFileSync puts argv in the Error.
    throw new Error(`psql failed: ${String(error.stderr ?? '').trim()}`)
  }
}

const workspaceId = sql(
  `select id from public.workspaces where name = 'VOLUME FIXTURE (§7)' limit 1`,
).trim()

if (!workspaceId) {
  console.error('No volume fixture. Run: node scripts/seed-volume.mjs')
  process.exit(1)
}

const total = sql(
  `select count(*) from public.crm_contacts where workspace_id = '${workspaceId}'`,
).trim()

const RUNS = Number(process.argv[2]) || 10
const SELECT = 'id, full_name, job_title, location, created_at'
const WHERE = `workspace_id = '${workspaceId}' and deleted_at is null`

/**
 * The query shapes `listContacts` produces.
 *
 * ⚠️ COPIED FROM lib/crm/contacts-list.ts. A benchmark that invents simpler
 * queries measures nothing — the risk is precisely that a real query has a
 * filter or an ordering the benchmark forgot.
 */
const scenarios = {
  'unfiltered, page 1': `select ${SELECT} from public.crm_contacts where ${WHERE} order by created_at desc limit 25`,
  'unfiltered, page 200': `select ${SELECT} from public.crm_contacts where ${WHERE} order by created_at desc limit 25 offset 5000`,
  'sorted by name': `select ${SELECT} from public.crm_contacts where ${WHERE} order by full_name asc limit 25`,
  'search (trigram)': `select ${SELECT} from public.crm_contacts where ${WHERE} and full_name ilike '%Person 5432%' order by created_at desc limit 25`,
  'filtered: unassigned': `select ${SELECT} from public.crm_contacts where ${WHERE} and owner_user_id is null order by created_at desc limit 25`,
}

const BUDGET_MS = 800

console.log(`\nworkspace ${workspaceId} — ${Number(total).toLocaleString()} contacts`)
console.log(`${RUNS} runs per scenario, measured INSIDE the database\n`)

const rows = []
let worst = 0

for (const [name, query] of Object.entries(scenarios)) {
  const times = []
  let buffers = 0
  let plan = ''

  for (let i = 0; i < RUNS; i += 1) {
    const output = sql(`explain (analyze, buffers, costs off, format text) ${query}`)
    const time = Number(/Execution Time: ([\d.]+) ms/.exec(output)?.[1] ?? NaN)
    times.push(time)
    if (i === 0) {
      buffers = Number(/Buffers: shared hit=(\d+)/.exec(output)?.[1] ?? 0)
      plan = /Seq Scan/.test(output) ? 'SEQ SCAN' : 'index'
    }
  }

  times.sort((a, b) => a - b)
  const p95 = times[Math.ceil(0.95 * times.length) - 1]
  worst = Math.max(worst, p95)
  rows.push({ name, p50: times[Math.floor(times.length / 2)], p95, buffers, plan })
}

console.log('scenario                  p50       p95    buffers  plan       §7 <800ms')
console.log('─'.repeat(74))
for (const r of rows) {
  console.log(
    `${r.name.padEnd(24)} ${r.p50.toFixed(1).padStart(6)}ms ${r.p95.toFixed(1).padStart(7)}ms ` +
      `${String(r.buffers).padStart(8)}  ${r.plan.padEnd(9)} ${r.p95 < BUDGET_MS ? 'PASS' : 'FAIL'}`,
  )
}
console.log('─'.repeat(74))
console.log(`worst p95: ${worst.toFixed(1)}ms — §7 budget ${BUDGET_MS}ms`)

/*
 * ⚠️ A SEQ SCAN IS A FAILURE EVEN WHEN THE CLOCK PASSES. At 100k rows a full
 * scan can still come in under budget; at 500k it will not, and the plan is
 * what predicts that. An earlier run of the name sort measured 452 ms and
 * "passed" while scanning every row in the workspace.
 */
const scans = rows.filter((r) => r.plan === 'SEQ SCAN')
if (scans.length > 0) {
  console.log(`\n⚠️  SEQ SCAN in: ${scans.map((r) => r.name).join(', ')}`)
  console.log('   Under budget today, unbounded tomorrow. Treat as a failure.')
}

console.log(
  '\nnote: client round-trip is EXCLUDED. Measured from this machine it is\n' +
    '      p50 ~312ms / p95 ~749ms for a trivial query — larger than the budget\n' +
    '      itself, and nothing to do with the database.\n',
)

process.exit(worst < BUDGET_MS && scans.length === 0 ? 0 : 1)
