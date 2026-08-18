'use client'

/**
 * One lead, and a prompt box for asking about them.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  IT EXPANDS ONCE, THEN IT SCROLLS.                                       ║
 * ║                                                                          ║
 * ║  Empty, the modal is compact. The first answer grows it to its working   ║
 * ║  height. Every answer after that scrolls INSIDE that height — asking a   ║
 * ║  fifth question must not push the prompt box off the bottom of the       ║
 * ║  screen, which is what an ever-growing modal does.                       ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * The scope is `lead_ids` with a single id, so this is the same pipeline the
 * list uses — planned, validated, queued and billed identically. There is no
 * second, looser path for one lead.
 */
import { useEffect, useRef, useState } from 'react'

import { CompanyAvatar, PersonAvatar } from '@/components/intelligence/Avatar'
import type { HubbleLead } from '@/components/intelligence/HubbleLeadList'
import { columnLabel, renderCellValue } from '@/components/intelligence/render-value'
import { useResearchRun } from '@/components/intelligence/useResearchRun'

/** Answers already produced in this modal, newest last. */
type Answer = { question: string; runId: string }

function safeExternalUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`)
    // Rendered as a clickable link, so the scheme is a security question.
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

export function LeadModal({
  lead,
  linkedinUrl,
  modelName,
  onClose,
}: {
  lead: HubbleLead
  linkedinUrl: string | null
  modelName: string
  onClose: () => void
}) {
  const [question, setQuestion] = useState('')
  const [answers, setAnswers] = useState<Answer[]>([])
  const run = useResearchRun()

  const dialogRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  // Expanded once the first question is asked, and never contracts again —
  // a modal that resizes between answers is harder to read than a tall one.
  const expanded = answers.length > 0 || run.busy || run.phase === 'error'

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)

    // The page behind must not scroll while a modal is open.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previous
    }
  }, [onClose])

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  // A finished answer scrolls itself into view, so the user does not have to
  // hunt for what they just asked for.
  useEffect(() => {
    if (run.phase === 'done') bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
  }, [run.phase])

  const website = safeExternalUrl(lead.companyDomain)
  const linkedin = safeExternalUrl(linkedinUrl)

  const submit = () => {
    const asked = question.trim()
    if (asked.length < 3) return

    setAnswers((current) => [...current, { question: asked, runId: '' }])
    setQuestion('')
    void run.ask(asked, { type: 'lead_ids', leadIds: [lead.id] }, null)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${lead.fullName ?? 'Lead'} details`}
        tabIndex={-1}
        className={`clay-raised flex w-full max-w-xl flex-col overflow-hidden outline-none transition-[max-height] duration-200 ease-out ${
          expanded ? 'max-h-[85vh]' : 'max-h-[70vh]'
        }`}
      >
        {/* `data-lenis-prevent`: Lenis owns the page scroll and would swallow
            this container's own. See HubbleResultPanel for the full note. */}
        <div data-lenis-prevent ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <PersonAvatar name={lead.fullName} size="lg" />
              <div className="min-w-0">
                <h2 className="truncate text-2xl font-semibold tracking-[-0.02em] text-ink">
                  {lead.fullName ?? 'Unnamed lead'}
                </h2>

                <p className="mt-2 flex items-center gap-2 text-sm text-ink">
                  <Glyph label="Role">▤</Glyph>
                  <span className="truncate">{lead.jobTitle ?? 'Role not listed'}</span>
                </p>
                <p className="mt-1.5 flex items-center gap-2 text-sm text-ink">
                  <Glyph label="Company">▥</Glyph>
                  <span className="truncate">{lead.companyName ?? 'Company not listed'}</span>
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="cursor-pointer shrink-0 rounded-full px-2 py-1 text-muted transition-colors duration-150 hover:text-ink"
            >
              ✕
            </button>
          </div>

          <div className="mt-5 space-y-2.5 border-t border-clay-sunken pt-5">
            <LinkRow
              icon="◍"
              label={website ? new URL(website).hostname : 'Website not known yet'}
              href={website}
              company={lead.companyName}
              domain={lead.companyDomain}
            />
            <LinkRow icon="in" label="LinkedIn" href={linkedin} />
          </div>

          <div className="clay-sunken mt-5 p-4">
            <p className="text-sm font-medium text-ink">About this lead</p>

            {answers.length === 0 && !run.busy ? (
              <p className="mt-1.5 text-sm text-muted">
                Ask anything about this person or their company. Hubble researches only what it
                does not already hold.
              </p>
            ) : null}

            <div className="mt-3 space-y-3">
              {answers.map((answer, index) => (
                <div key={`${answer.question}-${index}`}>
                  <p className="text-xs font-medium text-muted">{answer.question}</p>

                  {/* Only the newest question has a live run behind it. */}
                  {index === answers.length - 1 ? (
                    <AnswerBody run={run} />
                  ) : (
                    <p className="mt-1 text-xs text-muted/70">Answered above.</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Pinned outside the scroll area: asking a fifth question must not
            push the prompt box off the bottom of the screen. */}
        <footer className="border-t border-clay-sunken p-4">
          <div
            className={`hubble-bar rounded-[var(--radius-clay)] bg-clay-raised shadow-[var(--clay-shadow)] ${
              run.busy ? 'hubble-generating' : ''
            }`}
          >
            <div className="flex items-center gap-2 p-2">
              <input
                type="text"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submit()
                }}
                disabled={run.busy}
                placeholder="Ask Hubble…"
                aria-label="Ask Hubble about this lead"
                className="min-w-0 flex-1 bg-transparent px-2.5 text-sm text-ink outline-none placeholder:text-muted disabled:opacity-70"
              />
              <span className="hidden shrink-0 items-center gap-1.5 rounded-[var(--radius-clay)] bg-clay-surface px-3 py-2 text-xs font-medium text-ink shadow-[var(--clay-shadow)] sm:inline-flex">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-teal" />
                {modelName}
              </span>
              <button
                type="button"
                onClick={submit}
                disabled={run.busy || question.trim().length < 3}
                aria-label="Ask"
                className="cursor-pointer clay-raised inline-flex h-10 w-10 shrink-0 items-center justify-center text-ink transition-transform duration-150 ease-out active:scale-[0.94] disabled:opacity-40"
              >
                <span aria-hidden>→</span>
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}

function AnswerBody({ run }: { run: ReturnType<typeof useResearchRun> }) {
  if (run.busy) {
    return (
      <div role="status" className="mt-2 space-y-1.5">
        {Array.from({ length: 3 }).map((_, index) => (
          <span key={index} className="block h-2.5 rounded-full bg-clay-bg" />
        ))}
        <span className="sr-only">Researching this lead</span>
      </div>
    )
  }

  if (run.phase === 'error') {
    return <p className="mt-1.5 text-sm text-danger">{run.message}</p>
  }

  if (run.phase !== 'done' || !run.results) return null

  const row = run.results.rows[0]
  if (!row) {
    return <p className="mt-1.5 text-sm text-muted">Nothing was found for this lead.</p>
  }

  return (
    <dl className="mt-2 space-y-1.5">
      {run.results.columns.map((field) => {
        const cell = row.fields[field]
        return (
          <div key={field} className="flex gap-2 text-sm">
            <dt className="w-32 shrink-0 text-muted">{columnLabel(field)}</dt>
            <dd className="min-w-0 flex-1 text-ink">
              {!cell || cell.state !== 'known' ? (
                /* Never a blank: "we could not find out" and "they do not have
                   one" are different facts. */
                <span className="text-muted/70">Unknown</span>
              ) : (
                renderCellValue(cell.value)
              )}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

function Glyph({ children, label }: { children: string; label: string }) {
  return (
    <span
      aria-hidden
      title={label}
      className="clay inline-flex h-7 w-7 shrink-0 items-center justify-center text-xs text-muted"
    >
      {children}
    </span>
  )
}

function LinkRow({
  icon,
  label,
  href,
  company,
  domain,
}: {
  icon: string
  label: string
  href: string | null
  company?: string | null
  domain?: string | null
}) {
  const content = (
    <>
      {company !== undefined ? (
        <CompanyAvatar name={company ?? null} domain={domain ?? null} size="sm" />
      ) : (
        <span
          aria-hidden
          className="clay inline-flex h-9 w-9 shrink-0 items-center justify-center text-xs font-semibold text-ink"
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{label}</span>
      {href ? (
        <span aria-hidden className="text-muted">
          ↗
        </span>
      ) : null}
    </>
  )

  // Not a link when there is nothing to open — a dead anchor is worse than
  // plain text that says the value is not known.
  if (!href) {
    return (
      <div className="clay flex items-center gap-3 px-3 py-2.5 opacity-70">
        {content}
        <span className="sr-only">not available</span>
      </div>
    )
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="cursor-pointer clay flex items-center gap-3 px-3 py-2.5 transition-transform duration-150 ease-out hover:scale-[1.005] active:scale-[0.995]"
    >
      {content}
    </a>
  )
}
