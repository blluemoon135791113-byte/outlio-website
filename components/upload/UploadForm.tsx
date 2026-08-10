'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

import { createClient } from '@/lib/supabase/client'
import {
  createUploadSessionAction,
  finalizeUploadAction,
} from '@/lib/upload/session'
import { formatBytes } from '@/lib/upload/limits'
import { estimatedCreditCostForFiles, TYPICAL_LEADS_PER_PAGE } from '@/lib/limits/credits'

/**
 * Files are uploaded DIRECTLY to Supabase Storage using signed upload URLs.
 *
 * They are deliberately NOT sent through a Server Action: those cap the request
 * body at 1 MB by default (and ~4.5 MB on Vercel regardless), which silently
 * truncates a large file into an empty `blob`. See lib/upload/session.ts.
 *
 * Everything checked here is UX only. The server re-validates access and limits,
 * and the worker sniffs actual file content before parsing.
 */

type Status = 'idle' | 'preparing' | 'uploading' | 'finalising' | 'done' | 'error'

type FileState = {
  file: File
  progress: number
  failed: boolean
}

const inputClass =
  'w-full rounded-[var(--radius-md)] border border-border bg-panel px-3 py-2.5 text-sm text-ink transition-colors duration-150 hover:border-border-strong focus:border-accent'

