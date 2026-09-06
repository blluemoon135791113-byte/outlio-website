import { NextResponse } from 'next/server'

import {
  ContactExportTooLargeError,
  collectContactsForExport,
  contactsToCsv,
  isContactExportKind,
} from '@/lib/crm/contact-export'
import { toClientError } from '@/lib/errors/catalog'
import { assertWorkspacePermission } from '@/lib/workspaces/context'
import { dataScope } from '@/lib/workspaces/permissions'

/**
 * Contact download.
 *
 * ⚠️ THE PERMISSION AND THE SCOPE ARE BOTH DECIDED HERE, NOT ON THE BUTTON. A
 * route handler is reachable by typing a URL, so hiding the link would be no
 * control at all (CLAUDE.md rule 8).
 *
 * ⚠️ "EXPORT YOUR OWN CONTACTS" IS ENFORCED BY THE QUERY. The gate is
 * `crm.contact.view` — you may export what you may read — and `dataScope`
 * narrows a setter or a viewer to the contacts assigned to them. A manager
 * gets the workspace because a manager can already read the workspace. No new
 * data becomes visible through this route; it changes the format, not the
 * audience.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const requested = url.searchParams.get('kind')
  const kind = isContactExportKind(requested) ? requested : 'crm'

  try {
    const ctx = await assertWorkspacePermission('crm.contact.view')

    const scopedToSelf = dataScope(ctx.role) === 'assigned'
    const rows = await collectContactsForExport(ctx.workspace.id, {
      kind,
      ownerUserId: scopedToSelf ? ctx.userId : null,
    })

    const csv = contactsToCsv(rows, kind)
    const stamp = new Date().toISOString().slice(0, 10)
    const name = kind === 'marketing' ? 'outlio-email-list' : 'outlio-contacts'

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}-${stamp}.csv"`,
        // A contact list changes constantly; a cached export is a wrong one,
        // and it is personal data that must not sit in a shared cache.
        'Cache-Control': 'no-store, private',
      },
    })
  } catch (error) {
    if (error instanceof ContactExportTooLargeError) {
      return NextResponse.json({ error: { message: error.message } }, { status: 413 })
    }
    // Never a stack trace, SQL, a storage path or an internal id to the client.
    const { status, body } = toClientError(error)
    return NextResponse.json(body, { status })
  }
}
