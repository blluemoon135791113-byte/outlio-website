'use client'

import { useActionState, useState } from 'react'

import { pauseFlow, publishFlow, type ActionState } from '@/app/(product)/flows/actions'

/**
 * Editing and publishing a flow definition.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  A JSON EDITOR, DELIBERATELY, UNTIL THE VISUAL BUILDER EXISTS.            ║
 * ║                                                                           ║
 * ║  The brief gates the visual builder on "only after runtime is proven",    ║
 * ║  and a half-built canvas that cannot express what the engine supports is  ║
 * ║  worse than an honest text field: people would build flows the runtime    ║
 * ║  rejects and blame the runtime. This edits the real definition, validates ║
 * ║  it with the same function the server uses, and reports every problem at  ║
 * ║  once.                                                                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ PUBLISHING NEVER EDITS THE LIVE VERSION. It creates a new immutable one,
 * so runs already in flight finish on the definition they started with.
 */
export function FlowEditor({
  flowId,
  status,
  definition,
}: {
  flowId: string
  status: string
  definition: string
}) {
  const [publishState, publish, publishing] = useActionState<ActionState, FormData>(
    publishFlow,
    null,
  )
  const [pauseState, pause, pausing] = useActionState<ActionState, FormData>(pauseFlow, null)
  const [open, setOpen] = useState(false)

  const state = publishState ?? pauseState

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-xs font-semibold text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-ink"
        >
          {open ? 'Hide definition' : 'Edit definition'}
        </button>

        <form action={pause}>
          <input type="hidden" name="flowId" value={flowId} />
          <input type="hidden" name="next" value={status === 'published' ? 'paused' : 'published'} />
          <button
            type="submit"
            disabled={pausing}
            className="rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-xs font-semibold text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-ink disabled:opacity-60"
          >
            {status === 'published' ? 'Pause' : 'Resume'}
          </button>
        </form>
      </div>

      {open ? (
        <form action={publish} className="clay space-y-3 p-4">
          <input type="hidden" name="flowId" value={flowId} />
          <label htmlFor="definition" className="block text-xs font-semibold text-ink">
            Definition
          </label>
          <textarea
            id="definition"
            name="definition"
            defaultValue={definition}
            rows={18}
            spellCheck={false}
            className="w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-ink outline-none transition-colors duration-150 focus-visible:border-accent"
          />
          <p className="text-xs leading-relaxed text-muted">
            Checked before it is saved: every step must be reachable, every target must exist, and
            any loop must contain a wait — otherwise a run would spin forever.
          </p>

          {state && !state.ok ? (
            <p role="alert" className="rounded-[var(--radius-md)] bg-danger-soft px-3 py-2 text-xs leading-relaxed text-danger">
              {state.error}
            </p>
          ) : null}
          {state?.ok ? (
            <p role="status" aria-live="polite" className="rounded-[var(--radius-md)] bg-success-soft px-3 py-2 text-xs text-success">
              {state.message}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={publishing}
            className="rounded-[var(--radius-md)] bg-accent px-4 py-2 text-sm font-semibold text-cream transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
          >
            {publishing ? 'Publishing…' : 'Publish new version'}
          </button>
        </form>
      ) : null}
    </div>
  )
}
