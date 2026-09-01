'use client'

import { useActionState, useState } from 'react'

import {
  createPipelineAction,
  type PipelineActionState,
} from '@/app/(product)/crm/pipeline/actions'

type StageDraft = {
  name: string
  kind: 'open' | 'won' | 'lost'
  probability: number
}

/**
 * ⚠️ PREFILLED, NOT IMPOSED. The brief forbids hardcoding one sales
 * methodology, and creating these behind the customer's back would do exactly
 * that. They arrive in an editable form: someone who sells differently rewrites
 * them, someone who does not want to think about it on day one gets a working
 * board.
 */
const SUGGESTED: StageDraft[] = [
  { name: 'New', kind: 'open', probability: 10 },
  { name: 'Contacted', kind: 'open', probability: 25 },
  { name: 'Qualified', kind: 'open', probability: 50 },
  { name: 'Proposal', kind: 'open', probability: 75 },
  { name: 'Won', kind: 'won', probability: 100 },
  { name: 'Lost', kind: 'lost', probability: 0 },
]

export function PipelineSetup({
  isFirstPipeline,
  onCancel,
}: {
  isFirstPipeline: boolean
  onCancel?: () => void
}) {
  const [name, setName] = useState(isFirstPipeline ? 'Sales' : '')
  const [stages, setStages] = useState<StageDraft[]>(SUGGESTED)
  const [state, action, pending] = useActionState<PipelineActionState, FormData>(
    createPipelineAction,
    null,
  )

  const update = (index: number, patch: Partial<StageDraft>) =>
    setStages((current) => current.map((s, i) => (i === index ? { ...s, ...patch } : s)))

  const move = (index: number, delta: number) =>
    setStages((current) => {
      const next = [...current]
      const target = index + delta
      if (target < 0 || target >= next.length) return current
      ;[next[index], next[target]] = [next[target]!, next[index]!]
      return next
    })

  const hasWon = stages.some((s) => s.kind === 'won' && s.name.trim())

  return (
    <form action={action} className="clay space-y-5 p-5">
      <div>
        <h2 className="text-base font-semibold text-ink">
          {isFirstPipeline ? 'Set up your pipeline' : 'New pipeline'}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Stages are the steps a deal moves through. These are a starting point —
          rename them, reorder them, or delete the ones you do not use.
        </p>
      </div>

      <label className="block">
        <span className="text-xs font-medium text-ink">Pipeline name</span>
        <input
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={80}
          placeholder="Sales"
          className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
        />
      </label>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-medium text-ink">Stages</span>
          <span className="text-xs text-muted">Order is the order on the board</span>
        </div>

        <ul className="space-y-2">
          {stages.map((stage, index) => (
            <li key={index} className="flex flex-wrap items-center gap-2">
              {/* Order in the DOM IS the position — no separate index field to
                  drift out of sync with what is on screen. */}
              <input type="hidden" name="stageName" value={stage.name} />
              <input type="hidden" name="stageKind" value={stage.kind} />
              <input type="hidden" name="stageProbability" value={stage.probability} />

              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${stage.name || 'stage'} earlier`}
                  className="px-1 text-xs leading-none text-muted transition-colors duration-150 hover:text-ink disabled:opacity-30"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === stages.length - 1}
                  aria-label={`Move ${stage.name || 'stage'} later`}
                  className="px-1 text-xs leading-none text-muted transition-colors duration-150 hover:text-ink disabled:opacity-30"
                >
                  ▼
                </button>
              </div>

              <input
                value={stage.name}
                onChange={(event) => update(index, { name: event.target.value })}
                aria-label={`Stage ${index + 1} name`}
                maxLength={60}
                className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-line bg-surface px-3 py-1.5 text-sm text-ink"
              />

              <select
                value={stage.kind}
                onChange={(event) =>
                  update(index, { kind: event.target.value as StageDraft['kind'] })
                }
                aria-label={`Stage ${index + 1} type`}
                className="rounded-[var(--radius-md)] border border-line bg-surface px-2 py-1.5 text-xs text-ink [color-scheme:light]"
              >
                <option value="open">Open</option>
                <option value="won">Won</option>
                <option value="lost">Lost</option>
              </select>

              <label className="flex items-center gap-1 text-xs text-muted">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={stage.probability}
                  onChange={(event) =>
                    update(index, { probability: Number(event.target.value) || 0 })
                  }
                  aria-label={`Stage ${index + 1} probability`}
                  className="w-16 rounded-[var(--radius-md)] border border-line bg-surface px-2 py-1.5 text-xs text-ink"
                />
                %
              </label>

              <button
                type="button"
                onClick={() => setStages((c) => c.filter((_, i) => i !== index))}
                disabled={stages.length === 1}
                aria-label={`Remove ${stage.name || 'stage'}`}
                className="rounded-[var(--radius-md)] px-2 py-1 text-xs font-medium text-muted transition-colors duration-150 hover:text-danger disabled:opacity-30"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() =>
            setStages((c) => [...c, { name: '', kind: 'open', probability: 50 }])
          }
          className="rounded-[var(--radius-md)] bg-surface-muted px-3 py-1.5 text-xs font-medium text-ink transition-colors duration-150 hover:opacity-90"
        >
          Add stage
        </button>
      </div>

      {/*
        ⚠️ WARNED BEFORE SAVING, NOT AFTER. A board with no Won stage can never
        record a closed deal, and every revenue report reads from won stages —
        which someone would otherwise discover a quarter later.
      */}
      {!hasWon ? (
        <p className="rounded-[var(--radius-md)] bg-warning-soft px-3 py-2 text-xs text-warning">
          No stage is marked <strong>Won</strong>. Without one, no deal in this pipeline can
          ever be closed and it will not appear in revenue reports.
        </p>
      ) : null}

      <input type="hidden" name="makeDefault" value={isFirstPipeline ? 'true' : 'false'} />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-md)] bg-accent px-4 py-2 text-sm font-semibold text-cream transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Creating…' : 'Create pipeline'}
        </button>

        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium text-muted transition-colors duration-150 hover:text-ink"
          >
            Cancel
          </button>
        ) : null}

        {/* Announced as well as shown. */}
        <p
          role="status"
          aria-live="polite"
          className={`text-xs ${state?.ok ? 'text-success' : 'text-danger'}`}
        >
          {state ? (state.ok ? state.message : state.error) : ''}
        </p>
      </div>
    </form>
  )
}

/** The button that reveals the form, for a workspace that already has one. */
export function NewPipelineButton() {
  const [open, setOpen] = useState(false)

  if (open) return <PipelineSetup isFirstPipeline={false} onCancel={() => setOpen(false)} />

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90"
    >
      New pipeline
    </button>
  )
}
