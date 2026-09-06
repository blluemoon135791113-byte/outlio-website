'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useState } from 'react'

import {
  archivePipelineAction,
  renamePipelineAction,
  setDefaultPipelineAction,
  type PipelineActionState,
} from '@/app/(product)/crm/pipeline/actions'

export type ManagedPipeline = {
  id: string
  name: string
  isDefault: boolean
  stageCount: number
}

/**
 * Switching between pipelines, renaming one, choosing the default, archiving.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THESE ACTIONS WERE WRITTEN, GATED, AND CALLED BY NOTHING.                ║
 * ║                                                                           ║
 * ║  `renamePipelineAction`, `archivePipelineAction` and                      ║
 * ║  `setDefaultPipelineAction` all existed and all enforced                  ║
 * ║  `crm.pipeline.manage`, and the board offered no way to reach any of them ║
 * ║  — so a workspace was stuck with whatever pipeline it first created, under║
 * ║  whatever name it first used. `listPipelines` was written for a picker    ║
 * ║  that did not exist either.                                               ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ RENDERED ONLY FOR SOMEONE WHO HOLDS `crm.pipeline.manage`, decided by the
 * page. That is presentation, not authorization — every action re-asserts the
 * permission server-side, because a hidden button is not a gate.
 */
export function PipelineManager({
  pipelines,
  currentId,
}: {
  pipelines: ManagedPipeline[]
  currentId: string
}) {
  const [open, setOpen] = useState(false)
  const current = pipelines.find((p) => p.id === currentId)

  // Nothing to manage before a pipeline exists; `PipelineSetup` owns that case.
  if (!current) return null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className="rounded-[var(--radius-md)] border border-border-strong bg-panel px-3 py-1.5 text-xs font-semibold text-ink transition-colors duration-150 hover:bg-surface-muted"
      >
        Manage
      </button>

      {open ? (
        <div
          className="absolute right-0 z-10 mt-2 w-80 space-y-4 rounded-[var(--radius-lg)] border border-border bg-panel p-4 shadow-[var(--shadow-md)]"
          role="group"
          aria-label="Pipeline settings"
        >
          {pipelines.length > 1 ? (
            <Switcher pipelines={pipelines} currentId={currentId} />
          ) : null}

          <Rename pipeline={current} />

          {current.isDefault ? (
            <p className="text-xs text-muted">
              The board opens on this pipeline.
            </p>
          ) : (
            <MakeDefault pipeline={current} />
          )}

          <Archive pipeline={current} total={pipelines.length} />
        </div>
      ) : null}
    </div>
  )
}

/**
 * ⚠️ LINKS, NOT A `<select>` WITH AN onChange. The board already reads
 * `?pipeline=` from the URL, so each pipeline has a real address — which means
 * cmd-click, middle-click, back, and sharing a board with a colleague all work.
 * A select that pushed state would break every one of them.
 */
