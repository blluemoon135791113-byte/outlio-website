#!/usr/bin/env node
/**
 * Rehearse a migration against the REAL database, then roll it back.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  WHY THIS EXISTS INSTEAD OF THE DOCKER HARNESS.                          ║
 * ║                                                                          ║
 * ║  `scripts/check-migration.sh` spins up a throwaway Postgres in Docker,   ║
 * ║  replays every prior migration, applies the new one and runs its smoke   ║
 * ║  test. It works, but it needs Docker running — and Docker is not part of ║
 * ║  this product. Nothing in the app, the build or the deployment uses it;  ║
 * ║  it was only ever a rehearsal rig.                                       ║
 * ║                                                                          ║
 * ║  Requiring a container to be up before a migration can be checked meant  ║
 * ║  that when Docker was down, migrations shipped UNCHECKED — and 0095      ║
 * ║  reached staging with a cast error that failed on every call.            ║
 * ║                                                                          ║
 * ║  This does the same job with no Docker: it opens a transaction on the    ║
 * ║  real database, applies the migration, runs the smoke test, reports, and ║
 * ║  ALWAYS rolls back.                                                      ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ IT ROLLS BACK EVEN ON SUCCESS. This never applies anything. The point is
 * to find out whether a migration WOULD work, against the real schema with the
 * real prior migrations already in place — which is strictly better evidence
 * than a rebuilt container, because the container's replay could itself drift.
 *
 * ⚠️ DDL IS TRANSACTIONAL IN POSTGRES. `create table`, `alter table` and
 * `create function` all roll back cleanly, which is what makes this safe. The
 * exceptions are `create index concurrently` and `alter type ... add value`
 * outside a transaction — this refuses to run a file containing either rather
 * than half-applying it.
 *
 *   node scripts/rehearse-migration.mjs supabase/migrations/0099_x.sql \
 *       [supabase/smoke/0099_x.sql]
 */
import { readFileSync } from 'node:fs'
import { Client } from 'pg'

const [, , migrationPath, smokePath] = process.argv

if (!migrationPath) {
  console.error('Usage: node scripts/rehearse-migration.mjs <migration.sql> [smoke.sql]')
  process.exit(2)
}

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '')
}

const connectionString = process.env.SUPABASE_DB_URL
if (!connectionString) {
  console.error(
    'SUPABASE_DB_URL is not set.\n' +
      'Supabase dashboard → Project Settings → Database → Connection string → URI.\n' +
      'Use the SESSION pooler or direct connection; the transaction pooler does not\n' +
      'support the advisory locks this needs.',
  )
  process.exit(2)
}

const sql = readFileSync(migrationPath, 'utf8')

/*
 * ⚠️ REFUSED RATHER THAN HALF-APPLIED. These two cannot run inside a
 * transaction, so a file containing one would either error or — worse — leave
 * part of itself behind after the rollback.
 */
const nonTransactional = [
  [/create\s+index\s+concurrently/i, 'CREATE INDEX CONCURRENTLY'],
  [/alter\s+type\s+\S+\s+add\s+value/i, 'ALTER TYPE ... ADD VALUE'],
]

for (const [pattern, name] of nonTransactional) {
  if (pattern.test(sql)) {
    console.error(
      `This migration uses ${name}, which cannot run inside a transaction.\n` +
        'It cannot be rehearsed this way — apply it by hand and verify after.',
    )
    process.exit(2)
  }
}

const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })
let failed = false

try {
  await client.connect()
  await client.query('begin')

  console.log(`→ applying ${migrationPath}`)
  await client.query(sql)
  console.log('✓ applies cleanly')

  if (smokePath) {
    console.log(`→ running smoke test ${smokePath}`)
    const smoke = readFileSync(smokePath, 'utf8')
      // The smoke files wrap themselves in begin/rollback for the Docker
      // harness. Here the outer transaction already provides that, and a
      // nested `rollback` would end it early.
      .replace(/^\s*\\set[^\n]*$/gm, '')
      .replace(/^\s*begin\s*;\s*$/gim, '')
      .replace(/^\s*rollback\s*;\s*$/gim, '')

    const result = await client.query(smoke)
    const results = Array.isArray(result) ? result : [result]

    for (const r of results) {
      for (const row of r.rows ?? []) {
        const label = row.check ?? Object.values(row)[0]
        const values = Object.entries(row).filter(([k]) => k !== 'check')
        const passed = values.every(([, v]) => v === true || v === null)
        console.log(`  ${values.length === 0 ? ' ' : passed ? 'PASS' : 'FAIL'}  ${label}`)
        if (!passed) {
          failed = true
          console.log(`        ${JSON.stringify(row)}`)
        }
      }
    }
  }
} catch (error) {
  failed = true
  console.error(`✗ ${error.code ?? ''} ${error.message}`)
  if (error.hint) console.error(`  hint: ${error.hint}`)
  if (error.where) console.error(`  where: ${error.where.split('\n')[0]}`)
} finally {
  // ⚠️ ALWAYS. Nothing this script does is ever kept.
  try {
    await client.query('rollback')
    console.log('↩ rolled back — nothing was applied')
  } catch {
    // The connection may already be gone after a fatal error; the transaction
    // dies with it, which is the same outcome.
  }
  await client.end().catch(() => {})
}

process.exit(failed ? 1 : 0)