export function UploadForm({
  maxFiles,
  maxFileBytes,
  leadsPerCredit,
}: {
  maxFiles: number
  maxFileBytes: number
  /** `null` when the plan charges a flat 1 credit per extraction. */
  leadsPerCredit: number | null
}) {
  const router = useRouter()
  const [items, setItems] = useState<FileState[]>([])
  const [consent, setConsent] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [dedupeMode, setDedupeMode] = useState('remove_exact')
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const busy = status === 'preparing' || status === 'uploading' || status === 'finalising'

  function addFiles(incoming: FileList | null) {
    if (!incoming || busy) return
    setItems((prev) => {
      const next = [...prev]
      for (const f of Array.from(incoming)) {
        const dup = next.some((e) => e.file.name === f.name && e.file.size === f.size)
        if (!dup) next.push({ file: f, progress: 0, failed: false })
      }
      return next.slice(0, maxFiles)
    })
    setMessage(null)
  }

  function removeAt(index: number) {
    if (busy) return
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  async function start() {
    if (items.length === 0 || !consent || busy) return

    setStatus('preparing')
    setMessage(null)

    const session = await createUploadSessionAction({
      dedupeMode,
      files: items.map((i) => ({ name: i.file.name, size: i.file.size })),
    })

    if (!session.ok) {
      setStatus('error')
      setMessage(session.message)
      return
    }

    setStatus('uploading')
    const supabase = createClient()
    const failedFileIds: string[] = []

    // Sequential rather than parallel: a 100-file batch fired at once will hit
    // storage rate limits and makes per-file progress meaningless.
    for (let i = 0; i < items.length; i++) {
      const ticket = session.tickets[i]
      const item = items[i]
      if (!ticket || !item) continue

      try {
        const { error } = await supabase.storage
          .from(session.bucket)
          .uploadToSignedUrl(ticket.path, ticket.token, item.file, {
            contentType: 'text/html',
          })

        if (error) throw error

        setItems((prev) =>
          prev.map((p, idx) => (idx === i ? { ...p, progress: 100 } : p)),
        )
      } catch {
        failedFileIds.push(ticket.fileId)
        setItems((prev) =>
          prev.map((p, idx) => (idx === i ? { ...p, failed: true, progress: 0 } : p)),
        )
      }
    }

    setStatus('finalising')

    const result = await finalizeUploadAction({ jobId: session.jobId, failedFileIds })

    if (!result.ok) {
      setStatus('error')
      setMessage(result.message)
      return
    }

    setStatus('done')
    setMessage(
      `${result.queued} file${result.queued === 1 ? '' : 's'} queued. Your CSV will appear on the Extractions page.`,
    )
    router.push('/dashboard/jobs')
  }

  const totalBytes = items.reduce((s, i) => s + i.file.size, 0)
  const oversize = items.filter((i) => i.file.size > maxFileBytes)
  const uploadedCount = items.filter((i) => i.progress === 100).length

  /*
   * An UPPER BOUND, not a price. Credits are charged per block of leads, and
   * the lead count is unknown until the worker parses the files, so this
   * assumes every file is a full page. A run of part-full pages costs less.
   * The database does the real arithmetic in `charge_extraction_leads`.
   */
  const maxCreditCost = estimatedCreditCostForFiles(items.length, leadsPerCredit)

  return (
    <div className="space-y-5">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          if (!busy) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          addFiles(e.dataTransfer.files)
        }}
        className={
          dragging
            ? 'rounded-[var(--radius-lg)] border border-dashed border-accent bg-accent-soft p-8 text-center transition-colors duration-150 sm:p-10'
            : 'rounded-[var(--radius-lg)] border border-dashed border-border-strong bg-surface-muted/45 p-8 text-center transition-colors duration-150 sm:p-10'
        }
      >
        <span aria-hidden className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-panel text-lg text-accent shadow-[var(--shadow-sm)]">
          ↑
        </span>
        <p className="text-sm font-semibold text-ink">Drag and drop your saved pages here</p>
        <p className="mt-1 text-sm text-muted">
          or{' '}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="font-medium text-accent underline underline-offset-2 disabled:opacity-60"
          >
            choose files
          </button>
        </p>

        <input
          ref={inputRef}
          id="files"
          type="file"
          multiple
          accept=".html,.htm,text/html"
          className="sr-only"
          onChange={(e) => addFiles(e.target.files)}
        />

        <p className="mt-4 text-xs leading-relaxed text-muted">
          Upload only .html files you saved manually from a lead search-results page.
          Do not upload files from any other source.
        </p>
        <p className="mt-1 text-xs text-muted">
          Up to {maxFiles} files, {formatBytes(maxFileBytes)} each.
          {leadsPerCredit
            ? ` 1 credit per ${leadsPerCredit} leads, counted across the whole run.`
            : ' 1 credit per run.'}
        </p>
      </div>

      {items.length > 0 ? (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-panel">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="text-sm font-medium text-ink">
              {items.length} file{items.length === 1 ? '' : 's'} selected
              {status === 'uploading' ? ` · ${uploadedCount}/${items.length} uploaded` : ''}
            </p>
            <p className="text-sm tabular-nums text-muted">
              up to {maxCreditCost} credit{maxCreditCost === 1 ? '' : 's'} ·{' '}
              {formatBytes(totalBytes)}
            </p>
          </div>

          {leadsPerCredit ? (
            <p className="border-b border-border bg-surface-muted/45 px-4 py-2 text-xs text-muted">
              Assumes a full page of about {TYPICAL_LEADS_PER_PAGE} leads per file. You are
              charged for the leads actually found, so part-full pages cost less.
            </p>
          ) : null}
          <ul className="divide-y divide-border">
            {items.map((item, i) => {
              const tooBig = item.file.size > maxFileBytes
              return (
                <li
                  key={`${item.file.name}-${item.file.size}`}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">
                    {item.file.name}
                  </span>

                  {item.failed ? (
                    <span className="text-sm font-medium text-danger">Failed</span>
                  ) : item.progress === 100 ? (
                    <span className="text-sm font-medium text-success">Uploaded</span>
                  ) : (
                    <span
                      className={
                        tooBig
                          ? 'text-sm tabular-nums text-danger'
                          : 'text-sm tabular-nums text-muted'
                      }
                    >
                      {formatBytes(item.file.size)}
                    </span>
                  )}

                  {!busy ? (
                    <button
                      type="button"
                      onClick={() => removeAt(i)}
                      className="text-sm font-medium text-muted transition-colors duration-150 hover:text-danger"
                      aria-label={`Remove ${item.file.name}`}
                    >
                      Remove
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {oversize.length > 0 ? (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] border border-warning/25 bg-warning-soft px-3 py-2 text-sm text-warning"
        >
          {oversize.length} file{oversize.length === 1 ? ' is' : 's are'} over the{' '}
          {formatBytes(maxFileBytes)} limit and will be rejected.
        </p>
      ) : null}

      <div className="space-y-2">
        <label htmlFor="dedupe_mode" className="block text-sm font-medium text-ink">
          Duplicate handling
        </label>
        <select
          id="dedupe_mode"
          value={dedupeMode}
          onChange={(e) => setDedupeMode(e.target.value)}
          disabled={busy}
          className={inputClass}
        >
          <option value="remove_exact">Remove exact duplicates</option>
          <option value="remove_likely">Remove likely duplicates</option>
          <option value="review">Flag duplicates for review</option>
          <option value="keep_all">Keep everything</option>
        </select>
      </div>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          disabled={busy}
          className="mt-0.5 h-4 w-4 shrink-0 rounded-[var(--radius-sm)] border-border-strong accent-[var(--accent)]"
        />
        <span className="text-sm leading-relaxed text-ink">
          I confirm I have the right to process the information contained in these
          files, and that I obtained them lawfully in accordance with applicable
          platform terms and privacy law.
        </span>
      </label>

      {message ? (
        <p
          role="alert"
          className={
            status === 'error'
              ? 'rounded-[var(--radius-md)] border border-danger/25 bg-danger-soft px-3 py-2.5 text-sm leading-relaxed text-danger'
              : 'rounded-[var(--radius-md)] border border-success/25 bg-success-soft px-3 py-2.5 text-sm leading-relaxed text-success'
          }
        >
          {message}
        </p>
      ) : null}

      <button
        type="button"
        onClick={start}
        disabled={items.length === 0 || !consent || busy}
        aria-busy={busy}
        className="inline-flex h-10 items-center justify-center rounded-[var(--radius-md)] bg-accent px-4 text-sm font-semibold text-white transition-[background-color,transform] duration-150 ease-out hover:bg-accent-deep active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === 'preparing'
          ? 'Preparing…'
          : status === 'uploading'
            ? `Uploading ${uploadedCount + 1} of ${items.length}…`
            : status === 'finalising'
              ? 'Queuing…'
              : items.length > 0
                ? `Start extraction · up to ${maxCreditCost} credit${maxCreditCost === 1 ? '' : 's'}`
                : 'Start extraction'}
      </button>
    </div>
  )
}
