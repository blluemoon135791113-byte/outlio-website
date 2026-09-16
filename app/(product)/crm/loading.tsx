/**
 * The loading shape for the CRM, which is a table rather than a card grid.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE GROUP SKELETON CLAIMS MORE THAN IT SHOULD FOR THESE ROUTES.       ║
 * ║                                                                           ║
 * ║  `app/(product)/loading.tsx` says it is "deliberately generic… it claims   ║
 * ║  only what they share: a heading and some stacked panels". What it         ║
 * ║  actually renders is a three-column grid of cards — which is right for     ║
 * ║  /dashboard and wrong for every table under /crm.                        ║
 * ║                                                                           ║
 * ║  Its own reasoning is the argument for this file: "a skeleton that matches ║
 * ║  the page's geometry keeps the layout from jumping when content arrives".  ║
 * ║  A card grid that becomes a table jumps exactly as much as a spinner       ║
 * ║  would, and additionally spends a moment implying the wrong page.         ║
 * ║                                                                           ║
 * ║  ⚠️ ONE FILE, NOT SEVEN. Next inherits this down the segment, so contacts, ║
 * ║  companies, tasks, pipeline, lists, duplicates and reports all get it. A   ║
 * ║  skeleton per route would be seven files claiming to know seven layouts,   ║
 * ║  and the next new CRM page would silently fall back to the card grid.     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Conventions copied from the group file rather than reinvented: one `sr-only`
 * announcement, `aria-hidden` on every decorative bar so a screen reader says
 * "Loading" once instead of narrating a dozen blocks, and `motion-safe:` on the
 * pulse so `prefers-reduced-motion` gets the shape without the animation.
 */
export default function CrmLoading() {
  return (
    <div className="space-y-6 px-1 py-2" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      {/* Heading and its subtitle. */}
      <div className="space-y-2">
        <div
          aria-hidden
          className="h-7 w-56 rounded-[var(--radius-md)] bg-surface-muted motion-safe:animate-pulse"
        />
        <div
          aria-hidden
          className="h-4 w-80 max-w-full rounded-[var(--radius-sm)] bg-surface-muted motion-safe:animate-pulse"
        />
      </div>

      {/*
        The filter row. Every CRM table has one, and it is the part that arrives
        first on a real load — leaving it out would make the skeleton shorter
        than the page and shift everything up.
      */}
      <div aria-hidden className="flex flex-wrap gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-9 w-28 rounded-[var(--radius-md)] bg-surface-muted motion-safe:animate-pulse"
          />
        ))}
      </div>

      {/* The table itself: a header band, then rows of even height. */}
      <div className="clay overflow-hidden">
        <div
          aria-hidden
          className="h-10 border-b border-border bg-surface-muted motion-safe:animate-pulse"
        />
        <div aria-hidden className="divide-y divide-border">
          {/*
            ⚠️ TEN ROWS, BECAUSE THAT IS ROUGHLY A SCREENFUL. Fewer leaves a gap
            the content then fills by pushing the page down; many more pretends
            to a page length this route may not have.
          */}
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <div className="h-4 w-4 shrink-0 rounded-[var(--radius-sm)] bg-surface-muted motion-safe:animate-pulse" />
              <div className="h-4 w-44 max-w-[40%] rounded-[var(--radius-sm)] bg-surface-muted motion-safe:animate-pulse" />
              <div className="hidden h-4 w-36 rounded-[var(--radius-sm)] bg-surface-muted motion-safe:animate-pulse sm:block" />
              <div className="ml-auto h-4 w-20 rounded-[var(--radius-sm)] bg-surface-muted motion-safe:animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
