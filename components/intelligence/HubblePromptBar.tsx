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
        /*
         * ⚠️ NO HOVER GRADIENT ON THE BAR. It was given one and the wash read as
         * dirt across a surface that is mostly empty white — a tint that works
         * on a dense row looks like a stain on a blank field. The bar responds
         * through DEPTH instead: the clay lifts on hover and settles on focus.
         * Its controls carry the gradient; the writing surface stays clean.
         */
        className={`hubble-bar flex cursor-text items-center rounded-[var(--radius-clay-lg)] bg-clay-raised pr-3 shadow-[var(--clay-shadow-prompt)] transition-shadow duration-200 hover:shadow-[var(--clay-shadow-prompt-focus)] focus-within:shadow-[var(--clay-shadow-prompt-focus)] ${
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
          Shaped like a model switcher: name, chevron, quiet fill. There is one
          engine to choose so it does not open — the affordance is honest about
          what it is, and the chevron marks where more models will live when
          user-supplied ones arrive.
        */}
        <span
          title="Hubble Nova falls over to another engine automatically if one is unavailable"
          className="mr-2 hidden shrink-0 items-center gap-2 rounded-full bg-clay-sunken py-2 pl-3.5 pr-3 text-[13px] font-medium text-ink sm:inline-flex"
        >
          {modelName}
          <svg
            aria-hidden
            viewBox="0 0 10 6"
            className="h-[6px] w-[10px] text-muted"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M1 1l4 4 4-4" />
          </svg>
        </span>

        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          aria-label="Ask Hubble"
          aria-busy={busy}
          /*
           * Jet, not teal — it follows the palette the rest of the page moved
           * to. Colour still arrives only when the button is usable: a filled
           * send button on an empty bar invites a click that does nothing.
           */
          className={`clay-interactive inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
            canSubmit
              ? 'cursor-pointer bg-ink text-white'
              : 'cursor-not-allowed bg-clay-sunken text-muted'
          }`}
        >
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {busy ? <circle cx="8" cy="8" r="3" /> : <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />}
          </svg>
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
              className="clay-interactive cursor-pointer rounded-[var(--radius-clay)] bg-clay-surface px-4 py-2.5 text-[13px] text-muted shadow-[var(--clay-shadow-chip)] hover:text-ink active:scale-[0.97]"
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
