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
 * ⚠️ THIS IS THE MICRO PATH — open-ended Ask Hubble, not the batch pipeline.
 *
 * The console still does macro: batches, the fixed provider catalog, and SQL
 * aggregation across companies. Here a question is answered from retrieved web
 * evidence, so it is not limited to fields the catalog happens to name. Every
 * answer carries its sources and how far it can be trusted.
 */
import { useEffect, useRef, useState } from 'react'

import { CompanyAvatar, PersonAvatar } from '@/components/intelligence/Avatar'
import type { HubbleLead } from '@/components/intelligence/HubbleLeadList'
import {
  STATUS_CLASS,
  STATUS_HINT,
  STATUS_LABEL,
  useAskHubble,
  type AskAnswer,
  type Phase,
} from '@/components/intelligence/useAskHubble'

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
  const hubble = useAskHubble()
  const { answers, busy } = hubble

  const dialogRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  // Expanded once the first question is asked, and never contracts again —
  // a modal that resizes between answers is harder to read than a tall one.
  const expanded = answers.length > 0 || busy || hubble.error !== null

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
    if (!busy) bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
  }, [busy, answers.length])

  const website = safeExternalUrl(lead.companyDomain)
  const linkedin = safeExternalUrl(linkedinUrl)

  const submit = () => {
    const asked = question.trim()
    if (asked.length < 3 || busy) return

    setQuestion('')
    void hubble.ask(lead.id, asked)
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

            {answers.length === 0 && !busy ? (
              <p className="mt-1.5 text-sm text-muted">
                Ask anything about this person or their company. Hubble researches only what it
                does not already hold.
              </p>
            ) : null}

            <div className="mt-3 space-y-4">
              {answers.map((answer, index) => (
                <AnswerBlock key={`${answer.question}-${index}`} answer={answer} />
              ))}

              {busy ? <ResearchingSkeleton phase={hubble.phase} /> : null}

              {hubble.error ? (
                <p role="alert" className="text-sm text-danger">
                  {hubble.error}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {/* Pinned outside the scroll area: asking a fifth question must not
            push the prompt box off the bottom of the screen. */}
        <footer className="border-t border-clay-sunken p-4">
          <div
            className="hubble-bar rounded-[var(--radius-clay)] bg-clay-raised shadow-[var(--clay-shadow)]"
          >
            <div className="flex items-center gap-2 p-2">
              <input
                type="text"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submit()
                }}
                disabled={busy}
                placeholder="Ask Hubble…"
                aria-label="Ask Hubble about this lead"
                className="min-w-0 flex-1 bg-transparent px-2.5 text-sm text-ink outline-none placeholder:text-muted disabled:opacity-70"
              />
              <span className="hidden shrink-0 items-center gap-1.5 rounded-[var(--radius-clay)] bg-clay-surface px-3 py-2 text-xs font-medium text-ink shadow-[var(--clay-shadow)] sm:inline-flex">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ink" />
                {modelName}
              </span>
              <button
                type="button"
                onClick={submit}
                disabled={busy || question.trim().length < 3}
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

/**
 * The waiting state.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ A STATIC BAR FOR 40-90 SECONDS READS AS FROZEN.                      ║
 * ║                                                                          ║
 * ║  CLAUDE.md forbids entrance animation and caps motion at 150ms — both    ║
 * ║  rules are about content ARRIVING. This is the opposite case: real       ║
 * ║  network work is happening for a long time, and movement is the only     ║
 * ║  signal that the thing has not hung.                                     ║
 * ║                                                                          ║
 * ║  The phase label is the substance, though. It comes from actual server   ║
 * ║  events, so it says "Reading 4 pages" only when four pages are genuinely ║
 * ║  being fetched. A timer faking the same sequence would eventually lie,   ║
 * ║  and a user cannot tell a slow question from a dishonest one.            ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
function ResearchingSkeleton({ phase }: { phase: Phase | null }) {
  return (
    <div role="status" aria-live="polite">
      {phase ? (
        <p className="mb-2 flex items-center gap-2 text-xs text-muted">
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink" />
          <span className="font-medium text-ink">{phase.label}</span>
          {phase.detail ? <span className="truncate">· {phase.detail}</span> : null}
        </p>
      ) : null}

      <div className="space-y-1.5">
        {Array.from({ length: 3 }).map((_, index) => (
          <span key={index} className="hubble-shimmer block h-2.5 rounded-full" />
        ))}
      </div>

      {/* The visual bars mean nothing to a screen reader; the label does. */}
      <span className="sr-only">{phase?.label ?? 'Researching this lead'}</span>
    </div>
  )
}

/**
 * One question and its answer.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE STATUS AND THE SOURCES ARE NOT DECORATION.                       ║
 * ║                                                                          ║
 * ║  Someone is about to put this in an email to a stranger. An estimate     ║
 * ║  that looks like a fact is the failure this whole layer exists to        ║
 * ║  prevent, so `estimated` is coloured differently from `verified` and     ║
 * ║  says in words that it was inferred. The sources are listed so "where    ║
 * ║  did that come from?" is one click, not an act of faith.                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
function AnswerBlock({ answer }: { answer: AskAnswer }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted">{answer.question}</p>

      <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap text-ink">{answer.answer}</p>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <span
          title={STATUS_HINT[answer.status]}
          className={`inline-flex items-center rounded-[var(--radius-clay)] px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[answer.status]}`}
        >
          {STATUS_LABEL[answer.status]}
        </span>

        {/* Only shown when a real answer exists: "12% confident we found
            nothing" is noise, not information. */}
        {answer.status !== 'unknown' ? (
          <span className="text-xs text-muted">{Math.round(answer.confidence * 100)}% confidence</span>
        ) : null}

        {answer.fromCache ? (
          <span className="text-xs text-muted" title="Answered from earlier research on this company">
            · from earlier research
          </span>
        ) : answer.usage ? (
          <span className="text-xs text-muted">
            · {answer.usage.pagesFetched} page{answer.usage.pagesFetched === 1 ? '' : 's'} read
          </span>
        ) : null}

        {answer.synthesis !== 'completed' && answer.synthesis !== 'no_evidence' ? (
          <span className="text-xs text-muted">
            · answer generation incomplete
          </span>
        ) : null}
      </div>

      {answer.sources.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {answer.sources.map((source) => (
            <li key={source.url} className="truncate text-xs">
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                title={source.quote ?? undefined}
                className="text-muted underline decoration-clay-sunken underline-offset-2 transition-colors duration-150 hover:text-ink"
              >
                {source.title ?? hostOf(source.url)}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
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
