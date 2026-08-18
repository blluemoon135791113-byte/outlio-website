'use client'

/**
 * The Ask Hubble bar.
 *
 * The teal sweep runs ONLY while a run is actually in flight (`.hubble-thinking`
 * in globals.css). Motion that is always on stops meaning anything; motion that
 * appears exactly when work starts is a status indicator.
 *
 * ⚠️ The animation is decoration. `aria-live` text carries the same state, and
 * `prefers-reduced-motion` swaps the sweep for a static ring — a user who has
 * asked for less motion still needs to know something is happening.
 */
import { ModelPicker, type ModelOption } from '@/components/intelligence/ModelPicker'

export function HubblePromptBar({
  value,
  onChange,
  onSubmit,
  busy,
  models,
  modelId,
  onModelChange,
  placeholder = 'Ask Hubble…',
  suggestions = [],
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  busy: boolean
  models: ModelOption[]
  modelId: string
  onModelChange: (id: string) => void
  placeholder?: string
  suggestions?: string[]
}) {
  const canSubmit = value.trim().length >= 3 && !busy

  return (
    <div className="space-y-3">
      <div className={busy ? 'hubble-thinking clay-raised' : 'clay-raised'}>
        <div className="flex items-center gap-3 p-2.5">
          <input
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSubmit) onSubmit()
            }}
            disabled={busy}
            placeholder={placeholder}
            aria-label={placeholder}
            className="min-w-0 flex-1 bg-transparent px-3 text-[15px] text-ink outline-none placeholder:text-muted disabled:opacity-70"
          />

          <ModelPicker
            models={models}
            value={modelId}
            onChange={onModelChange}
            disabled={busy}
          />

          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            aria-label="Run"
            aria-busy={busy}
            className="clay-raised inline-flex h-10 w-11 shrink-0 items-center justify-center text-ink transition-transform duration-150 ease-out active:scale-[0.94] disabled:opacity-40"
          >
            <span aria-hidden>{busy ? '·' : '↵'}</span>
          </button>
        </div>
      </div>

      {/* The status in words, for anyone the animation does not reach. */}
      <span className="sr-only" aria-live="polite">
        {busy ? 'Hubble is working' : ''}
      </span>

      {suggestions.length > 0 && !busy ? (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onChange(suggestion)}
              className="clay px-3.5 py-2 text-[13px] text-muted transition-[transform,color] duration-150 ease-out hover:text-ink active:scale-[0.97]"
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
