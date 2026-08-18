'use client'

/**
 * The Ask Hubble bar.
 *
 * ⚠️ STRICTLY CLAYMORPHIC. Extruded surface, generous radius, no border — the
 * paired shadow does the separating. The input sits SUNKEN inside the raised
 * bar, which is what tells you it is for typing without a border saying so.
 *
 * While a query runs, `.hubble-generating` fills the bar with colour rising
 * from the left. It is a fill behind the content, not a ring around it, so the
 * bar reads as working rather than as decorated.
 *
 * There is no model picker. Hubble Nova is one name over every configured
 * engine — see `lib/intelligence/llm/catalog.ts`.
 */
export function HubblePromptBar({
  value,
  onChange,
  onSubmit,
  busy,
  modelName,
  placeholder = 'Ask Hubble…',
  suggestions = [],
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  busy: boolean
  modelName: string
  placeholder?: string
  suggestions?: string[]
}) {
  const canSubmit = value.trim().length >= 3 && !busy

  return (
    <div className="space-y-3.5">
      <div
        className={`rounded-[var(--radius-clay-lg)] bg-clay-raised shadow-[var(--clay-shadow-lg)] ${
          busy ? 'hubble-generating' : ''
        }`}
      >
        <div className="flex items-center gap-2.5 p-2.5">
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
            className="min-w-0 flex-1 bg-transparent px-4 py-3 text-[15px] text-ink outline-none placeholder:text-muted disabled:opacity-70"
          />

          {/*
            One name, not a picker. The engine behind it fails over when a
            vendor's credits run out, which is not the user's problem to solve.
          */}
          <span
            title="Falls over to another engine automatically if one is unavailable"
            className="hidden shrink-0 items-center gap-2 rounded-[var(--radius-clay)] bg-clay-surface px-3.5 py-2.5 text-sm font-medium text-ink shadow-[var(--clay-shadow)] sm:inline-flex"
          >
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-teal" />
            {modelName}
          </span>

          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            aria-label="Ask Hubble"
            aria-busy={busy}
            className="inline-flex h-11 w-12 shrink-0 items-center justify-center rounded-[var(--radius-clay)] bg-clay-surface text-ink shadow-[var(--clay-shadow)] transition-[transform,box-shadow] duration-150 ease-out active:scale-[0.95] active:shadow-[var(--clay-shadow-inset)] disabled:opacity-40"
          >
            <span aria-hidden className="text-lg leading-none">
              {busy ? '·' : '↵'}
            </span>
          </button>
        </div>
      </div>

      {/* The state in words, for anyone the animation does not reach. */}
      <span className="sr-only" aria-live="polite">
        {busy ? 'Hubble is working' : ''}
      </span>

      {suggestions.length > 0 && !busy ? (
        <div className="flex flex-wrap gap-2.5">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onChange(suggestion)}
              className="rounded-[var(--radius-clay)] bg-clay-surface px-4 py-2.5 text-[13px] text-muted shadow-[var(--clay-shadow)] transition-[transform,color] duration-150 ease-out hover:text-ink active:scale-[0.97] active:shadow-[var(--clay-shadow-inset)]"
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
