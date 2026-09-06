'use client'

import { useActionState } from 'react'
import Link from 'next/link'

import {
  ignorePair,
  mergePair,
  type DuplicateActionState,
} from '@/app/(product)/crm/duplicates/actions'

export type DuplicateRow = {
  id: string
  recordAId: string
  recordBId: string
  nameA: string
  nameB: string
  score: number
  confidence: 'exact' | 'possible'
  summary: string
  signals: { kind: string; weight: number; reason: string }[]
  detectedAt: string
  resolved: boolean
}

function Pair({ row, canMerge }: { row: DuplicateRow; canMerge: boolean }) {
  const [mergeState, merge, merging] = useActionState<DuplicateActionState, FormData>(mergePair, null)
  const [ignoreState, ignore] = useActionState<DuplicateActionState, FormData>(ignorePair, null)
  const feedback = mergeState ?? ignoreState

  return (
    <li className="clay space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">
            {row.nameA} <span className="font-normal text-muted">and</span> {row.nameB}
          </p>
          {/*
            ⚠️ THE REASON, IN WORDS, IS THE POINT OF THIS SCREEN. "89%" alone
            asks someone to trust a number they cannot check. The brief calls
            for a human-readable reason on every flagged pair.
          */}
          <p className="mt-0.5 text-xs leading-relaxed text-muted">{row.summary}</p>
        </div>

        <span
          className={`shrink-0 rounded-[var(--radius-sm)] px-2 py-0.5 text-xs font-medium ${
            row.confidence === 'exact'
              ? 'bg-danger-soft text-danger'
              : 'bg-warning-soft text-warning'
          }`}
        >
          {row.confidence === 'exact' ? 'Certain' : `${row.score}% likely`}
        </span>
      </div>

      {row.signals.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {row.signals.map((signal, i) => (
            <li
              key={`${signal.kind}-${i}`}
              className="rounded-[var(--radius-sm)] bg-surface-muted px-2 py-0.5 text-xs text-muted"
            >
              {signal.reason}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/crm/contacts/${row.recordAId}`}
          className="rounded-[var(--radius-md)] px-2.5 py-1 text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
        >
          Open {row.nameA}
        </Link>
        <Link
          href={`/crm/contacts/${row.recordBId}`}
          className="rounded-[var(--radius-md)] px-2.5 py-1 text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
        >
          Open {row.nameB}
        </Link>
      </div>

      {!row.resolved && canMerge ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {/*
            ⚠️ WHICH RECORD SURVIVES IS AN EXPLICIT CHOICE, not a default we
            pick. A merge is irreversible and rewrites attribution, so the one
            decision that cannot be undone is the one the person makes.
          */}
          <form action={merge}>
            <input type="hidden" name="survivingId" value={row.recordAId} />
            <input type="hidden" name="mergedId" value={row.recordBId} />
            <button
              type="submit"
              disabled={merging}
              className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
            >
              Keep {row.nameA}
            </button>
          </form>

          <form action={merge}>
            <input type="hidden" name="survivingId" value={row.recordBId} />
            <input type="hidden" name="mergedId" value={row.recordAId} />
            <button
              type="submit"
              disabled={merging}
              className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
            >
              Keep {row.nameB}
            </button>
          </form>

          <form action={ignore}>
            <input type="hidden" name="candidateId" value={row.id} />
            <button
              type="submit"
              className="rounded-[var(--radius-md)] px-3 py-1.5 text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
            >
              Not a duplicate
            </button>
          </form>
        </div>
      ) : null}

      {feedback ? (
        <p className={`text-xs ${feedback.ok ? 'text-success' : 'text-danger'}`}>
          {feedback.ok ? feedback.message : feedback.error}
        </p>
      ) : null}
    </li>
  )
}

export function DuplicateList({
  rows,
  canMerge,
  tab,
}: {
  rows: DuplicateRow[]
  canMerge: boolean
  tab: string
}) {
  if (rows.length === 0) {
    return (
      <div className="clay p-10 text-center">
        <p className="text-sm font-medium text-ink">
          {tab === 'exact'
            ? 'No certain duplicates'
            : tab === 'possible'
              ? 'Nothing needs a second look'
              : tab === 'resolved'
                ? 'Nothing merged yet'
                : 'Nothing marked as a false match'}
        </p>
        <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted">
          {tab === 'exact' || tab === 'possible'
            ? 'Pairs appear here when an import or lead search brings in someone you may already have.'
            : 'Pairs you resolve show up here so a merge can be traced back.'}
        </p>
      </div>
    )
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <Pair key={row.id} row={row} canMerge={canMerge} />
      ))}
    </ul>
  )
}
