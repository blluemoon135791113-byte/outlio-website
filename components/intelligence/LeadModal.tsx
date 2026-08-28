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

import { PersonAvatar } from '@/components/intelligence/Avatar'
import type { HubbleLead } from '@/components/intelligence/HubbleLeadList'
import {
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
  onResearchComplete,
  onClose,
}: {
  lead: HubbleLead
  linkedinUrl: string | null
  onResearchComplete: (answer: AskAnswer) => void
  onClose: () => void
}) {
  const [question, setQuestion] = useState('')
  const hubble = useAskHubble(onResearchComplete)
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
  const email = lead.workEmail?.trim() || null
  const phone = lead.mobilePhone?.trim() || null
  // What the closed strip reports. Counting the VALUES, not the rows, so
  // "2 of 4" never includes a row that only says "not found yet".
  const emailHref = email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? `mailto:${email}`
    : null
  const phoneHref = phone && /^\+?[\d().\s-]{8,}$/.test(phone)
    ? `tel:${phone.replace(/[^+\d]/g, '')}`
    : null
  const salesNav = safeExternalUrl(lead.salesNavigatorUrl)
  const companyPage = safeExternalUrl(lead.companyUrl)

  /*
   * ⚠️ EVERY CAPTURED FIELD THAT HAS A VALUE, AND NOTHING THAT DOES NOT.
   *
   * The modal used to render a fixed four rows, so a lead with a Sales
   * Navigator URL but no public profile showed "LinkedIn not available" while
   * the export carried the link. Rows are now built from what exists.
   */
  const links = [
    { label: 'Website', value: website ? new URL(website).hostname : null, href: website },
    { label: 'Company page', value: companyPage ? new URL(companyPage).hostname : null, href: companyPage },
    { label: 'LinkedIn profile', value: linkedin ? 'View profile' : null, href: linkedin },
    { label: 'Sales Navigator', value: salesNav ? 'View lead' : null, href: salesNav },
  ].filter((row) => row.href)

  const contacts = [
    { label: 'Email', value: email, href: emailHref, status: lead.emailStatus },
    { label: 'Phone', value: phone, href: phoneHref, status: lead.phoneStatus },
  ].filter((row) => row.value)

  /* Captured from the saved page; not researched, so never a "not found". */
  const captured = [
    { label: 'Location', value: lead.companyLocation },
    { label: 'Time in role', value: lead.tenureInRole },
    { label: 'Time at company', value: lead.tenureInCompany },
    { label: 'Summary', value: lead.personBlurb },
  ].filter((row) => row.value)

  const foundCount = links.length + contacts.length

  // The last question asked, for ↑ recall. Derived from the answers already
  // held rather than stored separately, so it survives a re-render and can
  // never drift out of step with what was actually asked.
  const lastAsked = answers.length > 0 ? answers[answers.length - 1]!.question : null

  /*
   * Openers, named after THIS lead so they read as questions about a person
   * rather than product chrome. Kept to two: a starter row that needs
   * scanning is another decision, not fewer.
   */
  const subject = lead.companyName ?? lead.fullName ?? 'this company'
  const starters = [
    `What does ${subject} do?`,
    'Who would buy from them?',
  ]

  const submit = () => {
    const asked = question.trim()
    if (asked.length < 3 || busy) return

    setQuestion('')
    void hubble.ask(lead.id, asked)
  }

  return (
    <div
      className="glass-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
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
        className={`skeuo flex w-full max-w-xl flex-col overflow-hidden outline-none transition-[max-height] duration-200 ease-out ${
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

                <p className="mt-2.5 flex items-center gap-2.5 text-sm text-ink">
                  <Glyph label="Role">▤</Glyph>
                  <span className="truncate">{lead.jobTitle ?? 'Role not listed'}</span>
                </p>
                <p className="mt-2 flex items-center gap-2.5 text-sm text-ink">
                  <Glyph label="Company">▥</Glyph>
                  <span className="truncate">{lead.companyName ?? 'Company not listed'}</span>
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="cursor-pointer shrink-0 rounded-full px-2 py-1 text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
            >
              Close
            </button>
          </div>

          {/*
           * ⚠️ COLLAPSED BY DEFAULT, AND THE STRIP STILL ANSWERS THE QUESTION.
           *
           * Four always-open rows pushed the prompt box down the modal. But a
           * strip that only said "Contact details" would force a click to
           * learn there is nothing behind it, which is worse than the space it
           * saves. So the closed state carries the COUNT of what was actually
           * found — the user opens it because something is there, not to check.
           */}
          {/*
           * ⚠️ PLAIN TEXT, NO GLYPHS.
           *
           * These rows carried ◍ @ ☎ "in" as icons and › as a marker. A symbol
           * only works if its meaning is obvious to everyone, and these were
           * not — "◍" for a website is a private joke. Words say it once.
           */}
          <details className="skeuo-inset group mt-5 overflow-hidden">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm font-medium text-ink transition-transform duration-150 ease-out active:scale-[0.99] [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 flex-1">Contact and links</span>
              <span className="text-xs font-normal text-muted">
                {foundCount > 0 ? `${foundCount} found` : 'none found'}
              </span>
              {/* A disclosure chevron, matching "Saved research". Unlike the
                  glyphs that were removed, this one is a universal affordance
                  and needs no decoding. */}
              <span aria-hidden className="text-muted transition-transform duration-150 group-open:rotate-90">
                ›
              </span>
            </summary>

            <div className="space-y-2 border-t border-clay-sunken p-3">
              {foundCount === 0 ? (
                <p className="px-1 py-2 text-sm text-muted">
                  No contact details or links were found for this lead yet.
                </p>
              ) : null}

              {links.map((row) => (
                <DetailLink key={row.label} label={row.label} value={row.value!} href={row.href!} />
              ))}

              {contacts.map((row) => (
                <DetailLink
                  key={row.label}
                  label={row.label}
                  value={row.value!}
                  href={row.href}
                  status={row.status}
                />
              ))}
            </div>
          </details>

          {/*
           * Captured from the saved page rather than researched, so a missing
           * value here is simply absent — it is never a "not found".
           */}
          {captured.length > 0 ? (
            <details className="skeuo-inset group mt-4 overflow-hidden">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm font-medium text-ink transition-transform duration-150 ease-out active:scale-[0.99] [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1">From the saved page</span>
                <span className="text-xs font-normal text-muted">{captured.length}</span>
                <span aria-hidden className="text-muted transition-transform duration-150 group-open:rotate-90">
                  ›
                </span>
              </summary>
              <div className="space-y-2 border-t border-clay-sunken p-3">
                {captured.map((row) => (
                  <div key={row.label} className="skeuo-key px-3 py-2.5">
                    <p className="text-xs font-medium text-muted">{row.label}</p>
                    <p className="mt-1 text-sm leading-relaxed text-ink">{row.value}</p>
                  </div>
                ))}
              </div>
            </details>
          ) : null}

          {/*
           * ⚠️ ALWAYS RENDERED, EVEN AT ZERO.
           *
           * This used to be hidden entirely when a lead had no saved details,
           * which made the strip look like it had been REMOVED rather than
           * like the lead had nothing in it yet — the two are different facts
           * and the modal has to keep them apart. Disabled and labelled beats
           * absent.
           */}
          {lead.savedDetails.length === 0 ? (
            <div className="skeuo-inset mt-4 flex items-center gap-3 px-4 py-3 text-sm text-muted">
              <span className="skeuo-key inline-flex h-8 w-8 shrink-0 items-center justify-center text-xs text-muted">
                +
              </span>
              <span className="min-w-0 flex-1">Saved research</span>
              <span className="text-xs">nothing saved yet</span>
            </div>
          ) : (
            <details className="skeuo-inset group mt-4 overflow-hidden">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm font-medium text-ink transition-transform duration-150 ease-out active:scale-[0.99] [&::-webkit-details-marker]:hidden">
                <span className="skeuo-key inline-flex h-8 w-8 shrink-0 items-center justify-center text-xs text-muted">
                  +
                </span>
                <span className="min-w-0 flex-1">Saved research</span>
                <span className="text-xs font-normal text-muted">
                  {lead.savedDetails.length}
                </span>
                <span aria-hidden className="text-muted transition-transform duration-150 group-open:rotate-90">
                  ›
                </span>
              </summary>

              <div className="max-h-72 space-y-2 overflow-y-auto border-t border-clay-sunken p-3">
                {lead.savedDetails.map((detail) => (
                  <SavedDetailRow key={detail.id} detail={detail} />
                ))}
              </div>
            </details>
          )}

          {/*
           * ⚠️ NO PANEL UNTIL THERE IS SOMETHING IN IT.
           *
           * This used to be an "About this lead" box holding a heading and a
           * line telling the user they could ask a question. Both were dead
           * weight: the prompt bar below already says "Ask Hubble…", so the
           * panel spent its space restating the control directly beneath it,
           * and on an unresearched lead it rendered as an empty container.
           *
           * Answers, progress and errors still land here — the container just
           * does not exist before they do.
           */}
          {answers.length > 0 || busy || hubble.error ? (
            <div className="skeuo-inset mt-5 space-y-4 p-4">
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
          ) : null}
        </div>

        {/* Pinned outside the scroll area: asking a fifth question must not
            push the prompt box off the bottom of the screen. */}
        <footer className="border-t border-clay-sunken p-4">
          {/*
           * ⚠️ THREE AFFORDANCES, AND NO MORE.
           *
           * 1. STARTERS — an empty box is the hardest prompt to answer. Two
           *    lead-specific openers turn a blank stare into one click. They
           *    disappear once a conversation exists.
           * 2. HISTORY (↑) — research is iterative: you ask, read, and ask a
           *    near-identical question. Retyping it is the most common thing
           *    a researcher does by hand.
           * 3. ⌘↵ HINT — the shortcut already worked and nothing said so.
           *
           * A STOP BUTTON WAS DELIBERATELY NOT ADDED. `useAskHubble` cancels
           * the reader but lets the server finish on purpose, so a stop
           * control would claim to abort work that keeps running and keeps
           * costing. A button that lies is worse than no button.
           */}
          {answers.length === 0 && !busy ? (
            <div className="mb-2.5 flex flex-wrap gap-2">
              {starters.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  onClick={() => setQuestion(starter)}
                  className="cursor-pointer skeuo-key skeuo-key-interactive px-3 py-1.5 text-xs text-muted"
                >
                  {starter}
                </button>
              ))}
            </div>
          ) : null}

          <div className="hubble-bar skeuo-prompt">
            <div className="flex items-center gap-2 p-2">
              <input
                type="text"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    submit()
                    return
                  }
                  // ↑ on an empty box recalls the last question asked, the way
                  // a shell recalls the last command.
                  if (event.key === 'ArrowUp' && question.length === 0 && lastAsked) {
                    event.preventDefault()
                    setQuestion(lastAsked)
                  }
                }}
                disabled={busy}
                placeholder="Ask Hubble…"
                aria-label="Ask Hubble about this lead"
                aria-describedby="ask-hint"
                className="min-w-0 flex-1 bg-transparent px-2.5 text-sm text-ink outline-none placeholder:text-muted disabled:opacity-70"
              />
              <span
                id="ask-hint"
                className="hidden shrink-0 pr-1 text-[11px] font-medium text-muted sm:inline"
              >
                {question.length === 0 && lastAsked ? '↑ last' : '⌘↵'}
              </span>
              <button
                type="button"
                onClick={submit}
                disabled={busy || question.trim().length < 3}
                aria-label="Ask"
                className="cursor-pointer skeuo-send skeuo-key-interactive inline-flex h-10 w-10 shrink-0 items-center justify-center disabled:opacity-40"
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
  /*
   * ⚠️ ONLY SHOWN WHEN IT CHANGES WHAT THE USER SHOULD DO.
   *
   * `verified` and `corroborated` need no label — the sources below say it,
   * and a green chip on every answer trains people to stop reading chips.
   * `estimated` and `unknown` DO change how someone acts on the sentence they
   * just read, so they are stated in words (CLAUDE.md rule 4).
   */
  const caveat =
    answer.status === 'estimated'
      ? 'Estimated — inferred from the sources below, not stated by them.'
      : answer.status === 'unknown'
        ? answer.sources.length > 0
          ? 'Some requested details were not confirmed; use only the cited claims.'
          : 'No supporting source was found.'
        : null

  return (
    <div>
      <p className="text-xs font-medium text-muted">{answer.question}</p>

      <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap text-ink">{answer.answer}</p>

      {caveat ? <p className="mt-1.5 text-xs text-muted">{caveat}</p> : null}

      {/*
        Sources stay. They are not decoration: they are how a reader checks a
        claim before putting it in an email, and the one thing that makes
        "never present a guess as fact" verifiable rather than a promise.
      */}
      {answer.sources.length > 0 ? (
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          {answer.sources.map((source, index) => (
            <span key={source.url}>
              {index > 0 ? ', ' : ''}
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="underline decoration-clay-sunken underline-offset-2 transition-colors duration-150 hover:text-ink"
              >
                {hostOf(source.url)}
              </a>
            </span>
          ))}
        </p>
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
      className="skeuo-key inline-flex h-7 w-7 shrink-0 items-center justify-center text-xs text-muted"
    >
      {children}
    </span>
  )
}


/**
 * One labelled value.
 *
 * ⚠️ PLAIN TEXT, NOT GLYPHS. The rows this replaces used ◍ for a website, @
 * for email, ☎ for phone and "in" for LinkedIn. A symbol earns its place only
 * when its meaning is obvious to everyone; these were guesses the reader had
 * to decode. A word costs a few pixels and no thought.
 */
function DetailLink({
  label,
  value,
  href,
  status,
}: {
  label: string
  value: string
  href?: string | null
  status?: string | null
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-muted">{label}</span>
        <span className="mt-0.5 block truncate text-sm text-ink">{value}</span>
      </span>
      {status ? (
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted">
          {statusLabel(status)}
        </span>
      ) : null}
      {href ? <span className="shrink-0 text-[11px] text-muted">Open</span> : null}
    </>
  )

  if (!href) {
    return <div className="skeuo-key flex items-center gap-3 px-3 py-2.5">{body}</div>
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="cursor-pointer skeuo-key skeuo-key-interactive flex items-center gap-3 px-3 py-2.5"
    >
      {body}
    </a>
  )
}

function statusLabel(value: string | null): string | null {
  if (!value) return null
  return value
    .replace(/_/g, ' ')
    .replace(/^./, (letter) => letter.toUpperCase())
}


/**
 * One saved fact or answer.
 *
 * ⚠️ IT USED TO CUT THE TEXT OFF WITH NO WAY BACK. Facts were `truncate` and
 * answers `line-clamp-3`, so anything longer than the row simply ended — no
 * control, no indication there was more. A value the user paid to research was
 * silently unreadable.
 *
 * Long values now expand, with a chevron that rotates to say so. The toggle
 * only appears when the text is actually long enough to be clipped, so short
 * facts do not carry a control that does nothing.
 */
function SavedDetailRow({ detail }: { detail: HubbleLead['savedDetails'][number] }) {
  const source = safeExternalUrl(detail.sourceUrl)
  const [expanded, setExpanded] = useState(false)

  // Length-based rather than measured: deterministic, and it cannot disagree
  // with itself between renders the way a layout measurement can.
  const clippable = detail.kind === 'answer' ? detail.value.length > 150 : detail.value.length > 48

  return (
    <div className="skeuo-key px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-muted">{detail.label}</p>
        {detail.status ? (
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted">
            {statusLabel(detail.status)}
          </span>
        ) : null}
      </div>

      {clippable ? (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="mt-1 flex w-full cursor-pointer items-start gap-2 text-left"
        >
          <span
            className={
              expanded
                ? 'min-w-0 flex-1 text-sm leading-relaxed text-ink'
                : `min-w-0 flex-1 text-sm text-ink ${detail.kind === 'answer' ? 'line-clamp-3 leading-relaxed' : 'truncate'}`
            }
          >
            {detail.value}
          </span>
          <span
            aria-hidden
            className={`mt-0.5 shrink-0 text-[10px] text-muted transition-transform duration-150 ${
              expanded ? 'rotate-180' : ''
            }`}
          >
            ▾
          </span>
          <span className="sr-only">{expanded ? 'Show less' : 'Show full value'}</span>
        </button>
      ) : (
        <p className="mt-1 text-sm leading-relaxed text-ink">{detail.value}</p>
      )}
      {source ? (
        <a
          href={source}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="mt-1 inline-block text-[11px] text-muted underline decoration-clay-sunken underline-offset-2 hover:text-ink"
        >
          View source · {hostOf(source)}
        </a>
      ) : null}
    </div>
  )
}
