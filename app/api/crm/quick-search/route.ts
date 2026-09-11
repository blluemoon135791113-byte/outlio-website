import { NextResponse } from 'next/server'

import { listContacts } from '@/lib/crm/contacts-list'
import { toClientError } from '@/lib/errors/catalog'
import { assertWorkspacePermission } from '@/lib/workspaces/context'
import { dataScope } from '@/lib/workspaces/permissions'

/**
 * Lead lookup for the command palette.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  IT REUSES `listContacts` RATHER THAN QUERYING ITSELF, AND THAT IS THE     ║
 * ║  WHOLE DESIGN.                                                            ║
 * ║                                                                           ║
 * ║  That function already resolves an email match against the child table     ║
 * ║  first (PostgREST cannot OR across an embedded resource and a parent       ║
 * ║  column), already strips `%_,()` before building the `.or()` filter, and   ║
 * ║  already takes a `TenantScope` that only `scopeFor` can produce. A second  ║
 * ║  hand-rolled search here would be a second place to get filter escaping    ║
 * ║  wrong, on a string typed by a user, for no new capability.                ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ THE SETTER'S SCOPE IS RE-APPLIED HERE, NOT INHERITED FROM THE UI. A route
 * handler is reachable by typing a URL (CLAUDE.md rule 8), so a search box that
 * a setter cannot see is not a control. `dataScope` narrows them to their own
 * contacts exactly as the contacts list does.
 *
 * ⚠️ NO RATE-LIMIT BUCKET, DELIBERATELY. `consume_rate_limit` is a Postgres
 * round trip, so metering a search-as-you-type field would add a database call
 * per keystroke to defend the database against keystrokes. The control that
 * actually works is the client debounce plus the two-character floor below;
 * if abuse ever shows up in the logs, a bucket can be added then against
 * evidence rather than against a guess.
 */

/** Below this a search matches most of the book and teaches the user nothing. */
const MIN_QUERY = 2

/** Enough to choose from, few enough to read without scrolling. */
const LIMIT = 6

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await assertWorkspacePermission('crm.contact.view')

    const q = (new URL(request.url).searchParams.get('q') ?? '').trim()
    if (q.length < MIN_QUERY) {
      return NextResponse.json({ results: [] }, { headers: { 'Cache-Control': 'no-store' } })
    }

    const scopedToSelf = dataScope(ctx.role) === 'assigned'

    const page = await listContacts(ctx.scope, {
      search: q,
      ownerUserId: scopedToSelf ? ctx.userId : null,
      pageSize: LIMIT,
      page: 1,
    })

    /*
     * ⚠️ A DELIBERATELY NARROW SHAPE. The palette needs a name, a line of
     * context and somewhere to go. Returning the row would put every field the
     * list query selects into a response that fires on every keystroke, and a
     * search endpoint is the last place to widen what leaves the server.
     */
    const results = page.rows.map((row) => ({
      id: row.id,
      name: row.fullName,
      subtitle: [row.jobTitle, row.companyName].filter(Boolean).join(' · ') || null,
      href: `/crm/contacts/${row.id}`,
    }))

    return NextResponse.json(
      { results },
      {
        headers: {
          // Someone else's leads must never sit in a shared cache.
          'Cache-Control': 'no-store, private',
        },
      },
    )
  } catch (error) {
    // Never a stack trace, SQL, a storage path or an internal id to the client.
    const { status, body } = toClientError(error)
    return NextResponse.json(body, { status })
  }
}
