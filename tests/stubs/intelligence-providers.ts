/**
 * Fixture-backed providers for tests.
 *
 * These implement the REAL `IntelligenceProvider` contract against local data,
 * so routing, waterfall, and failure semantics are exercised end to end without
 * a network call or an API key.
 *
 * ⚠️ Deliberately in `tests/`, never in `lib/`. Shipped code contains no fake
 * implementations (CLAUDE.md rule 7). Real adapters arrive in Phase 3 and
 * implement this same interface.
 */
import { expiresAtFor } from '@/lib/intelligence/ttl'
import type {
  IntelligenceProvider,
  NormalizedEvidence,
  ResearchField,
  ResearchTask,
  SourceConfidence,
  ToolCategory,
} from '@/lib/intelligence/types'

export type StubBehaviour =
  | { kind: 'answers'; fields: readonly ResearchField[] }
  | { kind: 'not_found' }
  | { kind: 'error'; message?: string }
  | { kind: 'hang' }
  /** Returns evidence about a DIFFERENT entity — must be discarded. */
  | { kind: 'wrong_entity' }
  /** Returns structurally invalid evidence — must be rejected, never stored. */
  | { kind: 'malformed' }
  /**
   * Answers the question AND returns unrequested facts about the person's
   * employer — the Prospeo shape, where one paid call carries a windfall.
   */
  | { kind: 'windfall'; fields: readonly ResearchField[]; companyId: string }

export type StubOptions = {
  name: string
  category: ToolCategory
  behaviour: StubBehaviour
  costMicros?: number
  sourceConfidence?: SourceConfidence
  /** Bumped on every `execute`, so a test can prove a provider was skipped. */
  counter?: { calls: number }
}

const OTHER_ENTITY = '99999999-9999-4999-8999-999999999999'

export function stubProvider(options: StubOptions): IntelligenceProvider<unknown> {
  const confidence = options.sourceConfidence ?? 'high'

  return {
    name: options.name,
    category: options.category,

    canHandle: (task) => task.category === options.category,

    estimateCost: async () => options.costMicros ?? 1_000,

    execute: async (task: ResearchTask) => {
      if (options.counter) options.counter.calls += 1

      switch (options.behaviour.kind) {
        case 'error':
          throw new Error(options.behaviour.message ?? 'provider exploded')
        case 'hang':
          // Never settles. The executor's timeout is the only way out.
          return new Promise(() => {})
        default:
          return task
      }
    },

    normalize: (_output, task): NormalizedEvidence[] => {
      const retrievedAt = new Date()

      const build = (field: ResearchField, entityId: string): NormalizedEvidence => ({
        field,
        entityType: task.entity.type,
        entityId,
        value: { value: `${options.name}:${field}` },
        sourceProvider: options.name,
        sourceUrl: 'https://example.com/source',
        sourceConfidence: confidence,
        confidence: 0.9,
        retrievedAt: retrievedAt.toISOString(),
        expiresAt: expiresAtFor(field, retrievedAt)?.toISOString() ?? null,
      })

      switch (options.behaviour.kind) {
        case 'answers': {
          // Only the fields this provider claims to cover AND that the task
          // still wants — mirrors a real adapter answering part of a request.
          const wanted = new Set<string>(task.fields)
          return options.behaviour.fields
            .filter((field) => wanted.has(field))
            .map((field) => build(field, task.entity.id))
        }
        case 'windfall': {
          const wanted = new Set<string>(task.fields)
          const answered = options.behaviour.fields
            .filter((field) => wanted.has(field))
            .map((field) => build(field, task.entity.id))

          const extra: NormalizedEvidence = {
            ...build('industry', options.behaviour.companyId),
            entityType: 'company',
          }

          return [...answered, extra]
        }
        case 'wrong_entity':
          return task.fields.map((field) => build(field, OTHER_ENTITY))
        case 'malformed':
          return [
            { ...build(task.fields[0]!, task.entity.id), confidence: 42 },
          ] as unknown as NormalizedEvidence[]
        default:
          return []
      }
    },
  }
}
