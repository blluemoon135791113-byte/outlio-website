import { creditsForFiles, EXPORT_CREDIT_COST } from '@/lib/limits/credits'

/**
 * The short "how credits work" explainer shown inside the product — on the
 * dashboard overview and again on the upload page, where it matters most.
 *
 * Every number is derived from the caller's plan limits, which come from
 * `plans.limits` at runtime. Nothing here is per-plan copy, so a limit change
 * in the database is reflected without touching this file.
 */
export function CreditsSummary({
  filesPerCredit,
  maxFiles,
}: {
  /** `null` when the plan charges a flat 1 credit per extraction. */
  filesPerCredit: number | null
  maxFiles: number
}) {
  const maxCost = creditsForFiles(maxFiles, filesPerCredit)

  const lines = [
    filesPerCredit
      ? { term: '1 credit', detail: `covers up to ${filesPerCredit} files in one run` }
      : { term: '1 credit', detail: 'covers one extraction, whatever its size' },
    {
      term: `${maxCost} credit${maxCost === 1 ? '' : 's'}`,
      detail: `a full ${maxFiles}-file run — your largest batch`,
    },
    EXPORT_CREDIT_COST === 0
      ? { term: 'Free', detail: 'every CSV download, always' }
      : {
          term: `${EXPORT_CREDIT_COST} credit`,
          detail: 'each CSV download',
        },
  ]

  return (
    <section className="credits-gradient rounded-[var(--radius-xl)] border border-accent/15 p-5 shadow-[var(--shadow-sm)]">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
        How credits work
      </p>

      <dl className="mt-3.5 space-y-2.5">
        {lines.map((line) => (
          <div key={line.term} className="flex gap-2 text-xs leading-5">
            <dt className="shrink-0 font-semibold text-ink">{line.term}</dt>
            <dd className="text-muted">{line.detail}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 border-t border-accent/10 pt-3 text-[11px] leading-4 text-muted">
        Credits reset at the start of each month and do not roll over.
      </p>
    </section>
  )
}
