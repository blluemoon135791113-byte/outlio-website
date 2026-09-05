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

  /* Promoted out of the ratchet by R4. */
  it('createOpportunity has a caller — otherwise a CRM cannot record a deal', () => {
    const callers = callersOf('createOpportunity', 'lib/crm/opportunities.ts')
    expect(
      callers,
      'createOpportunity has no caller, so nobody can create a deal.',
    ).not.toHaveLength(0)
  })

  /* Promoted out of the ratchet by R1. */
  const R1_ENGINES: { name: string; definedIn: string; without: string }[] = [
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

  for (const engine of R1_ENGINES) {
    it(`${engine.name} has a caller — otherwise ${engine.without}`, () => {
      expect(
        callersOf(engine.name, engine.definedIn),
        `${engine.name} has no caller, so ${engine.without}.`,
      ).not.toHaveLength(0)
    })
  }

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

/**
 * ⚠️ THE RATCHET IS EMPTY, AND THAT IS THE POINT.
 *
 * R0 found six engines built, tested and unreachable. Each was listed here
 * with `it.fails`, asserting the defect still existed — so the suite stayed
 * green while the defect stayed documented, and wiring one made ITS OWN test
 * start failing as the signal to promote it into the enforced block above.
 *
 * All six are now enforced there (R4, R5, R1). The mechanism is left in place
 * with this note rather than deleted: the next engine that ships without a
 * caller belongs here, not in a comment nobody reads.
 */
describe('engines the R0 audit found unreachable', () => {
  it('has none left — all six were promoted into the enforced block', () => {
    // A deliberately trivial assertion. Its job is to keep the explanation
    // above attached to the suite that needed it.
    expect(true).toBe(true)
  })
})

/**
 * ⚠️ A DATABASE FUNCTION CAN BE STRANDED TOO, and the callers-of check above
 * cannot see it: an RPC is invoked as `db.rpc('name', {...})`, a STRING, not a
 * call expression. `email_mailbox_report` was written and tested in M7 and had
 * no caller until R14 — so nobody could see how their mailboxes were
 * performing, which is the number that decides whether outreach works at all.
 */
describe('reporting functions are actually read by something', () => {
  const RPCS: { name: string; without: string }[] = [
    {
      name: 'email_mailbox_report',
      without: 'nobody can see how their mailboxes are performing',
    },
    {
      name: 'email_campaign_report',
      without: 'a campaign reports no results',
    },
  ]

  for (const rpc of RPCS) {
    it(`${rpc.name} is called — otherwise ${rpc.without}`, () => {
      const callers = APP_SOURCES.filter((file) =>
        readFileSync(file, 'utf8').includes(`'${rpc.name}'`),
      )

      expect(
        callers,
        `${rpc.name} is never passed to db.rpc(), so ${rpc.without}.`,
      ).not.toHaveLength(0)
    })
  }

  it('finds nothing for an rpc name that does not exist', () => {
    // Proves the matcher can return empty, so a real regression fails.
    const callers = APP_SOURCES.filter((file) =>
      readFileSync(file, 'utf8').includes(`'no_such_rpc_anywhere'`),
    )
    expect(callers).toHaveLength(0)
  })
})

/**
 * ⚠️ A TRIGGER CAN BE STRANDED TOO, and this is the third distinct shape of the
 * same defect.
 *
 * `startRun` had exactly ONE caller outside the engine — Calendly's
 * `call_booked`. Every other trigger type was declared in the schema, accepted
 * by the validator, offered in the builder and PUBLISHABLE, and nothing ever
 * started a run for it. So a customer could build a flow, publish it, and
 * watch it sit there forever with no error, because nothing had gone wrong —
 * nothing had happened at all.
 */
describe('flow triggers actually fire', () => {
  const WIRED: { trigger: string; without: string }[] = [
    { trigger: 'contact_created', without: 'no flow can react to a new contact' },
    { trigger: 'email_replied', without: 'no flow can react to a reply' },
    { trigger: 'email_bounced', without: 'no flow can clean up after a bounce' },
    { trigger: 'stage_changed', without: 'no flow can react to a deal moving' },
    { trigger: 'opportunity_won', without: 'no flow can react to a win' },
    { trigger: 'task_completed', without: 'no flow can chain off finished work' },
    { trigger: 'call_booked', without: 'no flow can react to a booked meeting' },
    { trigger: 'manual', without: 'a hand-triggered flow can never be started' },
  ]

  for (const { trigger, without } of WIRED) {
    it(`${trigger} is dispatched from somewhere — otherwise ${without}`, () => {
      const callers = APP_SOURCES.filter((file) =>
        readFileSync(file, 'utf8').includes(`triggerType: '${trigger}'`),
      )

      expect(
        callers,
        `nothing dispatches ${trigger}, so ${without}.`,
      ).not.toHaveLength(0)
    })
  }

  it('the dispatcher itself reaches startRun', () => {
    // Every trigger above could dispatch and still never run if the dispatcher
    // were disconnected from the engine.
    const callers = callersOf('startRun', 'lib/flows/engine.ts')
    expect(callers).toContain('lib/flows/dispatch.ts')
  })
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