function Switcher({
  pipelines,
  currentId,
}: {
  pipelines: ManagedPipeline[]
  currentId: string
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
        Pipelines
      </p>
      <ul className="space-y-0.5">
        {pipelines.map((p) => {
          const isCurrent = p.id === currentId
          return (
            <li key={p.id}>
              <Link
                href={`/crm/pipeline?pipeline=${p.id}`}
                aria-current={isCurrent ? 'true' : undefined}
                className={`flex items-baseline justify-between gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-sm transition-colors duration-150 ${
                  isCurrent
                    ? 'bg-surface-muted font-semibold text-ink'
                    : 'text-muted hover:bg-surface-muted hover:text-ink'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {/*
                  The stage count is the one fact that distinguishes two
                  similarly-named boards at a glance.
                */}
                <span className="shrink-0 text-xs text-muted">
                  {p.stageCount} {p.stageCount === 1 ? 'stage' : 'stages'}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Rename({ pipeline }: { pipeline: ManagedPipeline }) {
  const router = useRouter()
  const [state, action, pending] = useActionState<PipelineActionState, FormData>(
    renamePipelineAction,
    null,
  )

  // The heading above the board is server-rendered, so it keeps the old name
  // until the route refreshes.
  useEffect(() => {
    if (state?.ok) router.refresh()
  }, [state, router])

  return (
    <form action={action} className="space-y-1.5">
      <input type="hidden" name="pipelineId" value={pipeline.id} />
      <label
        htmlFor="pipeline-name"
        className="block text-xs font-semibold uppercase tracking-[0.12em] text-muted"
      >
        Name
      </label>
      <div className="flex gap-2">
        <input
          id="pipeline-name"
          name="name"
          defaultValue={pipeline.name}
          required
          maxLength={80}
          // Uncontrolled: this is a single cheap field and re-rendering the
          // menu on every keystroke buys nothing.
          className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-border bg-panel px-2.5 py-1.5 text-sm text-ink focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        />
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-[var(--radius-md)] border border-border-strong bg-panel px-3 py-1.5 text-xs font-semibold text-ink transition-colors duration-150 hover:bg-surface-muted disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
      <Feedback state={state} />
    </form>
  )
}

function MakeDefault({ pipeline }: { pipeline: ManagedPipeline }) {
  const router = useRouter()
  const [state, action, pending] = useActionState<PipelineActionState, FormData>(
    setDefaultPipelineAction,
    null,
  )

  useEffect(() => {
    if (state?.ok) router.refresh()
  }, [state, router])

  return (
    <form action={action} className="space-y-1.5">
      <input type="hidden" name="pipelineId" value={pipeline.id} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-[var(--radius-md)] px-2 py-1 text-sm font-medium text-accent transition-colors duration-150 hover:underline disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Open the board on this pipeline'}
      </button>
      <Feedback state={state} />
    </form>
  )
}

/**
 * ⚠️ CONFIRMED BEFORE IT RUNS, AND THE CONFIRMATION SAYS WHAT SURVIVES.
 * The fear about archiving is that the deals go with it. They do not, and the
 * copy says so before the click rather than after.
 */
function Archive({ pipeline, total }: { pipeline: ManagedPipeline; total: number }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [state, action, pending] = useActionState<PipelineActionState, FormData>(
    archivePipelineAction,
    null,
  )

  /*
   * ⚠️ LEAVE THE ARCHIVED PIPELINE'S URL. `?pipeline=<archived id>` no longer
   * resolves, so staying here renders "That pipeline does not exist" — an error
   * screen as the reward for a successful action.
   */
  useEffect(() => {
    if (state?.ok) router.push('/crm/pipeline')
  }, [state, router])

  const isLast = total <= 1

  return (
    <div className="space-y-1.5 border-t border-border pt-3">
      {isLast ? (
        // Explained rather than silently disabled — the server refuses this too.
        <p className="text-xs text-muted">
          This is your only pipeline. Create another before archiving it.
        </p>
      ) : confirming ? (
        <form action={action} className="space-y-2">
          <input type="hidden" name="pipelineId" value={pipeline.id} />
          <p className="text-sm text-ink">
            Archive <span className="font-semibold">{pipeline.name}</span>? Its deals
            and their history are kept, and it stops appearing on the board.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-[var(--radius-md)] bg-danger px-3 py-1.5 text-xs font-semibold text-cream transition-opacity duration-150 hover:opacity-90 disabled:opacity-60"
            >
              {pending ? 'Archiving…' : 'Archive'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-[var(--radius-md)] px-2 py-1.5 text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
            >
              Keep it
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-[var(--radius-md)] px-2 py-1 text-sm font-medium text-danger transition-colors duration-150 hover:underline"
        >
          Archive this pipeline
        </button>
      )}
      <Feedback state={state} />
    </div>
  )
}

/** Announced as well as shown — matches the pattern in `PipelineSetup`. */
function Feedback({ state }: { state: PipelineActionState }) {
  if (!state) return null
  return (
    <p
      role="status"
      aria-live="polite"
      className={`text-xs ${state.ok ? 'text-success' : 'text-danger'}`}
    >
      {state.ok ? state.message : state.error}
    </p>
  )
}
