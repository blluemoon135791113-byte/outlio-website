/**
 * Task execution — the waterfall (spec §12, §49).
 *
 * No I/O of its own: providers do the calling, this decides who is called and
 * when to stop. That keeps the failure semantics unit-testable against stub
 * providers, which is the only way to prove the rule that matters:
 *
 *   ⚠️ **A PROVIDER FAILURE NEVER FAILS THE RUN.** It falls through to the next
 *   provider in the category. When every provider is exhausted the field
 *   becomes `unknown` — never `false`, never a guess — and the remaining tasks
 *   carry on.
 *
 * The second rule: **stop paying once a field is answered.** A task asking for
 * four fields whose first provider answers three continues only for the fourth.
 */
import { validateEvidence } from '@/lib/intelligence/evidence'
import type { ProviderRegistry } from '@/lib/intelligence/registry'
import { sumMicros } from '@/lib/intelligence/costs'
import type {
  IntelligenceProvider,
  NormalizedEvidence,
  ResearchField,
  ResearchTask,
  ToolCallRecord,
} from '@/lib/intelligence/types'
import { mapInConcurrentBatches } from '@/lib/worker/concurrency'

/** A provider that hangs must not hold a research job open indefinitely. */
export const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000

/**
 * Concurrent tasks in flight.
 *
 * Reuses the worker's batch runner, which hard-caps at 8. That cap is a
 * courtesy to third-party rate limits as much as to our own memory — a burst of
 * hundreds of parallel calls is the fastest way to get an API key throttled.
 */
export const DEFAULT_TASK_CONCURRENCY = 4

export type UnknownReason =
  | 'no_provider_configured'
  | 'provider_unavailable'
  | 'not_found'

export type TaskResult = {
  task: ResearchTask
  evidence: NormalizedEvidence[]
  /** Fields no provider could answer, with the reason they stayed unknown. */
  unknownFields: Array<{ field: ResearchField; reason: UnknownReason }>
  attempts: ToolCallRecord[]
}

export type ExecutionReport = {
  results: TaskResult[]
  evidence: NormalizedEvidence[]
  toolCalls: ToolCallRecord[]
  /** Provider invocations actually made. The number that costs money. */
  externalCallCount: number
  estimatedCostMicros: number
  tasksCompleted: number
  tasksPartial: number
  tasksUnresolved: number
}

export type ExecuteOptions = {
  registry: ProviderRegistry
  concurrency?: number
  timeoutMs?: number
  now?: () => Date
}

class ProviderTimeoutError extends Error {}

/** Races a provider against the clock without leaking the timer. */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ProviderTimeoutError('provider timed out')), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Keeps only evidence this task actually asked for.
 *
 * A provider returning a field nobody requested, or evidence about a DIFFERENT
 * entity, is dropped rather than stored. Trusting an adapter to address the
 * right company is how one customer's data ends up attached to another's lead.
 */
function acceptableEvidence(
  task: ResearchTask,
  candidates: readonly NormalizedEvidence[],
): NormalizedEvidence[] {
  const wanted = new Set<string>(task.fields)
  return candidates.filter(
    (item) =>
      wanted.has(item.field) &&
      item.entityId === task.entity.id &&
      item.entityType === task.entity.type,
  )
}

