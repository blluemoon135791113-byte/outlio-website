import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { AddNote, AssignOwner } from '@/components/crm/ContactPanels'
import { NewTaskButton } from '@/components/crm/NewTask'
import { LocalTime, RelativeTime } from '@/components/ui/LocalTime'
import { Monogram } from '@/components/ui/Monogram'
import { threadsForContact } from '@/lib/email/inbox'
import { listContactTimeline } from '@/lib/crm/activities'
import { checkCollision } from '@/lib/crm/collision'
import { MoreDetails } from '@/components/crm/MoreDetails'
import { ValueProvenance } from '@/components/crm/ValueProvenance'
import { companyDetails, companyWebsite } from '@/lib/crm/company-details'
import { getContactDetail, listAssignableMembers } from '@/lib/crm/contacts-list'
import { citationsFor, safeSourceUrl, withProvenance } from '@/lib/crm/provenance'
import { createAdminClient } from '@/lib/supabase/admin'
import { workspaceContextIfPermitted } from '@/lib/workspaces/context'
import { can, dataScope } from '@/lib/workspaces/permissions'

/**
 * ⚠️ NAMED, NOT "Contact". Every contact tab was titled identically, so a
 * browser with four of them open showed four indistinguishable tabs and the
 * back-history was a column of the same word.
 *
 * Still `noindex` — this is a private record, and `generateMetadata` must not
 * quietly drop the robots directive the static object carried.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const ctx = await workspaceContextIfPermitted('crm.contact.view')
  /*
   * ⚠️ THE TITLE IS THE CONTACT'S NAME, SO IT IS ALSO A DISCLOSURE. Metadata is
   * rendered whatever the layout decides — a caller without CRM access would
   * otherwise read the person's name off the browser tab and the document
   * <title> while the page itself says they have no access.
   */
  if (!ctx) return { title: 'Outlio', robots: { index: false, follow: false } }

  const { id } = await params
  const contact = await getContactDetail(ctx.workspace.id, id)

  return {
    title: `${contact?.fullName ?? 'Contact'} | Outlio`,
    robots: { index: false, follow: false },
  }
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
  const ctx = await workspaceContextIfPermitted('crm.contact.view')
  // The layout renders the reason; this only stops the page computing and
  // serialising its result into the RSC payload.
  if (!ctx) return null
  const { id } = await params

  const contact = await getContactDetail(ctx.workspace.id, id)
  if (!contact) notFound()

  if (dataScope(ctx.role) === 'assigned' && contact.ownerUserId !== ctx.userId) {
    notFound()
  }

  /*
   * ⚠️ RESOLVED HERE, NOT INSIDE THE COMPONENT. One batched lookup for every
   * value on the page rather than one per address — and it keeps the
   * user_id/workspace_id seam crossing in a single place that can be reasoned
   * about, instead of scattered through JSX.
   */
  const citations = await citationsFor(ctx.scope, [
    ...contact.emails.map((e) => e.evidenceId),
    ...contact.phones.map((p) => p.evidenceId),
  ].filter((value): value is string => Boolean(value)))

  const emails = withProvenance(contact.emails, citations, contact.source)
  const phones = withProvenance(contact.phones, citations, contact.source)

  /*
   * ⚠️ BOTH GO THROUGH A VALIDATOR BEFORE REACHING AN `href`. A domain is a bare
   * host, so an unprefixed href would resolve RELATIVE to /crm/contacts and 404;
   * a `linkedin_url` was written by an importer and is attacker-influenced, so a
   * `javascript:` value there is stored XSS on a page every rep opens.
   */
  const companyUrl = companyWebsite(contact.company?.domain ?? null)
  const companyLinkedIn = safeSourceUrl(contact.company?.linkedInUrl ?? null)

  // The researched micro detail — funding, tech stack, socials, news — for the
  // company this person works at. Empty (and renders nothing) when unresearched.
  const details = await companyDetails(ctx.scope, contact.company?.sourceCompanyId ?? null)

  const policy = { role: ctx.role, modules: ctx.modules }
  const canAssign = can(policy, 'crm.contact.assign')
  const emailThreads = can({ role: ctx.role, modules: ctx.modules }, 'email.inbox.view')
    ? await threadsForContact({
        workspaceId: ctx.workspace.id,
        contactId: contact.id,
        userId: ctx.userId!,
        policy: { role: ctx.role, modules: ctx.modules },
      })
    : []

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
            {/*
              The same monogram the list row uses, so arriving here from the
              list is visibly the same person rather than a name that happens
              to match.
            */}
            <div className="flex items-start gap-3">
              <Monogram name={contact.fullName} />
              <div className="min-w-0">
                <h2 className="text-xl font-semibold tracking-[-0.025em] text-ink">
                  {contact.fullName ?? 'Unnamed contact'}
                </h2>
                {contact.jobTitle || contact.company ? (
                  <p className="mt-0.5 text-sm text-muted">
                    {contact.jobTitle}
                    {contact.jobTitle && contact.company ? ' · ' : ''}
                    {contact.company ? (
                      /*
                        Underlined rather than colour-on-hover: a link that
                        only announces itself once the pointer is on it is
                        invisible to anyone navigating by keyboard, and
                        invisible on a touch screen entirely.
                      */
                      <Link
                        href={`/crm/companies/${contact.company.id}`}
                        className="underline decoration-border decoration-dotted underline-offset-2 transition-colors duration-150 hover:text-accent hover:decoration-accent"
                      >
                        {contact.company.name}
                      </Link>
                    ) : null}
                  </p>
                ) : null}
              </div>
            </div>

            {contact.headline ? (
              <p className="mt-3 text-sm leading-relaxed text-muted">{contact.headline}</p>
            ) : null}

            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="Email">
                {emails.length === 0 ? (
                  <Missing>No email on file</Missing>
                ) : (
                  /*
                   * ⚠️ ACTIONABLE. This is the address someone came here to
                   * write to; rendering it as text made the only useful thing
                   * on the page a copy-and-paste job.
                   */
                  emails.map((e) => (
                    <span key={e.id} className="block">
                      <a
                        href={`mailto:${e.address}`}
                        className="transition-colors duration-150 hover:text-accent"
                      >
                        {e.address}
                      </a>
                      {e.isPrimary && emails.length > 1 ? (
                        <span className="ml-1 text-[10px] uppercase tracking-wide text-muted">
                          primary
                        </span>
                      ) : null}
                      {/*
                        ⚠️ EVERY VALUE CARRIES A STATEMENT ABOUT ITS ORIGIN.
                        Production holds 2,294 evidence rows and, until this
                        line, no CRM user had ever seen one. Rule 4's purpose is
                        not only that we avoid fabricating — it is that a stored
                        value can be CHECKED, and a citation nobody can reach
                        does not achieve that.
                      */}
                      <span className="mt-0.5 block">
                        <ValueProvenance provenance={e.provenance} />
                      </span>
                    </span>
                  ))
                )}
              </Field>
              <Field label="Phone">
                {phones.length === 0 ? (
                  <Missing>No phone on file</Missing>
                ) : (
                  phones.map((p) => (
                    // The raw value is DISPLAYED, not the E.164: it is what the
                    // source gave us, and a number we could not regionalize has
                    // no E.164 at all (Ledger D12). The dial link prefers the
                    // E.164 when we have one, because that is the form a phone
                    // can actually dial.
                    <span key={p.id} className="block">
                      <a
                        href={`tel:${p.e164 ?? p.raw}`}
                        className="transition-colors duration-150 hover:text-accent"
                      >
                        {p.raw}
                      </a>
                      <span className="mt-0.5 block">
                        <ValueProvenance provenance={p.provenance} />
                      </span>
                    </span>
                  ))
                )}
              </Field>
              <Field label="Location">
                {contact.location ?? <Missing>Not recorded</Missing>}
              </Field>
              {/*
                ⚠️ THE COMPANY'S FIELDS, ON THE PERSON'S PAGE. Size, site and
                company LinkedIn are part of deciding whether this lead is worth
                writing to — and they lived one click away on a page nobody
                opened mid-triage. The contact and the company stay distinct
                objects; this displays the company without becoming it.
              */}
              <Field label="Employees">
                {contact.company?.employeeCount ? (
                  String(contact.company.employeeCount)
                ) : (
                  <Missing>Company size not recorded</Missing>
                )}
              </Field>
              <Field label="Website">
                {companyUrl ? (
                  <a
                    href={companyUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="transition-colors duration-150 hover:text-accent"
                  >
                    {contact.company?.domain}
                  </a>
                ) : (
                  // The domain is still shown when it cannot be linked — a value
                  // we hold should not vanish because it would not make a URL.
                  (contact.company?.domain ?? <Missing>No website on file</Missing>)
                )}
              </Field>
              <Field label="Company LinkedIn">
                {companyLinkedIn ? (
                  <a
                    href={companyLinkedIn}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="transition-colors duration-150 hover:text-accent"
                  >
                    {contact.company?.name ?? 'Company page'}
                  </a>
                ) : (
                  <Missing>Not recorded</Missing>
                )}
              </Field>
              <Field label="Source">{contact.source.replace(/_/g, ' ')}</Field>
              <Field label="Added">
                <LocalTime iso={contact.createdAt} dateOnly />
              </Field>
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

          {/*
            ⚠️ COLLAPSED, AND BELOW THE FIELDS SOMEBODY CAME FOR. Tech stack
            alone can be forty vendor names; inline, it would push the email
            address off the screen. Renders nothing when the company has no
            researched detail, so an unresearched contact looks unchanged.
          */}
          <MoreDetails details={details} />

          {/*
            ⚠️ THE ACTIONS BELONG ON THE PERSON, not only on a separate screen.
            A task or a deal is nearly always decided while looking at whoever
            it is about; making someone leave, find the right list and come
            back is how CRM data stops getting recorded.
          */}
          <section className="clay space-y-3 p-5">
            <h3 className="text-sm font-semibold text-ink">Next step</h3>
            <div className="flex flex-wrap items-start gap-2">
              {can({ role: ctx.role, modules: ctx.modules }, 'crm.task.manage') ? (
                <NewTaskButton
                  contactId={contact.id}
                  contactName={contact.fullName ?? 'this contact'}
                />
              ) : null}
            </div>
          </section>

          {/*
            ⚠️ R15 — "THERE MUST NOT BE SEPARATE INCOMPATIBLE HISTORIES."
            A reply already reached the inbox, this contact's activity
            timeline, the flow triggers and the campaign report. The
            CONVERSATION itself was reachable from only one of them, so the CRM
            could tell you someone replied and could not show you what they
            said — which is the question anyone asks next.
          */}
          {emailThreads.length > 0 ? (
            <section className="clay space-y-3 p-5">
              <h3 className="text-sm font-semibold text-ink">Email</h3>
              <ul className="divide-y divide-line">
                {emailThreads.map((thread) => (
                  <li key={thread.id} className="py-2">
                    <Link
                      href={`/email/inbox/${thread.id}`}
                      className="text-sm font-medium text-ink hover:underline"
                    >
                      {thread.subject ?? '(no subject)'}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted">
                      {thread.messageCount}{' '}
                      {thread.messageCount === 1 ? 'message' : 'messages'}
                      {thread.status === 'resolved' ? ' · resolved' : ''}
                      {thread.lastDirection === 'inbound' ? ' · they replied last' : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

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
                    {/*
                      ⚠️ `toLocaleString()` HERE FORMATTED IN THE SERVER'S
                      TIMEZONE — Vercel runs in UTC, so an activity at 4pm in
                      Karachi read as 11am to the person it happened to. "When
                      did this happen" is the entire point of a timeline.
                    */}
                    <p className="text-xs text-muted">
                      <RelativeTime iso={entry.occurredAt} /> · {entry.channel}
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
                      <RelativeTime iso={note.createdAt} />
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

/**
 * A value we do not have.
 *
 * ⚠️ SAYS WHICH THING IS MISSING. An em dash satisfies the letter of
 * `docs/UNSUPPORTED_FIELDS.md` — the value is visibly absent, not fabricated —
 * while making every empty field on the page look identical, so "we never got
 * an email for this person" and "nobody typed a location" read as the same
 * shrug.
 */
function Missing({ children }: { children: React.ReactNode }) {
  return <span className="text-xs italic text-muted/70">{children}</span>
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
