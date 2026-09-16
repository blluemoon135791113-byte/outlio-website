/**
 * The copilot proposes, and refuses honestly when it cannot.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE FAILURE THIS FILE IS REALLY ABOUT IS A PLAUSIBLE WRONG ANSWER.    ║
 * ║                                                                           ║
 * ║  A model that returns nonsense is harmless — it does not compile. The      ║
 * ║  dangerous output is one that ALMOST fits: a step reading                  ║
 * ║  `contact.seniority`, an ASSIGN_OWNER with no `userId`, a capability that  ║
 * ║  sounds real. Every one of those would publish and then behave in a way    ║
 * ║  nobody asked for, silently.                                              ║
 * ║                                                                           ║
 * ║  So the assertions here are mostly about what must NOT happen: no silent   ║
 * ║  repair, no partial result, no third attempt, no publish.                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CAPABILITY_REGISTRY_VERSION } from '@/lib/capabilities/registry'

/** Queued model responses; one shift per attempt. */
const responses: unknown[] = []
let calls: { system: string; user: string }[] = []

vi.mock('@/lib/hubble/execute', () => ({
  hubbleExecute: async (
    _capability: string,
    _context: unknown,
    runner: (tools: { llm: unknown }) => Promise<unknown>,
  ) => {
    const llm = {
      vendor: 'gemini',
      model: 'test',
      isConfigured: () => true,
      generateJson: async (request: { system: string; user: string }) => {
        calls.push({ system: request.system, user: request.user })
        const next = responses.shift()
        if (next === undefined) return { ok: false as const, outcome: 'unavailable' }
        return { ok: true as const, json: next, vendor: 'gemini', model: 'test' }
      },
    }
    return { ok: true as const, result: await runner({ llm }) }
  },
}))

const { generateFlowDefinition } = await import('@/lib/flows/copilot')

const ROOT = join(__dirname, '..', '..')
const SOURCE = readFileSync(join(ROOT, 'lib/flows/copilot.ts'), 'utf8')

/**
 * ⚠️ COMMENTS STRIPPED, BECAUSE THIS MODULE EXPLAINS WHAT IT REFUSES TO DO.
 *
 * Its header says it does not write `flow_versions` and that the author
 * publishes through `publishFlow` — so a raw search for those names matches the
 * PROSE and reports a write that no statement performs. That is the sixth time
 * this trap has been hit in this codebase; the fix is always to cut to the code
 * before matching it.
 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n')

function goodFlow(over: Record<string, unknown> = {}) {
  return {
    trigger: { type: 'contact_created' },
    entryStepId: 's1',
    registryVersion: CAPABILITY_REGISTRY_VERSION,
    steps: [{ id: 's1', type: 'ACTION', action: 'ADD_TAG', config: { tag: 'new' }, next: null }],
    ...over,
  }
}

async function run(description = 'Tag every new contact so I can find them later') {
  return generateFlowDefinition({ workspaceId: 'w1', userId: 'u1', description })
}

beforeEach(() => {
  responses.length = 0
  calls = []
})

describe('the snapshot is what the model is given', () => {
  it('names the version, the actions and the fact keys in the prompt', async () => {
    responses.push(goodFlow())
    await run()

    const system = calls[0]!.system
    expect(system).toContain(`Registry version: ${CAPABILITY_REGISTRY_VERSION}`)
    expect(system).toContain('ADD_TAG')
    expect(system).toContain('contact_created')
    expect(system).toContain('is_not_empty')
  })

  it('carries no customer data into the prompt', () => {
    /*
     * ⚠️ `LlmRequest.system` SAYS "NEVER CONTAINS LEAD RECORDS", and this is
     * the one place where the temptation is real: an example would make the
     * prompt clearer. Fact KEYS are schema; fact VALUES are a person's details,
     * and putting one in an example ships it to a third party's logs to
     * illustrate a point.
     */
    expect(CODE).not.toMatch(/crm_contacts|full_name:|\.from\(/)
  })
})

describe('the repair loop is exactly two attempts', () => {
  it('repairs a first answer that does not compile', async () => {
    // Invents a fact key — parses, would publish, evaluates to undefined on
    // every contact. The exact plausible-wrong-answer case.
    responses.push(
      goodFlow({
        entryStepId: 'b1',
        steps: [
          {
            id: 'b1',
            type: 'BRANCH',
            conditions: [{ field: 'contact.seniority', operator: 'is_not_empty' }],
            match: 'all',
            onTrue: 's1',
            onFalse: null,
          },
          { id: 's1', type: 'ACTION', action: 'ADD_TAG', config: { tag: 't' }, next: null },
        ],
      }),
    )
    responses.push(goodFlow())

    const result = await run()
    expect(result.ok).toBe(true)
    expect(result.attempts).toHaveLength(2)
    expect(result.attempts[0]!.problems.join(' ')).toMatch(/contact\.seniority/)
    expect(result.attempts[1]!.problems).toEqual([])
  })

  it('tells the model what was wrong, and to change only that', async () => {
    responses.push(goodFlow({ registryVersion: 1 }))
    responses.push(goodFlow())
    await run()

    expect(calls).toHaveLength(2)
    const repair = calls[1]!.user
    expect(repair).toMatch(/registry version 1/)
    /*
     * ⚠️ WITHOUT THIS INSTRUCTION THE SECOND ATTEMPT BECOMES A DIFFERENT FLOW.
     * A model told only "that was wrong" rewrites from scratch, and the person
     * receives something they never asked for that happens to validate.
     */
    expect(repair).toMatch(/Change only what is needed/)
    expect(repair).toMatch(/ORIGINAL REQUEST/)
  })

  it('stops at two and does not keep paying', async () => {
    responses.push(goodFlow({ registryVersion: 1 }))
    responses.push(goodFlow({ registryVersion: 1 }))
    responses.push(goodFlow()) // a third answer that would have worked

    const result = await run()
    expect(result.ok).toBe(false)
    expect(calls, 'a third attempt was made').toHaveLength(2)
    expect(responses, 'the third queued answer should never be reached').toHaveLength(1)
  })
})

