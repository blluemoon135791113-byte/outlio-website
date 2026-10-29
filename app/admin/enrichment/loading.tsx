/** Several reads per job across ten jobs: long enough to need a visible wait. */
export default function AdminEnrichmentLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading the enrichment report">
      <div className="space-y-2">
        <div className="h-4 w-16 rounded bg-border" />
        <div className="h-8 w-48 rounded bg-border" />
        <div className="h-4 w-96 max-w-full rounded bg-border" />
      </div>
      {[0, 1].map((key) => (
        <div
          key={key}
          className="h-56 rounded-[var(--radius-xl)] border border-border bg-panel shadow-[var(--shadow-sm)]"
        />
      ))}
    </div>
  )
}
