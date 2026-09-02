import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { NewOpportunityForm } from '@/components/crm/NewOpportunity'
import { ReplyComposer } from '@/components/email/ReplyComposer'
import { LocalTime } from '@/components/ui/LocalTime'
import { defaultPipeline } from '@/lib/crm/opportunities'
import { getThread, replyableMessageId } from '@/lib/email/inbox'
import { requireWorkspace } from '@/lib/workspaces/context'
import { can } from '@/lib/workspaces/permissions'

export const metadata: Metadata = {
  title: 'Conversation | Outlio',
  robots: { index: false, follow: false },
}

const CLASSIFICATION_LABEL: Record<string, string> = {
  reply: 'Reply',
  auto_reply: 'Automatic reply',
  bounce: 'Bounce',
}

/**
 * One conversation — R11.
 *
 * The inbox could list, assign and resolve threads and could not open one. So
 * answering meant leaving Outlio, and the reply became invisible to the CRM
 * timeline and every report built on it.
 */
export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireWorkspace()
  const { id } = await params

  const detail = await getThread({
    workspaceId: ctx.workspace.id,
    userId: ctx.userId!,
    policy: { role: ctx.role, modules: ctx.modules },
    threadId: id,
  })

  /*
   * ⚠️ NOT-FOUND COVERS BOTH REASONS ON PURPOSE. A thread in another workspace
   * and a thread this setter is not assigned look identical from here —
   * distinguishing them would confirm the thread exists.
   */
  if (!detail) notFound()

  /*
   * Only offered when there is somewhere for the deal to go. Showing the form
   * with no pipeline would fail on submit and teach someone the feature is
   * broken, when the real answer is "set up a pipeline first".
   */
  const canCreateDeal = can(
    { role: ctx.role, modules: ctx.modules },
    'crm.opportunity.create',
  )
  const pipeline = canCreateDeal ? await defaultPipeline(ctx.workspace.id) : null

  const latestInbound = [...detail.messages]
    .reverse()
    .find((m) => m.classification === 'reply')

  return (
    <div className="space-y-4">
      <div>
        <Link href="/email/inbox" className="text-xs text-muted hover:text-ink">
          ← Inbox
        </Link>
        <h2 className="mt-1 text-base font-semibold tracking-[-0.02em] text-ink">
          {detail.thread.subject ?? '(no subject)'}
        </h2>
        <p className="mt-0.5 text-sm text-muted">
          {detail.thread.contactName ?? 'Unknown contact'}
          {detail.thread.status === 'resolved' ? ' · Resolved' : ''}
        </p>
      </div>

      <ol className="space-y-3">
        {detail.messages.map((message) => (
          <li key={message.id} className="clay p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-ink">{message.fromEmail}</span>
              <span className="text-xs text-muted">
                {/*
                  Auto-replies and bounces are labelled rather than hidden. They
                  are part of what happened, and a thread that silently omits a
                  bounce reads as "no answer" when the truth is "undeliverable".
                */}
                {CLASSIFICATION_LABEL[message.classification] ?? message.classification} ·{' '}
                {/*
                  ⚠️ FORMATTED IN THE READER'S TIMEZONE, not the server's.
                  `toLocaleString()` in a Server Component uses the SERVER's
                  locale and zone — Vercel runs in UTC, so a reply that arrived
                  at 4pm in Karachi rendered as 11am to the person who received
                  it. "When did they reply" is the question an inbox exists to
                  answer.
                */}
                <LocalTime iso={message.receivedAt} />
              </span>
            </div>

            {message.bodyText ? (
              /*
                ⚠️ RENDERED AS TEXT, NEVER AS HTML. This content came from
                outside and the constitution forbids putting it through
                dangerouslySetInnerHTML — `whitespace-pre-wrap` keeps the
                formatting without executing anything.
              */
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted">
                {message.bodyText}
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted">No text content.</p>
            )}
          </li>
        ))}
      </ol>

      {/*
        ⚠️ R15 — THIS IS THE LINK TO REVENUE. A reply is the moment a
        conversation becomes a deal, and until now the only way to record that
        was to leave the inbox, find the contact, find the board, and remember
        what the reply said. Most of the time nobody did, so the pipeline
        under-reported and the campaign that produced the deal got no credit.
      */}
      {canCreateDeal && pipeline && detail.thread.contactId ? (
        <section className="clay p-4">
          <h3 className="text-sm font-semibold text-ink">Turn this into a deal</h3>
          <p className="mt-0.5 mb-3 text-xs text-muted">
            Creates it against {detail.thread.contactName ?? 'this contact'}, so the
            campaign that started the conversation keeps the credit.
          </p>
          <NewOpportunityForm
            pipelineId={pipeline.id}
            stages={pipeline.stages}
            fixedContact={{
              id: detail.thread.contactId,
              name: detail.thread.contactName ?? 'this contact',
            }}
          />
        </section>
      ) : null}

      {can({ role: ctx.role, modules: ctx.modules }, 'email.inbox.manage') && latestInbound ? (
        <section className="clay p-4">
          <ReplyComposer
            threadId={detail.thread.id}
            toEmail={latestInbound.fromEmail}
            canThread={replyableMessageId(latestInbound.providerMessageId) !== null}
          />
        </section>
      ) : null}
    </div>
  )
}
