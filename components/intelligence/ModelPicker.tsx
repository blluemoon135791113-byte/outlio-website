'use client'

/**
 * The model dropdown on the prompt bar.
 *
 * ⚠️ ONLY MODELS THAT WOULD ACTUALLY ANSWER. The list comes from
 * `lib/intelligence/llm/catalog.ts`, which resolves configured state from the
 * environment. Offering a model with no key would let a user pick it, run a
 * query, and be told "the planner was unavailable" with nothing connecting the
 * two.
 */
import { useEffect, useRef, useState } from 'react'

export type ModelOption = {
  id: string
  label: string
  model: string
  hint: string
}

export function ModelPicker({
  models,
  value,
  onChange,
  disabled,
}: {
  models: ModelOption[]
  value: string
  onChange: (id: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = models.find((model) => model.id === value) ?? models[0] ?? null

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Nothing configured at all is a deployment problem, and saying so beats an
  // empty dropdown the user will click at repeatedly.
  if (!selected) {
    return (
      <span className="rounded-[var(--radius-lg)] bg-danger-soft px-3 py-1.5 text-xs font-medium text-danger">
        No model configured
      </span>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Model: ${selected.label}`}
        className="clay-raised inline-flex h-10 items-center gap-2 px-3.5 text-sm font-medium text-ink transition-transform duration-150 ease-out active:scale-[0.97] disabled:opacity-60"
      >
        {selected.label}
        <span aria-hidden className="text-muted">
          ▾
        </span>
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="Intelligence model"
          className="clay-raised absolute right-0 top-full z-40 mt-2 w-72 overflow-hidden p-1.5"
        >
          {models.map((model) => (
            <button
              key={model.id}
              type="button"
              role="option"
              aria-selected={model.id === selected.id}
              onClick={() => {
                onChange(model.id)
                setOpen(false)
              }}
              className={`flex w-full flex-col gap-0.5 rounded-[var(--radius-lg)] px-3 py-2.5 text-left transition-colors duration-150 ${
                model.id === selected.id ? 'bg-teal-soft' : 'hover:bg-clay-sunken'
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-ink">{model.label}</span>
                {model.id === selected.id ? (
                  <span aria-hidden className="text-xs text-teal">
                    ✓
                  </span>
                ) : null}
              </span>
              <span className="text-xs text-muted">{model.hint}</span>
              {/* The exact model, for the user who has an opinion about it. */}
              <span className="font-mono text-[10px] text-muted/70">{model.model}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
