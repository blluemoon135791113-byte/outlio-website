/**
 * Wiring guards — R10.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE CLASS OF BUG THESE EXIST TO CATCH.                                  ║
 * ║                                                                           ║
 * ║  Every background worker in this product was written, covered by passing  ║
 * ║  integration tests, and NEVER INVOKED. A launched campaign sent nothing.  ║
 * ║  Replies were never fetched. Webhooks never delivered. Flows that hit a   ║
 * ║  WAIT never resumed.                                                      ║
 * ║                                                                           ║
 * ║  Nothing caught it, and nothing could have: unit tests, typecheck and     ║
 * ║  `next build` all pass whether or not anything calls the code. Coverage   ║
 * ║  was strong at the ENGINE layer and absent at the WIRING layer.           ║
 * ║                                                                           ║
 * ║  ⚠️ THESE ARE STRUCTURAL TESTS. They read the source, not behaviour, and  ║
 * ║  that is the point — the defect they catch is the absence of a call.      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Every .ts/.tsx file under a directory, recursively. */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      out.push(...sourceFiles(path))
    } else if (/\.tsx?$/.test(path)) {
      out.push(path)
    }
  }
  return out
}

const APP_SOURCES = [...sourceFiles('app'), ...sourceFiles('lib')]

/** Files that call `name`, excluding the file that defines it. */
function callersOf(name: string, definedIn: string): string[] {
  const callPattern = new RegExp(`\\b${name}\\s*\\(`)
  return APP_SOURCES.filter((file) => {
    if (file === definedIn) return false
    return callPattern.test(readFileSync(file, 'utf8'))
  })
}

