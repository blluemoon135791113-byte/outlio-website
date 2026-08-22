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
 * ║  Strictly claymorphic: one extruded surface and a generous radius.        ║
 * ║  A faint seam and broad inner pressure define it. The send button presses║
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
  busyLabel = 'Thinking…',
  shimmer = false,
  placeholder = 'Ask Hubble…',
  suggestions = [],
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  busy: boolean
  /** What the shimmer reads while a query runs. */
  busyLabel?: string
  /** Reserved for the LLM planning/generation phase, not ordinary web fetches. */
  shimmer?: boolean
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
         * dirt across a surface that is mostly empty cream — a tint that works
         * on a dense row looks like a stain on a blank field. The bar responds
         * through DEPTH instead: the surface settles on focus and the writing
         * area stays a single neutral material.
         */
        className="hubble-bar hubble-prompt-surface flex cursor-text items-center pr-3"
      >
        {/*
          While a query runs the bar shows a shimmering status line instead of
          the field. Claude-style: the light travels along the WORDS, where the
          eye already is, rather than washing the whole surface with colour.
        */}
        {busy ? (
          <span
            role="status"
            className="flex h-[76px] min-w-0 flex-1 items-center gap-2.5 px-7 text-[16px]"
          >
            <span
              aria-hidden
              className={`${shimmer ? 'hubble-pulse' : 'opacity-45'} h-2 w-2 shrink-0 rounded-full bg-ink`}
            />
            <span className={shimmer ? 'hubble-shimmer font-medium' : 'font-medium text-muted'}>
              {busyLabel}
            </span>
          </span>
        ) : null}

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
          className={`h-[76px] min-w-0 flex-1 border-0 bg-transparent px-7 text-[16px] leading-none text-ink outline-none placeholder:text-muted/80 ${
            busy ? 'hidden' : ''
          }`}
        />

        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          aria-label="Ask Hubble"
          aria-busy={busy}
          /*
           * ⚠️ ONE APPEARANCE. A clay surface with a black arrow, in every
           * state. It used to fill with colour once the bar had text, which
           * made the control flicker between two identities as you typed.
           * Availability is carried by opacity and the cursor alone.
           */
          className={`hubble-send-action inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-[var(--clay-shadow-chip)] transition-[background-color,opacity,transform,box-shadow] duration-150 ease-out ${
            canSubmit
              ? 'cursor-pointer active:scale-[0.94] active:shadow-[var(--clay-shadow-inset)]'
              : 'cursor-not-allowed opacity-45'
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

      {/*
        ⚠️ KEPT MOUNTED WHILE BUSY. Removing them collapsed the row and jumped
        everything below up by 44px the moment a query started — the page moving
        under the cursor at exactly the wrong time.
      */}
      {suggestions.length > 0 ? (
        <div
          aria-label="Suggested prompts"
          aria-hidden={busy}
          className={`flex flex-wrap gap-x-4 gap-y-1.5 ${
            busy ? 'pointer-events-none invisible' : 'visible'
          }`}
        >
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={busy}
              onClick={() => onChange(suggestion)}
              className="clay-interactive cursor-pointer rounded-lg px-1 py-1.5 text-[12px] text-muted hover:text-ink"
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
