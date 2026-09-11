import { NextResponse } from 'next/server'

import { collectSubjectExport } from '@/lib/crm/subject-export'
import { toClientError } from '@/lib/errors/catalog'
import { assertWorkspacePermission } from '@/lib/workspaces/context'
import { dataScope } from '@/lib/workspaces/permissions'

/**
 * One subject's data, for an Art. 15 access request — §6.4.
 *
 * ⚠️ THE PERMISSION AND THE SCOPE ARE DECIDED HERE, NOT ON THE BUTTON. A route
 * handler is reachable by typing a URL, so hiding the link is not a control
 * (CLAUDE.md rule 8).
 *
 * ⚠️ JSON, NOT CSV, AND THAT IS THE REQUEST'S SHAPE RATHER THAN A PREFERENCE.
 * A CSV is one table; this is a person's contact record plus their notes,
 * activities and tasks. Flattening four shapes into one grid would either lose
 * structure or need four files.
 *
 * ⚠️ NO `sanitizeCell` HERE, DELIBERATELY. `lib/export/sanitize.ts` exists
 * because a spreadsheet interprets a leading `=` as a formula; JSON has no such
 * reading, and pre-escaping values would corrupt the very data the subject is
 * entitled to see verbatim. If this ever grows a CSV form, that form uses the
 * shared sanitizer.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    /*
     * ⚠️ GATED ON `crm.contact.view` AND NARROWED THE SAME WAY THE LIST IS. You
     * may export the person you may read; a setter is confined to the contacts
     * assigned to them. Producing a subject access file should not become the
     * one route that discloses a colleague's contact.
     */
    const ctx = await assertWorkspacePermission('crm.contact.view')
    const { id } = await params

    const scopedToSelf = dataScope(ctx.role) === 'assigned'

    const data = await collectSubjectExport(ctx.workspace.id, id)

    if (!data.contact) {
      return NextResponse.json({ error: 'That contact was not found.' }, { status: 404 })
    }

    /*
     * The ownership check happens AFTER the read and against the row we just
     * read, because "does this contact belong to me" is a fact about the row.
     * A 404 rather than a 403: whether a contact exists in someone else's book
     * is itself information.
     */
    if (scopedToSelf && data.contact.owner_user_id !== ctx.userId) {
      return NextResponse.json({ error: 'That contact was not found.' }, { status: 404 })
    }

    const stamp = new Date().toISOString().slice(0, 10)

    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="outlio-subject-data-${id}-${stamp}.json"`,
        // A subject access file must never be cached by a shared proxy.
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    // Never a stack trace, SQL, a storage path or an internal id to the client.
    const { status, body } = toClientError(error)
    return NextResponse.json(body, { status })
  }
}
