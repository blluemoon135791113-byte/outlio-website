/**
 * The designed loading state for every authenticated screen.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THERE WAS NO `loading.tsx` ANYWHERE, SO NAVIGATION HAD NO FEEDBACK.      ║
 * ║                                                                           ║
 * ║  Without one, Next holds the PREVIOUS page on screen until the new         ║
 * ║  Server Component resolves. Several of these pages do real work first —    ║
 * ║  the contact page reads seven tables, `/crm/reports` runs rollup reads —   ║
 * ║  so a click produced a second or more of nothing, on a screen still        ║
 * ║  showing the page you just left. The usual reading of that is that the     ║
 * ║  click missed.                                                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ A SHAPE, NOT A SPINNER. A skeleton that matches the page's geometry keeps
 * the layout from jumping when content arrives; a centred spinner guarantees it
 * will. Deliberately generic — this one file covers 38 routes, so it claims
 * only what they share: a heading and some stacked panels.
 *
 * ⚠️ `motion-safe:` ON THE PULSE, matching `ExtractionDashboard`. Someone with
 * `prefers-reduced-motion` gets the shape without the animation. This is not
 * the entrance animation the design rules forbid — nothing is being revealed;
 * it is a placeholder that exists only while there is nothing to show.
 */
export default function ProductLoading() {
  return (
    <div className="space-y-6 px-1 py-2" aria-busy="true" aria-live="polite">
      {/*
        The only text here. A screen reader should say "Loading" once, not
        narrate a dozen decorative blocks — hence `aria-hidden` on every bar.
      */}
      <span className="sr-only">Loading…</span>

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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="clay space-y-3 p-4">
            <div
              aria-hidden
              className="h-4 w-24 rounded-[var(--radius-sm)] bg-surface-muted motion-safe:animate-pulse"
            />
            <div
              aria-hidden
              className="h-8 w-32 rounded-[var(--radius-md)] bg-surface-muted motion-safe:animate-pulse"
            />
          </div>
        ))}
      </div>

      <div className="clay space-y-3 p-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div
              aria-hidden
              className="h-9 w-9 shrink-0 rounded-full bg-surface-muted motion-safe:animate-pulse"
            />
            <div className="flex-1 space-y-2">
              <div
                aria-hidden
                className="h-3.5 w-1/3 rounded-[var(--radius-sm)] bg-surface-muted motion-safe:animate-pulse"
              />
              <div
                aria-hidden
                className="h-3 w-1/2 rounded-[var(--radius-sm)] bg-surface-muted motion-safe:animate-pulse"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
