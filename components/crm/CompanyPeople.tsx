'use client'

import Link from 'next/link'
import { useId, useRef, useState } from 'react'

export type CompanyPerson = {
  id: string
  name: string | null
  jobTitle: string | null
}

/**
 * The People cell: a count that will tell you who.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ NOT HOVER-ONLY, THOUGH HOVER IS WHAT WAS ASKED FOR.                  ║
 * ║                                                                           ║
 * ║  A hover-only disclosure is unreachable by keyboard and does not exist on ║
 * ║  a touch screen — the number would simply be inert for anyone tabbing     ║
 * ║  through the table or using a phone. So the trigger is a real `<button>`: ║
 * ║  it opens on hover for a mouse, on focus for a keyboard, and on tap or    ║
 * ║  click for everyone, and clicking PINS it open so the contents can be     ║
 * ║  read and followed without keeping the pointer perfectly still.           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ NO `backdrop-filter`. CLAUDE.md now permits glass on a floating popover,
 * and its condition is the surface being neither large nor frequently
 * repainted — this one floats over a scrolling table, which is the case the
 * original rule was written for, and re-measuring scroll performance needs a
 * browser. A solid panel costs nothing and needs no measurement.
 */
export function CompanyPeople({
  companyId,
  companyName,
  count,
  preview,
}: {
  companyId: string
  companyName: string
  /** The exact total. `preview` is capped and is usually shorter. */
  count: number
  preview: CompanyPerson[]
}) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const panelId = useId()
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // A count of zero has nothing to disclose, and a button that opens an empty
  // panel is worse than plain text.
  if (count === 0) return <span className="text-muted">0</span>

  /*
   * ⚠️ A SMALL CLOSE DELAY. The panel sits below the trigger, so the pointer
   * has to cross a gap to reach it; closing on `mouseleave` immediately makes
   * the contents unreachable by mouse — the exact interaction the feature is
   * for.
   */
  const scheduleClose = () => {
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => {
      if (!pinned) setOpen(false)
    }, 120)
  }

  const cancelClose = () => clearTimeout(closeTimer.current)

  const hidden = count - preview.length

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => {
        cancelClose()
        setOpen(true)
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onFocus={() => setOpen(true)}
        onBlur={scheduleClose}
        onClick={() => {
          setPinned((was) => !was)
          setOpen(true)
        }}
        className="rounded-[var(--radius-sm)] px-1 py-0.5 text-muted underline decoration-dotted underline-offset-4 transition-colors duration-150 hover:text-ink focus-visible:text-ink"
      >
        {count}
        <span className="sr-only">
          {' '}
          {count === 1 ? 'person' : 'people'} at {companyName} — show who
        </span>
      </button>

      {open ? (
        <div
          id={panelId}
          role="group"
          aria-label={`People at ${companyName}`}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          /*
           * ⚠️ `left-0`, NOT `right-0`. People is the last column, so a panel
           * anchored to the right edge of a narrow cell overflows the table's
           * `overflow-x-auto` container and is clipped — the same class of bug
           * as the Manage menu on the pipeline board.
           */
          className="absolute left-0 top-[calc(100%+4px)] z-20 w-64 rounded-[var(--radius-lg)] border border-border bg-panel p-3 text-left shadow-[var(--shadow-lg)]"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
            At {companyName}
          </p>

          <ul className="mt-2 space-y-1.5">
            {preview.map((person) => (
              <li key={person.id}>
                <Link
                  href={`/crm/contacts/${person.id}`}
                  className="block rounded-[var(--radius-sm)] hover:underline"
                >
                  <span className="block truncate text-sm font-medium text-ink">
                    {person.name ?? 'Unnamed contact'}
                  </span>
                  {person.jobTitle ? (
                    <span className="block truncate text-xs text-muted">
                      {person.jobTitle}
                    </span>
                  ) : (
                    /*
                      ⚠️ SAYS SO RATHER THAN COLLAPSING. A row with a name and
                      no second line looks identical to one still loading, and
                      "no title recorded" is a fact about the data (rule 4).
                    */
                    <span className="block text-xs italic text-muted">
                      No job title recorded
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>

          {/*
            ⚠️ THE OVERFLOW IS STATED, NOT SILENTLY DROPPED. `count` is exact
            and `preview` is capped, so a company with forty people would
            otherwise show eight and appear to be a company with eight.
          */}
          {hidden > 0 ? (
            <Link
              href={`/crm/contacts?company=${companyId}`}
              className="mt-2 block border-t border-border pt-2 text-xs font-medium text-accent hover:underline"
            >
              {hidden} more — see all {count}
            </Link>
          ) : (
            <Link
              href={`/crm/contacts?company=${companyId}`}
              className="mt-2 block border-t border-border pt-2 text-xs font-medium text-accent hover:underline"
            >
              Open in contacts
            </Link>
          )}
        </div>
      ) : null}
    </div>
  )
}
