#!/usr/bin/env node
/**
 * Fills `companies.domain` for companies that have none.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ WRITES TO PRODUCTION. `--limit` IS THE SAFETY RAIL.                  ║
 * ║                                                                          ║
 * ║  Run a small limit first and read the hit rate before running the rest.  ║
 * ║  `--dry` verifies without writing anything.                              ║
 * ║                                                                          ║
 * ║  Every write is guarded on `domain is null`, so this only ever FILLS a   ║
 * ║  gap. A domain established by any other means is never overwritten by a  ║
 * ║  probe, however confident.                                               ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 *   node --env-file=.env.local scripts/backfill-domains.mjs --limit 25 --dry
 *   node --env-file=.env.local scripts/backfill-domains.mjs --limit 200
 */
import { createClient } from '@supabase/supabase-js'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const LIMIT = Number.parseInt(flag('limit', '25'), 10)
const DRY = args.includes('--dry')
/** Politeness. These are real websites belonging to real companies. */
const CONCURRENCY = Number.parseInt(flag('concurrency', '4'), 10)

const { probeCompanyDomain } = await import('../.probe-bundle.mjs').catch(() => {
  console.error('Build the probe bundle first — see the npm script.')
  process.exit(1)
})

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

const { count: total } = await supabase
  .from('companies')
  .select('id', { count: 'exact', head: true })
  .is('domain', null)

console.log(`\n${total} companies without a domain. Probing ${Math.min(LIMIT, total)}${DRY ? ' (DRY RUN)' : ''}.\n`)

const { data: companies } = await supabase
  .from('companies')
  .select('id, user_id, name')
  .is('domain', null)
  .not('name', 'is', null)
  .limit(LIMIT)

let found = 0
let written = 0
let cursor = 0

async function worker() {
  for (;;) {
    const company = companies[cursor++]
    if (!company) return

    let result = null
    try {
      result = await probeCompanyDomain(company.name)
    } catch {
      // A probe that throws is a probe that found nothing. Never fatal.
    }

    if (!result) {
      console.log(`  ·  ${String(company.name).slice(0, 40).padEnd(42)} —`)
      continue
    }

    found += 1

    if (DRY) {
      console.log(`  ✓  ${String(company.name).slice(0, 40).padEnd(42)} ${result.domain}  (dry)`)
      continue
    }

    /*
     * ⚠️ `.is('domain', null)` is the whole safety story. Another process may
     * have resolved this company concurrently; the first answer wins and a
     * probe never overwrites it.
     */
    const { data } = await supabase
      .from('companies')
      .update({ domain: result.domain })
      .eq('user_id', company.user_id)
      .eq('id', company.id)
      .is('domain', null)
      .select('id')

    if (data?.length) written += 1
    console.log(`  ✓  ${String(company.name).slice(0, 40).padEnd(42)} ${result.domain}`)
  }
}

const started = Date.now()
await Promise.all(Array.from({ length: CONCURRENCY }, worker))

const attempted = companies?.length ?? 0
console.log(`\n──── RESULT ────`)
console.log(`  attempted        ${attempted}`)
console.log(`  verified domain  ${found}   (${attempted ? Math.round((found / attempted) * 100) : 0}%)`)
if (!DRY) console.log(`  written          ${written}`)
console.log(`  elapsed          ${((Date.now() - started) / 1000).toFixed(1)}s`)
console.log(`\n  Remaining without a domain: ${total - written}\n`)