describe('a failure is a refusal, never a partial flow', () => {
  it('returns no definition when both attempts fail', async () => {
    responses.push(goodFlow({ registryVersion: 1 }))
    responses.push(goodFlow({ registryVersion: 1 }))

    const result = await run()
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('unusable')
    expect(result).not.toHaveProperty('definition')
    // The refusal says what was actually wrong rather than a generic apology.
    expect(result.message).toMatch(/registry version/)
  })

  it('does not silently correct a near-miss', () => {
    /*
     * §5.10: outside the snapshot is "a validation failure, not a repair
     * opportunity". The tempting code is a lookup that maps ADD_TAGS→ADD_TAG
     * or is_blank→is_empty. Each is a guess about intent made for someone who
     * is not present, and it turns a loud failure into a flow that runs and
     * does something subtly different.
     */
    expect(CODE).not.toMatch(/ADD_TAGS|is_blank|closestMatch|didYouMean|levenshtein/i)
  })

  it('a vendor outage is not spent as a repair attempt', async () => {
    // No queued response → the fake provider reports unavailable.
    const result = await run()
    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(1)
    if (result.ok) throw new Error('unreachable')
    expect(result.attempts[0]!.problems.join(' ')).toMatch(/unavailable/)
  })
})

describe('it proposes; it does not publish', () => {
  it('writes nothing', () => {
    /*
     * ⚠️ THE WHOLE SAFETY ARGUMENT. The author reviews what came back in the
     * builder and publishes through `publishFlow`, which stamps send authority
     * and runs `publishProblems`. Generating straight into a published flow
     * routes a machine's output around the one gate a human stands at.
     */
    expect(CODE).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|createAdminClient/)
    expect(CODE).not.toMatch(/publishFlow|flow_versions/)
  })

  it('cannot become a flow step', () => {
    /*
     * `flows.copilot` has no `flowAction`, so `capabilityForFlowAction` cannot
     * resolve to it and the builder cannot offer it. A flow that generates and
     * publishes flows would write flows unattended, and 0093's loop protection
     * counts RUNS, not authored definitions.
     */
    const registry = readFileSync(join(ROOT, 'lib/capabilities/registry.ts'), 'utf8')
    const entry = registry.slice(registry.indexOf("'flows.copilot':"))
    const line = entry.slice(0, entry.indexOf('\n'))
    expect(line).not.toMatch(/flowAction/)
    expect(line).toMatch(/credits: 0/)
    expect(line, 'the copilot is gated on hubble.use rather than flow.manage').toMatch(
      /permission: 'flow\.manage'/,
    )
  })

  it('enters through the metered door and never a provider directly', () => {
    // `model-call-boundary.test.ts` polices this globally; named here so the
    // reason travels with the module that has to obey it.
    expect(CODE).toMatch(/hubbleExecute\(\s*\n?\s*'flows\.copilot'/)
    expect(CODE).not.toMatch(/resolveLlmProvider|createGeminiProvider/)
  })
})

describe('the eval cannot masquerade as a customer', () => {
  it('defaults to the customer source when nobody says otherwise', async () => {
    /*
     * ⚠️ THE DEFAULT IS THE SAFE DIRECTION. A caller that forgets to tag itself
     * is counted as real usage, which over-counts spend. The opposite default
     * would silently drop real drafts out of the ledger the price is chosen
     * from, and nobody would notice the number was low.
     */
    expect(CODE).toMatch(/source: input\.source \?\? 'http:flow-copilot'/)
  })

  it('the eval tags itself so its rows can be excluded', () => {
    /*
     * Forty cases write 40-80 metering rows in a few minutes. `flows.copilot`
     * is priced at 0 precisely so `hubble_calls` fills with REAL usage before
     * anyone picks a number — "a price picked over an empty ledger is a guess".
     * Untagged, the evidence under that decision would be mostly this test.
     */
    const evalSource = readFileSync(join(ROOT, 'tests/eval/flow-copilot.eval.ts'), 'utf8')
    expect(evalSource).toMatch(/source: 'eval:flow-copilot'/)
    // A prefix, so any future harness is excluded by the same `like 'eval:%'`.
    expect(evalSource).toMatch(/source: 'eval:/)
  })
})