describe('every background worker has a trigger', () => {
  /**
   * ⚠️ A WORKER WITH NO CALLER IS DEAD CODE THAT LOOKS ALIVE. Each of these
   * had zero callers before R10 and each failure below was a real, shipped
   * defect — not a hypothetical.
   */
  const WORKERS: { name: string; definedIn: string; breaks: string }[] = [
    {
      name: 'runSendWorker',
      definedIn: 'lib/email/send.ts',
      breaks: 'a launched campaign never sends a single email',
    },
    {
      name: 'reapExpiredClaims',
      definedIn: 'lib/email/send.ts',
      breaks: 'a crashed worker leaves messages claimed forever',
    },
    {
      name: 'syncWorkspaceReplies',
      definedIn: 'lib/email/reply-sync.ts',
      breaks: 'stop-on-reply never fires and the inbox stays empty',
    },
    {
      name: 'deliverPendingWebhooks',
      definedIn: 'lib/api/webhooks.ts',
      breaks: 'outbound webhooks are queued and never delivered',
    },
    {
      name: 'claimWaitingRuns',
      definedIn: 'lib/flows/engine.ts',
      breaks: 'a flow that hits a WAIT step never resumes',
    },
  ]

  for (const worker of WORKERS) {
    it(`${worker.name} is called from somewhere — otherwise ${worker.breaks}`, () => {
      const callers = callersOf(worker.name, worker.definedIn)

      expect(
        callers,
        `${worker.name} has no caller outside ${worker.definedIn}, so ${worker.breaks}.`,
      ).not.toHaveLength(0)
    })
  }

  /*
   * ⚠️ PROMOTED OUT OF THE RATCHET BY R5, which is exactly how the ratchet is
   * meant to end: `createPipeline` got a caller, the `it.fails` below started
   * failing, and the fix was to move the line up here where it is enforced
   * from now on.
   */
  it('createPipeline has a caller — otherwise the board is permanently empty', () => {
    const callers = callersOf('createPipeline', 'lib/crm/opportunities.ts')
    expect(
      callers,
      'createPipeline has no caller, so nobody can create a pipeline.',
    ).not.toHaveLength(0)
  })

  it('the tick is reachable from a route, not just defined', () => {
    /*
     * The workers above could all be called by `runTick` and still never run
     * if nothing calls `runTick`. This is the end of that chain.
     */
    const callers = callersOf('runTick', 'lib/workers/tick.ts')
    expect(callers.some((f) => f.includes('app/api'))).toBe(true)
  })

  it('a cron schedule actually exists', () => {
    // A route with no schedule is the same defect one level up.
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      crons?: { path: string; schedule: string }[]
    }

    expect(vercel.crons ?? []).not.toHaveLength(0)
    expect(vercel.crons!.some((c) => c.path === '/api/cron')).toBe(true)
  })

  it('the REAL scheduler exists, because Vercel Hobby allows one run per day', () => {
    /*
     * ⚠️ THE vercel.json ENTRY ABOVE IS A FLOOR, NOT THE SCHEDULE. On the
     * Hobby plan it can only fire once a day, which for a paced email sender
     * means a campaign takes weeks and a reply is noticed tomorrow. The
     * GitHub Action drives the real 5-minute cadence, so its absence is the
     * same "nothing runs" defect wearing a different hat.
     */
    const workflow = readFileSync('.github/workflows/cron.yml', 'utf8')

    expect(workflow).toContain('/api/cron')
    expect(workflow).toContain('cron:')
    // The secret must travel in a header; a URL is logged by proxies and by
    // GitHub itself.
    expect(workflow).toContain('Authorization: Bearer')
    expect(workflow).not.toMatch(/api\/cron\?[^"']*secret/i)
  })
})

describe('engines the R0 audit found unreachable', () => {
  /**
   * ⚠️ THESE USE `it.fails`, WHICH IS A RATCHET, NOT A SKIP.
   *
   * All six engines below are built, tested and STILL UNREACHABLE as of R10 —
   * wiring them is R1/R4/R5 work. Two wrong ways to handle that: leave the
   * suite red, which trains everyone to ignore red; or skip them, which
   * deletes the signal entirely.
   *
   * `it.fails` asserts the defect still exists. The suite stays green AND the
   * defect stays documented — and the moment someone wires one of these up,
   * THIS TEST STARTS FAILING and tells them to move the line down to the
   * block above. A guard that fixes itself when the bug is fixed.
   *
   * A caller anywhere in `app/` or `lib/` counts: this asserts the code is
   * WIRED, not that a particular button exists.
   */
  const ENGINES: { name: string; definedIn: string; without: string }[] = [
    {
      name: 'createOpportunity',
      definedIn: 'lib/crm/opportunities.ts',
      without: 'nobody can create a deal, which is the point of a CRM',
    },
    {
      name: 'ingestExtractionJob',
      definedIn: 'lib/crm/ingest.ts',
      without: 'extracted leads can never reach the CRM',
    },
    {
      name: 'runCsvImport',
      definedIn: 'lib/crm/ingest.ts',
      without: 'a customer arriving with a contact list has no way in',
    },
    {
      name: 'buildImportPlan',
      definedIn: 'lib/crm/csv-import.ts',
      without: 'an import can never be previewed before it commits',
    },
    {
      name: 'undoBatch',
      definedIn: 'lib/crm/ingest.ts',
      without: 'a bad import cannot be rolled back',
    },
  ]

  for (const engine of ENGINES) {
    it.fails(`STILL UNREACHABLE — ${engine.name}: ${engine.without}`, () => {
      const callers = callersOf(engine.name, engine.definedIn)

      expect(
        callers,
        `${engine.name} has no caller outside ${engine.definedIn}, so ${engine.without}.`,
      ).not.toHaveLength(0)
    })
  }
})

describe('the guard itself is not vacuous', () => {
  it('finds source files to search', () => {
    // If the walk returned nothing, every assertion above would pass while
    // proving nothing — the same trap the proxy test fell into.
    expect(APP_SOURCES.length).toBeGreaterThan(100)
    expect(APP_SOURCES).toContain('lib/email/send.ts')
  })

  it('reports no caller for a name that does not exist', () => {
    // Proves the matcher can actually return empty, so a real regression
    // would fail rather than silently matching something.
    expect(callersOf('thisFunctionDoesNotExistAnywhere', 'lib/email/send.ts')).toHaveLength(0)
  })
})
