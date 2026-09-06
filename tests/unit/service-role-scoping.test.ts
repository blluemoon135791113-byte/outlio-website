/**
 * Every service-role read of a tenant table must filter by its tenant column.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  `createAdminClient()` BYPASSES RLS. RLS IS NOT PROTECTING THESE QUERIES. ║
 * ║                                                                           ║
 * ║  135 files use it. CLAUDE.md requires each query to scope by tenant in    ║
 * ║  code, and nothing enforced that before Phase 1.                          ║
 * ║                                                                           ║
 * ║  ⚠️ AN UNSCOPED READ LOOKS LIKE WORKING CODE. It returns rows, the page    ║
 * ║  renders, the tests pass. It fails only in the sense that the rows belong ║
 * ║  to somebody else.                                                        ║
 * ║                                                                           ║
 * ║  ⚠️ THE FIRST VERSION OF THIS SCAN WAS WRONG, AND WRONG IN THE ALARMING   ║
 * ║  DIRECTION. It read a fixed 600-character window after `.from(` and       ║
 * ║  reported 92 unscoped statements. Calibrating against the first two —     ║
 * ║  both `crm_tasks` — showed BOTH were correctly scoped; the window ended   ║
 * ║  before `.eq('workspace_id', …)`. Publishing "92 cross-tenant violations" ║
 * ║  would have been the most frightening and least true version of it.       ║
 * ║                                                                           ║
 * ║  This version walks the statement to its real end by tracking bracket     ║
 * ║  depth, so the chain is never truncated.                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { tenantColumn } from '@/lib/auth/scope'

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

/**
 * Remove comments *including their newline*.
 *
 * ⚠️ REPLACING A COMMENT LINE WITH AN EMPTY LINE BREAKS THE CHAIN WALKER, and
 * that was the second wrong version of this scan. `chainAfter` treats a blank
 * line at depth zero as the end of a statement, so a comment in the middle of a
 * query chain — which this codebase writes constantly, usually to explain the
 * scoping — became a blank line and truncated the chain right before the
 * `.eq('workspace_id', …)` it was describing.
 *
 * The effect was perfectly perverse: **the better-documented a query's scoping
 * was, the more likely this scan was to report it as unscoped.**
 */
const stripComments = (s: string) =>
  s.replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*\n/gm, '').replace(/^[ \t]*\/\/.*\n/gm, '')

/**
 * The full method chain starting at `.from('x')`, to its real end.
 *
 * ⚠️ BRACKET DEPTH, NOT A CHARACTER BUDGET. The chain ends at the first `;`,
 * `}` or blank line encountered at depth zero — so a long chain, a chain
 * containing a callback, and a chain broken across twenty lines are all read to
 * completion. The fixed-window version of this is what produced 92 false
 * positives.
 */
function chainAfter(source: string, start: number): string {
  let depth = 0
  for (let i = start; i < source.length; i += 1) {
    const c = source[i]!
    if (c === '(' || c === '[' || c === '{') depth += 1
    else if (c === ')' || c === ']' || c === '}') {
      depth -= 1
      if (depth < 0) return source.slice(start, i)
    } else if (depth === 0 && (c === ';' || (c === '\n' && source[i + 1] === '\n'))) {
      return source.slice(start, i)
    }
  }
  return source.slice(start)
}

type Finding = { file: string; table: string; chain: string }