async function runOne(
  task: ResearchTask,
  options: Required<Pick<ExecuteOptions, 'registry' | 'timeoutMs'>>,
): Promise<TaskResult> {
  const providers = options.registry.forTask(task)
  const attempts: ToolCallRecord[] = []
  const collected: NormalizedEvidence[] = []
  const satisfied = new Set<ResearchField>()

  if (providers.length === 0) {
    return {
      task,
      evidence: [],
      unknownFields: task.fields.map((field) => ({
        field,
        reason: 'no_provider_configured' as const,
      })),
      attempts,
    }
  }

  // `not_found` and `error` mean different things to a user: one is an answered
  // question, the other an unanswered one. Track the last outcome so the reason
  // reported is the true one.
  let lastReason: UnknownReason = 'provider_unavailable'

  for (const provider of providers) {
    const outstanding = task.fields.filter((field) => !satisfied.has(field))
    // Every field answered — stop the waterfall. Never keep buying a field
    // that has already been found (spec §12).
    if (outstanding.length === 0) break

    const record = await attempt(provider, { ...task, fields: outstanding }, options.timeoutMs)
    attempts.push(record.call)

    if (record.evidence.length > 0) {
      for (const item of record.evidence) {
        if (satisfied.has(item.field)) continue
        satisfied.add(item.field)
        collected.push(item)
      }
    }

    if (record.call.status === 'not_found') lastReason = 'not_found'
  }

  const unknownFields = task.fields
    .filter((field) => !satisfied.has(field))
    .map((field) => ({ field, reason: lastReason }))

  return { task, evidence: collected, unknownFields, attempts }
}

async function attempt(
  provider: IntelligenceProvider,
  task: ResearchTask,
  timeoutMs: number,
): Promise<{ call: ToolCallRecord; evidence: NormalizedEvidence[] }> {
  const startedAt = Date.now()

  const base = {
    provider: provider.name,
    tool: task.category,
    entityType: task.entity.type,
    entityId: task.entity.id,
    estimatedCostMicros: 0,
  }

  let estimatedCostMicros = 0
  try {
    estimatedCostMicros = await provider.estimateCost(task)
    if (!Number.isFinite(estimatedCostMicros) || estimatedCostMicros < 0) {
      estimatedCostMicros = 0
    }
  } catch {
    // A provider that cannot price itself is still allowed to answer; the run
    // records zero rather than refusing to call it.
    estimatedCostMicros = 0
  }

  try {
    const output = await withTimeout(provider.execute(task), timeoutMs)

    // Provider output is untrusted input, exactly like a request body. It is
    // validated before it can become a stored fact.
    const { valid } = validateEvidence(provider.normalize(output, task))
    const evidence = acceptableEvidence(task, valid)

    return {
      call: {
        ...base,
        estimatedCostMicros,
        status: evidence.length > 0 ? 'success' : 'not_found',
        latencyMs: Date.now() - startedAt,
        errorCode: null,
      },
      evidence,
    }
  } catch (error) {
    const timedOut = error instanceof ProviderTimeoutError
    return {
      call: {
        ...base,
        estimatedCostMicros,
        status: timedOut ? 'timeout' : 'error',
        latencyMs: Date.now() - startedAt,
        // A catalog code, never the provider's own message — those carry URLs,
        // keys, and account identifiers.
        errorCode: timedOut ? 'ERR_TIMEOUT' : 'ERR_PROVIDER_UNAVAILABLE',
      },
      evidence: [],
    }
  }
}

/**
 * Runs every task, isolating failures.
 *
 * Never throws for a provider problem. The report distinguishes tasks that were
 * fully answered, partly answered, and not answered at all, so a run can be
 * honestly reported as `partially_complete` rather than pretending to be
 * complete.
 */
export async function executeTasks(
  tasks: readonly ResearchTask[],
  options: ExecuteOptions,
): Promise<ExecutionReport> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS
  const concurrency = options.concurrency ?? DEFAULT_TASK_CONCURRENCY

  const results = await mapInConcurrentBatches(tasks, concurrency, (task) =>
    runOne(task, { registry: options.registry, timeoutMs }),
  )

  const toolCalls = results.flatMap((result) => result.attempts)
  const evidence = results.flatMap((result) => result.evidence)

  return {
    results,
    evidence,
    toolCalls,
    externalCallCount: toolCalls.length,
    estimatedCostMicros: sumMicros(toolCalls.map((call) => call.estimatedCostMicros)),
    tasksCompleted: results.filter((r) => r.unknownFields.length === 0).length,
    tasksPartial: results.filter(
      (r) => r.unknownFields.length > 0 && r.evidence.length > 0,
    ).length,
    tasksUnresolved: results.filter((r) => r.evidence.length === 0).length,
  }
}
