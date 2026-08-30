import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { AddNote, AssignOwner } from '@/components/crm/ContactPanels'
import { listContactTimeline } from '@/lib/crm/activities'
import { checkCollision } from '@/lib/crm/collision'
import { getContactDetail, listAssignableMembers } from '@/lib/crm/contacts-list'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireWorkspace } from '@/lib/workspaces/context'
import { can, dataScope } from '@/lib/workspaces/permissions'

export const metadata: Metadata = {
  title: 'Contact | Outlio',
  robots: { index: false, follow: false },
}

/**
 * Contact detail.
 *
 * ⚠️ A SETTER MAY ONLY OPEN THEIR OWN. RLS lets any member read any contact in
 * the workspace, so the scope check has to happen here — otherwise the list
 * hides other people's contacts and the URL hands them straight over.
 */
export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const ctx = await requireWorkspace()
  const { id } = await params

  const contact = await getContactDetail(ctx.workspace.id, id)
  if (!contact) notFound()

  if (dataScope(ctx.role) === 'assigned' && contact.ownerUserId !== ctx.userId) {
    notFound()
  }

  const policy = { role: ctx.role, modules: ctx.modules }
  const canAssign = can(policy, 'crm.contact.assign')
  const canEdit = can(policy, 'crm.contact.edit')

  const [timeline, members, collision, notes] = await Promise.all([
    listContactTimeline(ctx.workspace.id, id, { limit: 25 }),
    canAssign ? listAssignableMembers(ctx.workspace.id) : Promise.resolve([]),
    checkCollision(ctx.workspace.id, id, ctx.userId),
    recentNotes(ctx.workspace.id, id),
  ])

  return (
    <div className="space-y-4">
      <Link href="/crm/contacts" className="text-xs font-medium text-muted hover:text-ink">
        ← All contacts
      </Link>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          <section className="clay p-5">
            <h2 className="text-xl font-semibold tracking-[-0.025em] text-ink">
              {contact.fullName ?? 'Unnamed contact'}
            </h2>
            {contact.jobTitle || contact.company ? (
              <p className="mt-1 text-sm text-muted">
                {contact.jobTitle}
                {contact.jobTitle && contact.company ? ' · ' : ''}
                {contact.company?.name}
              </p>
            ) : null}
            {contact.headline ? (
              <p className="mt-2 text-sm leading-relaxed text-muted">{contact.headline}</p>
            ) : null}

            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="Email">
                {contact.emails.length === 0
                  ? '—'
                  : contact.emails.map((e) => (
                      <span key={e.id} className="block">
                        {e.address}
                        {e.isPrimary && contact.emails.length > 1 ? (
                          <span className="ml-1 text-[10px] uppercase tracking-wide text-muted">
                            primary
                          </span>
                        ) : null}
                      </span>
                    ))}
              </Field>
              <Field label="Phone">
                {contact.phones.length === 0
                  ? '—'
                  : contact.phones.map((p) => (
                      // The raw value is shown, not the E.164: it is what the
                      // source gave us, and a number we could not regionalize
                      // has no E.164 at all (Ledger D12).
                      <span key={p.id} className="block">
                        {p.raw}
                      </span>
                    ))}
              </Field>
              <Field label="Location">{contact.location ?? '—'}</Field>
              <Field label="Source">{contact.source.replace(/_/g, ' ')}</Field>
            </dl>

            {contact.linkedInUrl ? (
              <a
                href={contact.linkedInUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-4 inline-flex text-sm font-semibold text-accent hover:underline"
              >
                LinkedIn profile
              </a>
            ) : null}

            {contact.tags.length > 0 ? (
              <ul className="mt-4 flex flex-wrap gap-1.5">
                {contact.tags.map((tag) => (
                  <li
                    key={tag.id}
                    className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-muted"
                  >
                    {tag.name}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="clay space-y-4 p-5">
            <h3 className="text-sm font-semibold text-ink">Timeline</h3>

            {canEdit ? <AddNote contactId={contact.id} /> : null}

            {timeline.length === 0 ? (
              <p className="text-sm text-muted">
                Nothing has happened yet. Activity appears here as this contact is worked.
              </p>
            ) : (
              <ol className="space-y-3">
                {timeline.map((entry) => (
                  <li key={entry.id} className="border-l-2 border-border pl-3">
                    <p className="text-sm font-medium text-ink">
                      {entry.activityType.replace(/_/g, ' ').toLowerCase()}
                    </p>
                    <p className="text-xs text-muted">
                      {new Date(entry.occurredAt).toLocaleString()} · {entry.channel}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {notes.length > 0 ? (
            <section className="clay space-y-3 p-5">
              <h3 className="text-sm font-semibold text-ink">Notes</h3>
              <ul className="space-y-3">
                {notes.map((note) => (
                  <li key={note.id} className="border-l-2 border-border pl-3">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                      {note.body}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {new Date(note.createdAt).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          {canAssign ? (
            <AssignOwner
              contactId={contact.id}
              currentOwnerUserId={contact.ownerUserId}
              members={members}
              collision={collision}
            />
          ) : (
            <section className="clay p-4">
              <h3 className="text-sm font-semibold text-ink">Owner</h3>
              <p className="mt-1 text-sm text-muted">{contact.ownerName ?? 'Unassigned'}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.08em] text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  )
}

async function recentNotes(workspaceId: string, contactId: string) {
  const { data, error } = await createAdminClient()
    .from('crm_notes')
    .select('id, body, created_at')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) throw new Error(`recentNotes failed: ${error.message}`)
  return (data ?? []).map((n) => ({ id: n.id, body: n.body, createdAt: n.created_at }))
}