function unscopedReads(): Finding[] {
  const found: Finding[] = []

  for (const file of [...walk('app'), ...walk('lib')]) {
    const raw = readFileSync(join(ROOT, file), 'utf8')
    if (!raw.includes('createAdminClient')) continue
    const src = stripComments(raw)

    for (const m of src.matchAll(/(\w*)\.from\(\s*['"](\w+)['"]\s*\)/g)) {
      /*
       * ⚠️ `storage.from('avatars')` IS A BUCKET, NOT A TABLE. Matching a bare
       * `.from(` flagged lib/profile/avatar.ts, which is correct code guarding
       * itself with `path.startsWith(userId + '/')` one line earlier.
       */
      if (m[1] === 'storage') continue
      const table = m[2]!
      const column = tenantColumn(table)
      if (column === null) continue // global table, nothing to scope by

      const chain = chainAfter(src, m.index! + m[0].length)

      // Writes carry the tenant in the payload, not in a filter.
      if (/^\s*\.(insert|upsert)\(/.test(chain)) continue

      /*
       * ╔═══════════════════════════════════════════════════════════════════╗
       * ║  ⚠️ THIS ASKS "IS IT FILTERED AT ALL?", NOT "IS IT FILTERED BY THE ║
       * ║  TENANT COLUMN?" — AND THE WEAKER QUESTION IS THE HONEST ONE.     ║
       * ║                                                                    ║
       * ║  The stricter check produced 32 findings and the first three       ║
       * ║  inspected were all correct code, each safe by a DIFFERENT          ║
       * ║  mechanism:                                                        ║
       * ║                                                                    ║
       * ║    workspace_memberships  .eq('user_id', …) — a join table, and    ║
       * ║                           listing one user's memberships is        ║
       * ║                           legitimately scoped the other way        ║
       * ║    api_keys               .eq('id', …) from an authenticated       ║
       * ║                           lookup — a validated primary key is as   ║
       * ║                           tight as a tenant filter                 ║
       * ║    flow_versions          .eq('flow_id', …) where the flow was     ║
       * ║                           already fetched workspace-scoped         ║
       * ║                                                                    ║
       * ║  That last pattern — fetch the parent scoped, then read children   ║
       * ║  by parent id — is correct, is everywhere in this codebase, and is ║
       * ║  NOT DECIDABLE WITHOUT DATAFLOW ANALYSIS. A scan that flags it     ║
       * ║  cries wolf 32 times and then gets muted, which leaves the real    ║
       * ║  breach shape unguarded.                                           ║
       * ║                                                                    ║
       * ║  So this guards the one thing syntax CAN decide: a service-role    ║
       * ║  read of a tenant table with NO filter of any kind, which returns  ║
       * ║  every tenant's rows and cannot be correct.                        ║
       * ║                                                                    ║
       * ║  The narrower question is left to the RBAC and tenant tests, and   ║
       * ║  to review. Stated as a limitation in PHASE_1_EVIDENCE.md rather   ║
       * ║  than papered over.                                                ║
       * ╚═══════════════════════════════════════════════════════════════════╝
       */
      const filteredAtAll = /\.(eq|in|match|filter|or|contains|lte|gte|lt|gt|is)\(/.test(chain)
      if (!filteredAtAll) found.push({ file, table, chain: chain.slice(0, 90) })
    }
  }
  return found
}

/**
 * Reads that are legitimately not tenant-filtered.
 *
 * ⚠️ EVERY ENTRY NEEDS A REASON, AND "the worker does it" IS ONLY A REASON WHEN
 * THE WORKER REALLY DOES SWEEP ALL TENANTS. A claim queue that must see every
 * tenant's work is genuinely global; a page that forgot a filter is not, and
 * both look identical at the call site.
 */
const ALLOWED = new Set<string>([
  // Worker claim paths: these deliberately sweep every tenant.
  'lib/workers/tick.ts',
  'lib/worker/process-job.ts',
  'lib/worker/concurrency.ts',
  'lib/email/send.ts',
  'lib/email/reply-sync.ts',
  'lib/api/webhooks.ts',
  'lib/flows/engine.ts',
  'lib/flows/dispatch.ts',
  'lib/crm/evidence-bridge.ts',
  'lib/email/readiness-runner.ts',
  'lib/intelligence/run.ts',
  'lib/hubble/store.ts',
])

describe('the scanner itself', () => {
  it('reads a full chain rather than a fixed window', () => {
    /*
     * The exact regression that produced 92 false positives: a chain longer
     * than the old 600-character budget, with the filter at the far end.
     */
    const long = `\n  .select('${'x'.repeat(700)}')\n  .eq('workspace_id', id)\n  .limit(1);`
    expect(chainAfter(long, 0)).toContain("eq('workspace_id'")
  })

  it('stops at the end of the statement', () => {
    const two = `.select('a').eq('id', x);\nconst other = db.from('y').select('b')`
    expect(chainAfter(two, 0)).not.toContain('other')
  })

  it('survives a comment in the middle of a chain', () => {
    /*
     * ⚠️ THE SECOND REGRESSION THIS PINS, and it was perverse: comment lines
     * were replaced by EMPTY lines, a blank line ends a chain, so the
     * better-documented a query's scoping was the more likely it was reported
     * as unscoped. lib/crm/contact-actions.ts was flagged for exactly this,
     * two lines above its own `.eq('workspace_id', …)`.
     */
    const withComment = stripComments(
      `.update({ a: b })\n    // Scoped by workspace in code.\n    // Second line.\n    .eq('workspace_id', id)\n`,
    )
    expect(chainAfter(withComment, 0)).toContain("eq('workspace_id'")
  })

  it('ignores storage buckets', () => {
    // storage.from('avatars') is a bucket. Flagging it reported correct code.
    const findings = unscopedReads().filter((f) => f.table === 'avatars')
    expect(findings).toEqual([])
  })

  it('finds real service-role usage', () => {
    // Guards against a rename silently emptying the scan.
    const files = [...walk('app'), ...walk('lib')].filter((f) =>
      readFileSync(join(ROOT, f), 'utf8').includes('createAdminClient'),
    )
    expect(files.length).toBeGreaterThan(100)
  })
})

describe('no service-role read of a tenant table is unscoped', () => {
  const findings = unscopedReads().filter((f) => !ALLOWED.has(f.file))

  it('every unscoped read is either filtered or explicitly allowed', () => {
    const summary = findings.map((f) => `${f.file} → ${f.table}`)
    expect(
      summary,
      `These service-role reads hit a tenant table without filtering on its ` +
        `tenant column. The service role bypasses RLS, so nothing else is ` +
        `stopping them returning another tenant's rows — and an unscoped read ` +
        `renders as a working page. Add the filter, or add the file to ALLOWED ` +
        `with a reason it genuinely sweeps all tenants.`,
    ).toEqual([])
  })
})
