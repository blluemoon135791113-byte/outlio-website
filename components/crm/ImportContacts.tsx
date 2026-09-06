'use client'

import { useActionState, useRef, useState } from 'react'
import Link from 'next/link'

import {
  commitImport,
  previewImport,
  undoImport,
  type ImportState,
} from '@/app/(product)/crm/import/actions'

/**
 * CSV import — R1.
 *
 * ⚠️ TWO SUBMITS OF THE SAME FILE, NOT AN UPLOAD-THEN-COMMIT. The file stays in
 * the browser between preview and commit, so nothing half-imported is ever
 * stored server-side. The alternative — persist on upload, commit later —
 * leaves orphaned uploads whenever someone changes their mind, and someone
 * changing their mind after seeing the preview is exactly what the preview is
 * for.
 */
export function ImportContacts() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [filename, setFilename] = useState('')

  const [preview, runPreview, previewing] = useActionState<ImportState, FormData>(
    previewImport,
    null,
  )
  const [committed, runCommit, committing] = useActionState<ImportState, FormData>(
    commitImport,
    null,
  )
  const [undone, runUndo] = useActionState<ImportState, FormData>(undoImport, null)

  const state = undone ?? committed ?? preview

  if (state?.step === 'done') {
    return (
      <div className="clay space-y-3 p-5">
        <h3 className="text-sm font-semibold text-ink">Import finished</h3>

        <ul className="space-y-1 text-sm text-muted">
          <li>
            <strong className="text-ink">{state.created}</strong> new{' '}
            {state.created === 1 ? 'contact' : 'contacts'}
          </li>
          {/*
            ⚠️ "ALREADY IN YOUR CRM", NOT "DUPLICATES". These people were
            recognised and associated with this batch rather than copied — the
            canonical-contact rule working. Calling them duplicates would make
            a correct outcome sound like a problem.
          */}
          <li>
            <strong className="text-ink">{state.matched}</strong> already in your CRM, linked
            to this import
          </li>
          {state.skipped > 0 ? (
            <li>
              <strong className="text-ink">{state.skipped}</strong> skipped — no usable name
              or email
            </li>
          ) : null}
        </ul>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Link
            href="/crm/contacts"
            className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90"
          >
            See the contacts
          </Link>

          <form action={runUndo}>
            <input type="hidden" name="batchId" value={state.batchId} />
            <button
              type="submit"
              className="rounded-[var(--radius-md)] px-3 py-1.5 text-xs font-medium text-danger transition-colors duration-150 hover:opacity-80"
            >
              Undo this import
            </button>
          </form>
        </div>

        <p className="text-xs text-muted">
          Undoing removes only the contacts this import created. Anyone who was already in
          your CRM stays.
        </p>
      </div>
    )
  }

  return (
    <div className="clay space-y-4 p-5">
      <div>
        <h3 className="text-sm font-semibold text-ink">Import contacts from a CSV</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Nothing is saved until you have seen what will happen. Someone already in your
          CRM is linked to the import, never duplicated.
        </p>
      </div>

      <form action={runPreview} className="space-y-3">
        <input
          ref={fileRef}
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          onChange={(event) => setFilename(event.target.files?.[0]?.name ?? '')}
          className="block w-full text-sm text-ink file:mr-3 file:rounded-[var(--radius-md)] file:border-0 file:bg-surface-muted file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-ink"
        />

        <button
          type="submit"
          disabled={previewing}
          className="rounded-[var(--radius-md)] bg-surface-muted px-3 py-1.5 text-xs font-medium text-ink transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
        >
          {previewing ? 'Reading…' : 'Check the file'}
        </button>
      </form>

      {state?.step === 'error' ? (
        <p role="alert" className="rounded-[var(--radius-md)] bg-danger-soft px-3 py-2 text-xs text-danger">
          {state.error}
        </p>
      ) : null}

      {preview?.step === 'preview' ? (
        <div className="space-y-3 border-t border-line pt-4">
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="text-ink">
              <strong>{preview.preview.rowsValid}</strong> rows ready
            </span>
            {preview.preview.rowsFailed > 0 ? (
              <span className="text-warning">
                <strong>{preview.preview.rowsFailed}</strong> will be skipped
              </span>
            ) : null}
          </div>

          {preview.preview.sample.length > 0 ? (
            <div>
              <p className="text-xs font-medium text-ink">
                First few rows, as they will be stored
              </p>
              <ul className="mt-1 space-y-1">
                {preview.preview.sample.map((row, i) => (
                  <li key={i} className="text-xs text-muted">
                    {row.map((cell) => `${cell.field}: ${cell.value}`).join(' · ')}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.preview.errors.length > 0 ? (
            <div>
              {/* Named by line number, so the row can be found in a spreadsheet. */}
              <p className="text-xs font-medium text-ink">Rows that cannot be imported</p>
              <ul className="mt-1 space-y-0.5">
                {preview.preview.errors.map((e, i) => (
                  <li key={i} className="text-xs text-muted">
                    Line {e.row}: {e.reason}
                  </li>
                ))}
              </ul>
              {preview.preview.errorsTruncated ? (
                <p className="mt-1 text-xs text-muted">…and more not shown.</p>
              ) : null}
            </div>
          ) : null}

          <form
            action={(formData) => {
              /*
               * The same file, re-sent. `useActionState` gives a fresh
               * FormData, so the input is read again from the picker the user
               * has not touched.
               */
              const file = fileRef.current?.files?.[0]
              if (file) formData.set('file', file)
              formData.set('mapping', JSON.stringify(preview.preview.mapping))
              formData.set('filename', filename || 'import.csv')
              runCommit(formData)
            }}
          >
            <button
              type="submit"
              disabled={committing || preview.preview.rowsValid === 0}
              className="rounded-[var(--radius-md)] bg-accent px-4 py-2 text-sm font-semibold text-cream transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
            >
              {committing
                ? 'Importing…'
                : `Import ${preview.preview.rowsValid} contact${
                    preview.preview.rowsValid === 1 ? '' : 's'
                  }`}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  )
}
