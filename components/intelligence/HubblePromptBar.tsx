'use client'

/**
 * The Ask Hubble bar.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE INPUT *IS* THE BAR.                                              ║
 * ║                                                                          ║
 * ║  An earlier version nested a padded input block inside the clay surface, ║
 * ║  which rendered as a search field sitting ON a bar — two objects where   ║
 * ║  there should be one. The input now fills the surface edge to edge with  ║
 * ║  no background, no ring and no border of its own, so typing happens on   ║
 * ║  the bar itself.                                                         ║
 * ║                                                                          ║
 * ║  Strictly claymorphic: one extruded surface, generous radius, no border. ║
 * ║  The paired shadow does the separating. The send button presses INWARD   ║
 * ║  on click — clay deforms, it does not just tint.                         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
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
    <div className="space-y-4">
      {/*
        `focus-within` lifts the whole bar rather than drawing a focus ring on
        a child, which is what keeps it reading as a single object.
      */}
      <div
        className={`hubble-bar flex items-center rounded-[var(--radius-clay-lg)] bg-clay-raised pr-2.5 shadow-[var(--clay-shadow-lg)] transition-shadow duration-200 focus-within:shadow-[var(--clay-shadow-focus)] ${
          busy ? 'hubble-generating' : ''
        }`}
      >
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
          /*
           * No background, no border, no ring. Height comes from the input so
           * the text sits on the bar's own baseline rather than inside a box
           * that happens to be on it.
           */
          className="h-[68px] min-w-0 flex-1 border-0 bg-transparent px-7 text-[16px] leading-none text-ink outline-none placeholder:text-muted/80 disabled:opacity-70"
        />

        {/*
          One name, not a picker. The engine behind it fails over when a
          vendor's credits run out, which is not the user's problem to solve.
        */}
        <span
          title="Falls over to another engine automatically if one is unavailable"
          className="mr-2 hidden shrink-0 items-center gap-2 rounded-[var(--radius-clay)] bg-clay-surface px-4 py-2.5 text-[13px] font-medium text-ink shadow-[var(--clay-shadow-chip)] sm:inline-flex"
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
          className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-clay)] bg-clay-surface text-ink shadow-[var(--clay-shadow-chip)] transition-[transform,box-shadow] duration-150 ease-out hover:shadow-[var(--clay-shadow)] active:scale-[0.94] active:shadow-[var(--clay-shadow-inset)] disabled:opacity-40 disabled:active:scale-100"
        >
          <span aria-hidden className="text-[17px] leading-none">
            {busy ? '•' : '↵'}
          </span>
        </button>
      </div>

      {/* The state in words, for anyone the animation does not reach. */}
      <span className="sr-only" aria-live="polite">
        {busy ? 'Hubble is working' : ''}
      </span>

      {/*
        ⚠️ KEPT MOUNTED WHILE BUSY. Removing them collapsed the row and jumped
        everything below up by 44px the moment a query started — the page moving
        under the cursor at exactly the wrong time.
      */}
      {suggestions.length > 0 ? (
        <div
          aria-hidden={busy}
          className={`flex flex-wrap gap-2.5 transition-opacity duration-200 ${
            busy ? 'pointer-events-none opacity-40' : 'opacity-100'
          }`}
        >
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={busy}
              onClick={() => onChange(suggestion)}
              className="rounded-[var(--radius-clay)] bg-clay-surface px-4 py-2.5 text-[13px] text-muted shadow-[var(--clay-shadow-chip)] transition-[transform,color,box-shadow] duration-150 ease-out hover:text-ink hover:shadow-[var(--clay-shadow)] active:scale-[0.97] active:shadow-[var(--clay-shadow-inset)]"
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
