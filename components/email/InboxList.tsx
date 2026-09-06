'use client'

import { useActionState } from 'react'
import Link from 'next/link'

import {
  assignThread,
  setThreadResolved,
  setThreadRead,
  type InboxActionState,
} from '@/app/(product)/email/inbox/actions'
import { INBOX_VIEWS, type InboxThread, type InboxView } from '@/lib/email/inbox-views'

function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86_400)}d ago`
}

export function InboxTabs({
  active,
  counts,
}: {
  active: InboxView
  counts: Record<InboxView, number>
}) {
  return (
    <nav aria-label="Inbox views" className="flex flex-wrap gap-1 border-b border-border">
      {INBOX_VIEWS.map((view) => {
        const isActive = view.value === active
        return (
          <Link
            key={view.value}
            href={`/email/inbox?view=${view.value}`}
            aria-current={isActive ? 'page' : undefined}
            className={
              isActive
                ? '-mb-px border-b-2 border-accent px-3 py-2 text-sm font-semibold text-ink'
                : '-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted transition-colors duration-150 hover:text-ink'
            }
          >
            {view.label}
            {counts[view.value] > 0 ? (
              <span className="ml-1.5 rounded-[var(--radius-sm)] bg-surface-muted px-1.5 py-0.5 text-xs font-medium text-muted">
                {counts[view.value]}
              </span>
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}

function ThreadRow({
  thread,
  members,
  canManage,
}: {
  thread: InboxThread
  members: { id: string; name: string }[]
  canManage: boolean
}) {
  const [readState, markRead] = useActionState<InboxActionState, FormData>(setThreadRead, null)
  const [resolveState, resolve] = useActionState<InboxActionState, FormData>(setThreadResolved, null)
  const [assignState, assign] = useActionState<InboxActionState, FormData>(assignThread, null)

  const feedback = assignState ?? resolveState ?? readState
  const assignee = members.find((m) => m.id === thread.assignedTo)

  return (
    <li className={`clay p-4 ${thread.isRead ? '' : 'border-l-2 border-accent'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={`truncate text-sm ${thread.isRead ? 'text-ink' : 'font-semibold text-ink'}`}>
              {thread.contactName ?? 'Unmatched sender'}
            </p>
            {/*
              An unmatched thread is a real reply from someone the CRM does not
              know. Saying so is better than showing a blank name, and better
              than inventing a contact.
            */}
            {thread.contactId === null ? (
              <span className="rounded-[var(--radius-sm)] bg-warning-soft px-1.5 py-0.5 text-xs font-medium text-warning">
                No contact
              </span>
            ) : null}
            {thread.lastDirection === 'inbound' && thread.status === 'open' ? (
              <span className="rounded-[var(--radius-sm)] bg-info-soft px-1.5 py-0.5 text-xs font-medium text-info">
                Needs reply
              </span>
            ) : null}
          </div>

          {/* ⚠️ The subject is now the way IN. Until R11 there was no thread
              view at all, so the inbox could triage a conversation and never
              open it. */}
          <Link
            href={`/email/inbox/${thread.id}`}
            className="mt-0.5 block truncate text-sm text-ink hover:underline"
          >
            {thread.subject ?? '(no subject)'}
          </Link>
          {thread.preview ? (
            <p className="mt-0.5 truncate text-xs text-muted">{thread.preview}</p>
          ) : null}

          <p className="mt-1 text-xs text-muted">
            {timeAgo(thread.lastMessageAt)} · {thread.messageCount}{' '}
            {thread.messageCount === 1 ? 'message' : 'messages'}
            {assignee ? ` · ${assignee.name}` : ' · unassigned'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {thread.contactId ? (
            <Link
              href={`/crm/contacts/${thread.contactId}`}
              className="rounded-[var(--radius-md)] px-2.5 py-1 text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
            >
              Contact
            </Link>
          ) : null}

          <form action={markRead}>
            <input type="hidden" name="threadId" value={thread.id} />
            <input type="hidden" name="read" value={thread.isRead ? 'false' : 'true'} />
            <button
              type="submit"
              className="rounded-[var(--radius-md)] px-2.5 py-1 text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
            >
              {thread.isRead ? 'Unread' : 'Read'}
            </button>
          </form>

          <form action={resolve}>
            <input type="hidden" name="threadId" value={thread.id} />
            <input type="hidden" name="resolved" value={thread.status === 'resolved' ? 'false' : 'true'} />
            <button
              type="submit"
              className="rounded-[var(--radius-md)] bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink transition-colors duration-150 hover:opacity-90"
            >
              {thread.status === 'resolved' ? 'Reopen' : 'Resolve'}
            </button>
          </form>

          {canManage ? (
            <form action={assign}>
              <input type="hidden" name="threadId" value={thread.id} />
              <select
                name="assignee"
                defaultValue={thread.assignedTo ?? ''}
                onChange={(event) => event.currentTarget.form?.requestSubmit()}
                aria-label="Assign to"
                className="rounded-[var(--radius-md)] border border-line bg-surface px-2 py-1 text-xs text-ink"
              >
                <option value="">Unassigned</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </form>
          ) : null}
        </div>
      </div>

      {feedback && !feedback.ok ? (
        <p className="mt-2 text-xs text-danger">{feedback.error}</p>
      ) : null}
    </li>
  )
}

export function InboxList({
  threads,
  members,
  canManage,
  nextCursor,
  view,
}: {
  threads: InboxThread[]
  members: { id: string; name: string }[]
  canManage: boolean
  nextCursor: string | null
  view: InboxView
}) {
  if (threads.length === 0) {
    return (
      <div className="clay p-10 text-center">
        <p className="text-sm font-medium text-ink">Nothing here</p>
        <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted">
          {view === 'needs_reply'
            ? 'Every conversation has been answered.'
            : view === 'unread'
              ? 'Everything has been read.'
              : 'Replies to your campaigns appear here as they arrive.'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {threads.map((thread) => (
          <ThreadRow key={thread.id} thread={thread} members={members} canManage={canManage} />
        ))}
      </ul>

      {/*
        ⚠️ A KEYSET CURSOR IN THE URL, not a page number. An inbox receives mail
        while it is being read, and with an offset a new arrival shifts every
        later row down — so "next" would re-show one thread and skip another.
      */}
      {nextCursor ? (
        <Link
          href={`/email/inbox?view=${view}&cursor=${encodeURIComponent(nextCursor)}`}
          className="clay block p-3 text-center text-sm font-medium text-ink transition-colors duration-150 hover:opacity-90"
        >
          Load older conversations
        </Link>
      ) : null}
    </div>
  )
}
