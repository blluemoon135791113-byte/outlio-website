import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import { assertHubbleAccess } from '@/lib/auth/access'
import { toClientError } from '@/lib/errors/catalog'
import { summarizeRun } from '@/lib/hubble/summarize'
import { hubbleExecute } from '@/lib/hubble/execute'
import { getWorkspaceContext } from '@/lib/workspaces/context'
import { getRunResults } from '@/lib/intelligence/results'

/**
 * The written finding for a completed run.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  SEPARATE FROM THE POLLING ROUTE, DELIBERATELY.                          ║
 * ║                                                                          ║
 * ║  The results endpoint is polled every couple of seconds while a run is   ║
 * ║  in flight. Synthesising here would mean an LLM call on every poll — a   ║
 * ║  long run would spend dozens of them to produce the same paragraph, most ║
 * ║  of them over incomplete data. This is called ONCE, when the run is      ║
 * ║  finished and the client has the rows.                                   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
export const runtime = 'nodejs'
export const maxDuration = 60

const paramsSchema = z.object({ id: z.string().uuid() })

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  let userId: string
  let workspaceId: string
  try {
    const ctx = await assertHubbleAccess()
    userId = ctx.userId!
    // Whose metering record this summary lands against (Phase 12 item 4).
    const ws = await getWorkspaceContext()
    if (!ws?.workspace.id) throw new Error('no workspace')
    workspaceId = ws.workspace.id
  } catch (error) {
    const safe = toClientError(error)
    return NextResponse.json(safe.body, { status: safe.status })
  }

  const parsed = paramsSchema.safeParse(await context.params)
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'ERR_NOT_FOUND', message: 'That research run could not be found.' } },
      { status: 404 },
    )
  }

  try {
    /*
     * ⚠️ Scoped by userId inside `getRunResults`. Without that, any run id
     * would be summarisable by any signed-in user.
     */
    const results = await getRunResults(userId, parsed.data.id)
    if (!results) {
      return NextResponse.json(
        { error: { code: 'ERR_NOT_FOUND', message: 'That research run could not be found.' } },
        { status: 404 },
      )
    }

    /*
     * Metered door (Phase 12 item 4): the summarising model arrives as
     * `tools.llm` and `hubble_calls` records the row.
     */
    const metered = await hubbleExecute(
      'intelligence.summarize',
      { workspaceId, userId, source: 'http:summary' },
      (tools) => summarizeRun(tools.llm, results.queryText, results.rows, results.columns),
    )
    const summary = metered.ok ? metered.result : null

    /*
     * `null` is a real outcome, not an error: nothing was found, or no model
     * is configured. The panel states that in a line rather than showing a
     * blank space where a finding should be.
     */
    return NextResponse.json({ summary })
  } catch {
    // Never leak a stack, a query, or a storage path to the client.
    return NextResponse.json({ summary: null })
  }
}
