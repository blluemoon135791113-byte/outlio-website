import type { Provenance } from '@/lib/crm/provenance'

/**
 * Where a value came from, shown next to the value.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ EVERY VALUE GETS A STATEMENT. THERE IS NO SILENT BRANCH.              ║
 * ║                                                                           ║
 * ║  CLAUDE.md rule 4 requires a missing value to carry an INDICATOR, and the ║
 * ║  same logic applies to a missing provenance: an empty space reads as "not ║
 * ║  applicable", not as "we do not know". `unknown` is a claim; a blank is   ║
 * ║  the absence of one, and the reader cannot tell the difference.           ║
 * ║                                                                           ║
 * ║  ⚠️ `entered` AND `unknown` ARE KEPT APART (DECISION-11). "Somebody typed  ║
 * ║  this" and "we have lost track" are different facts, and                  ║
 * ║  `crm_contacts.source` already knows which is which. Labelling a          ║
 * ║  hand-typed value "source unknown" would be a small lie repeated on every ║
 * ║  row — and it would make the genuine unknowns invisible among them.       ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export function ValueProvenance({ provenance }: { provenance: Provenance }) {
  if (provenance.kind === 'entered') {
    const label = {
      manual: 'Added by hand',
      csv_import: 'From a CSV import',
      api: 'Added via the API',
      flow: 'Added by an automation',
    }[provenance.how]

    return <span className="text-xs text-muted">{label}</span>
  }

  if (provenance.kind === 'unknown') {
    return (
      <span className="text-xs text-muted" title="This value predates source tracking.">
        Source not recorded
      </span>
    )
  }

  const retrieved = new Date(provenance.retrievedAt)

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-muted">
      <span>
        Found by <span className="text-ink-subtle">{provenance.provider}</span>
      </span>

      {provenance.url ? (
        <a
          href={provenance.url}
          /*
           * ⚠️ `noopener noreferrer`, AND THE URL WAS ALREADY VALIDATED.
           * `safeSourceUrl` rejects anything that is not http(s) — this href
           * carries a string a CRAWLED PAGE supplied, and a `javascript:` URL
           * here would be stored XSS executing for every user who opens the
           * contact. `noreferrer` additionally stops the source learning which
           * customer looked at it.
           */
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="underline underline-offset-2 hover:text-ink"
        >
          source
        </a>
      ) : (
        /*
         * A researched value whose URL failed validation, or that never had
         * one. The provider and date still stand; only the link is missing, and
         * saying so is better than rendering a dead control.
         */
        <span title="No usable link was recorded for this source.">(no link)</span>
      )}

      <span aria-hidden="true">·</span>
      <time dateTime={provenance.retrievedAt} title={retrieved.toISOString()}>
        {retrieved.toLocaleDateString()}
      </time>

      {/*
        ⚠️ CONFIDENCE IS SHOWN, NOT HIDDEN BEHIND A THRESHOLD.
        `MIN_EVIDENCE_CONFIDENCE = 0.7` already decides what reaches the CRM at
        all; a reader deciding whether to act on a number deserves to know it
        scored 0.72 rather than 0.99.
      */}
      {provenance.confidence > 0 && (
        <>
          <span aria-hidden="true">·</span>
          <span title="How confident the provider was in this value.">
            {Math.round(provenance.confidence * 100)}% confident
          </span>
        </>
      )}
    </span>
  )
}
