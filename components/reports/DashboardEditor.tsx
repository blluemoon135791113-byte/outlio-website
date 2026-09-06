'use client'

import { useActionState, useState } from 'react'

import {
  addWidget,
  createDashboard,
  moveWidget,
  removeWidget,
  type DashboardState,
} from '@/app/(product)/crm/reports/dashboards/actions'

export type MetricOption = {
  key: string
  label: string
  description: string
  source: string
  visuals: string[]
}

/** Announces a server-action result as well as showing it. */
function Status({ state }: { state: DashboardState }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={`text-xs ${state?.ok ? 'text-success' : 'text-danger'}`}
    >
      {state ? (state.ok ? state.message : state.error) : ''}
    </p>
  )
}

export function CreateDashboard() {
  const [state, action, pending] = useActionState<DashboardState, FormData>(
    createDashboard,
    null,
  )
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90"
      >
        New dashboard
      </button>
    )
  }

  return (
    <form action={action} className="clay w-full max-w-md space-y-3 p-4">
      <h3 className="text-sm font-semibold text-ink">New dashboard</h3>

      <label className="block">
        <span className="text-xs font-medium text-ink">Name</span>
        <input
          name="name"
          required
          maxLength={80}
          placeholder="Agency Sales"
          className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium text-ink">What it is for</span>
        <input
          name="description"
          maxLength={200}
          placeholder="What the team looks at on Monday"
          className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Creating…' : 'Create dashboard'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-[var(--radius-md)] px-3 py-1.5 text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
        >
          Cancel
        </button>
        <Status state={state} />
      </div>
    </form>
  )
}

/**
 * The widget picker.
 *
 * ⚠️ GROUPED BY SOURCE AND DESCRIBED, not a flat list of keys. Someone
 * choosing between "Contacts" and "Contacts added" needs to know which is a
 * running total and which is the period — the labels alone do not say.
 */
export function AddWidget({
  dashboardId,
  metrics,
}: {
  dashboardId: string
  metrics: MetricOption[]
}) {
  const [state, action, pending] = useActionState<DashboardState, FormData>(addWidget, null)
  const [open, setOpen] = useState(false)
  const [metricKey, setMetricKey] = useState('')

  const chosen = metrics.find((m) => m.key === metricKey)

  const grouped = metrics.reduce<Record<string, MetricOption[]>>((acc, m) => {
    acc[m.source] = [...(acc[m.source] ?? []), m]
    return acc
  }, {})

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90"
      >
        Add widget
      </button>
    )
  }

  return (
    <form action={action} className="clay w-full space-y-3 p-4">
      <input type="hidden" name="dashboardId" value={dashboardId} />
      <h3 className="text-sm font-semibold text-ink">Add a widget</h3>

      <label className="block max-w-md">
        <span className="text-xs font-medium text-ink">Metric</span>
        <select
          name="metricKey"
          value={metricKey}
          onChange={(event) => setMetricKey(event.target.value)}
          required
          className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink [color-scheme:light]"
        >
          <option value="">Choose a metric…</option>
          {Object.entries(grouped).map(([source, list]) => (
            <optgroup key={source} label={source}>
              {list.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      {/* The description only helps if it is visible while choosing. */}
      {chosen ? <p className="text-xs text-muted">{chosen.description}</p> : null}

      <div className="flex flex-wrap gap-3">
        <label className="block">
          <span className="text-xs font-medium text-ink">Shown as</span>
          <select
            name="visual"
            className="mt-1 rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink [color-scheme:light]"
          >
            {(chosen?.visuals ?? ['stat']).map((v) => (
              <option key={v} value={v}>
                {v === 'stat' ? 'Number' : v === 'bullet' ? 'Against a target' : v}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-ink">Width</span>
          <select
            name="width"
            defaultValue="1"
            className="mt-1 rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink [color-scheme:light]"
          >
            <option value="1">Quarter</option>
            <option value="2">Half</option>
            <option value="4">Full width</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || !metricKey}
          className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Adding…' : 'Add widget'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-[var(--radius-md)] px-3 py-1.5 text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
        >
          Cancel
        </button>
        <Status state={state} />
      </div>
    </form>
  )
}

/** Reorder and remove, on each widget. */
export function WidgetControls({
  dashboardId,
  widgetId,
  isFirst,
  isLast,
  label,
}: {
  dashboardId: string
  widgetId: string
  isFirst: boolean
  isLast: boolean
  label: string
}) {
  const [, moveAction] = useActionState<DashboardState, FormData>(moveWidget, null)
  const [, removeAction] = useActionState<DashboardState, FormData>(removeWidget, null)

  return (
    <div className="flex items-center gap-1">
      {(['up', 'down'] as const).map((direction) => (
        <form key={direction} action={moveAction}>
          <input type="hidden" name="dashboardId" value={dashboardId} />
          <input type="hidden" name="widgetId" value={widgetId} />
          <input type="hidden" name="direction" value={direction} />
          <button
            type="submit"
            disabled={direction === 'up' ? isFirst : isLast}
            aria-label={`Move ${label} ${direction === 'up' ? 'earlier' : 'later'}`}
            className="px-1 text-xs text-muted transition-colors duration-150 hover:text-ink disabled:opacity-30"
          >
            {direction === 'up' ? '▲' : '▼'}
          </button>
        </form>
      ))}

      <form action={removeAction}>
        <input type="hidden" name="dashboardId" value={dashboardId} />
        <input type="hidden" name="widgetId" value={widgetId} />
        <button
          type="submit"
          aria-label={`Remove ${label}`}
          className="rounded-[var(--radius-md)] px-2 py-1 text-xs font-medium text-muted transition-colors duration-150 hover:text-danger"
        >
          Remove
        </button>
      </form>
    </div>
  )
}
