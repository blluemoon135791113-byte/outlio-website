'use client'

import { startTransition, useActionState, useState, type FormEvent } from 'react'

import {
  addContactLinksAction,
  removeContactLinkAction,
  type ContactActionState,
} from '@/lib/crm/contact-actions'
import { SOCIAL_KINDS, SOCIAL_LABEL, socialLinkText, type SocialKind } from '@/lib/crm/social-links'

const INPUT = 'w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink'
const QUIET =
  'rounded-[var(--radius-md)] px-2.5 py-1 text-xs font-medium text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-ink'

/** Rows a form may hold at once; the lead's own cap (20) is checked server-side. */
const MAX_ROWS = 10

/**
 * Repeating "kind · label · address" rows, posted as `link_kind` /
 * `link_label` / `link_url` in order (read by `socialLinksFromForm`). A row
 * left empty is ignored.
 */
export function SocialLinkFields({ initialRows = 1 }: { initialRows?: number }) {
  const [rows, setRows] = useState(() => Array.from({ length: initialRows }, (_, i) => ({ key: i, kind: 'x' as SocialKind })))
  const [next, setNext] = useState(initialRows)

  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium text-ink">Other profiles</legend>
      {rows.map((row, index) => (
        <div key={row.key} className="grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-center">
          <label className="sr-only" htmlFor={`link-kind-${row.key}`}>Link {index + 1} kind</label>
          <select
            id={`link-kind-${row.key}`}
            name="link_kind"
            value={row.kind}
            onChange={(event) => {
              const kind = event.currentTarget.value as SocialKind
              setRows((all) => all.map((r) => (r.key === row.key ? { ...r, kind } : r)))
            }}
            className={INPUT}
          >
            {SOCIAL_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {SOCIAL_LABEL[kind]}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor={`link-label-${row.key}`}>Link {index + 1} label</label>
          <input
            id={`link-label-${row.key}`}
            name="link_label"
            maxLength={40}
            placeholder={row.kind === 'other' ? 'Label, e.g. Blog' : 'Label (optional)'}
            className={INPUT}
          />
          <label className="sr-only" htmlFor={`link-url-${row.key}`}>Link {index + 1} address</label>
          <input
            id={`link-url-${row.key}`}
            name="link_url"
            type="url"
            inputMode="url"
            spellCheck={false}
            maxLength={500}
            placeholder="https://…"
            className={INPUT}
          />
          <button
            type="button"
            onClick={() => setRows((all) => all.filter((r) => r.key !== row.key))}
            className={QUIET}
            aria-label={`Remove link ${index + 1}`}
          >
            Remove
          </button>
        </div>
      ))}
      {rows.length < MAX_ROWS ? (
        <button
          type="button"
          onClick={() => {
            setRows((all) => [...all, { key: next, kind: 'website' }])
            setNext((n) => n + 1)
          }}
          className={QUIET}
        >
          + Add a link
        </button>
      ) : null}
    </fieldset>
  )
}

/**
 * `href` is computed on the SERVER with `safeSourceUrl` (http/https only) —
 * a stored address is never put in an href unchecked. `null` renders as text.
 */
export type LinkView = { id: string; kind: string; label: string | null; url: string; href: string | null }

/** A lead's links as text links. */
export function SocialLinkList({ links }: { links: LinkView[] }) {
  return (
    <>
      {links.map((link) => {
        const href = link.href
        return href ? (
          <a
            key={link.id}
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            title={link.url}
            className="mr-2 inline-block text-xs text-ink underline decoration-border decoration-dotted underline-offset-2 hover:text-accent hover:decoration-accent"
          >
            {socialLinkText(link)}
          </a>
        ) : null
      })}
    </>
  )
}

/** The contact page's "Other profiles": the list, remove, and add. */
export function ContactLinksEditor({
  contactId,
  links,
  canEdit,
}: {
  contactId: string
  links: LinkView[]
  canEdit: boolean
}) {
  /*
   * The add form is open from a click until THAT submission succeeds. The
   * state object at the time of the click is kept, so a success from an
   * earlier round does not keep the form shut.
   */
  const [openedAt, setOpenedAt] = useState<ContactActionState | null>(null)
  const [addState, addAction, addPending] = useActionState<ContactActionState, FormData>(addContactLinksAction, {
    status: 'idle',
  })
  const [removeState, removeAction, removePending] = useActionState<ContactActionState, FormData>(
    removeContactLinkAction,
    { status: 'idle' },
  )

  const submitAdd = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    startTransition(() => addAction(data))
  }

  return (
    <div className="space-y-2">
      {links.length === 0 ? (
        <p className="text-sm text-muted">No other profiles on file.</p>
      ) : (
        <ul className="space-y-1">
          {links.map((link) => {
            const href = link.href
            return (
              <li key={link.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-xs text-muted">{socialLinkText(link)}</span>
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="break-all text-ink transition-colors duration-150 hover:text-accent"
                  >
                    {link.url}
                  </a>
                ) : (
                  <span className="break-all text-ink">{link.url}</span>
                )}
                {canEdit ? (
                  <form action={removeAction}>
                    <input type="hidden" name="linkId" value={link.id} />
                    <button type="submit" disabled={removePending} className={QUIET} aria-label={`Remove ${socialLinkText(link)} link`}>
                      Remove
                    </button>
                  </form>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {removeState.status === 'error' ? (
        <p role="status" aria-live="polite" className="text-xs text-danger">{removeState.message}</p>
      ) : null}

      {canEdit ? (
        openedAt !== null && !(addState.status === 'success' && addState !== openedAt) ? (
          <form onSubmit={submitAdd} className="space-y-2" noValidate>
            <input type="hidden" name="contactId" value={contactId} />
            <SocialLinkFields />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={addPending}
                className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:bg-accent-deep disabled:opacity-60"
              >
                {addPending ? 'Saving…' : 'Save links'}
              </button>
              <button type="button" onClick={() => setOpenedAt(null)} className={QUIET}>
                Cancel
              </button>
              <p role="status" aria-live="polite" className="text-xs text-danger">
                {addState.status === 'error' ? addState.message : ''}
              </p>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setOpenedAt(addState)} className={QUIET}>
              + Add profile links
            </button>
            {openedAt !== null && addState.status === 'success' ? (
              <p role="status" aria-live="polite" className="text-xs text-muted">{addState.message}</p>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  )
}
