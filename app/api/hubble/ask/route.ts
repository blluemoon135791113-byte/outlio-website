import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import { assertHubbleAccess } from '@/lib/auth/access'
import { consume } from '@/lib/auth/rate-limit'
import { ACTION_LIMITS } from '@/lib/security/action-limits'
import { toClientError } from '@/lib/errors/catalog'
import { askHubble, type AskSubject } from '@/lib/hubble/ask'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Ask Hubble anything about one lead.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  SYNCHRONOUS ON PURPOSE, AND ONLY BECAUSE IT IS BOUNDED.                 ║
 * ║                                                                          ║
 * ║  The batch pipeline is queued because researching 300 companies takes    ║
 * ║  minutes and must survive the tab closing. ONE question about ONE lead   ║
 * ║  is capped at 90 seconds by `DEFAULT_BUDGET.maxTotalMs`, so the user     ║
 * ║  waits with a spinner rather than polling for a run id.                  ║
 * ║                                                                          ║
 * ║  ⚠️ If this ever grows past its budget, it goes on the queue. Do not     ║
 * ║  raise `maxDuration` to keep a longer job in the request path — that is  ║
 * ║  the mistake `job_queue` exists to prevent.                              ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
export const runtime = 'nodejs'
export const maxDuration = 120

const inputSchema = z.object({
  leadId: z.string().uuid(),
  question: z.string().trim().min(3).max(2000),
})

export async function POST(request: NextRequest) {
  let userId: string
  try {
    const ctx = await assertHubbleAccess()
    userId = ctx.userId!
  } catch (error) {
    const safe = toClientError(error)
    return NextResponse.json(safe.body, { status: safe.status })
  }

  /*
   * Research costs real requests to real websites. Without a limit here, one
   * user holding down enter is a crawl of the public web from our IP.
   */
  const limit = await consume(ACTION_LIMITS.research, `user:${userId}`)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: { code: 'ERR_RATE_LIMITED', message: 'Too many research requests. Please wait.' } },
      { status: 429 },
    )
  }

  let body: z.infer<typeof inputSchema>
  try {
    body = inputSchema.parse(await request.json())
  } catch {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 })
  }

  const supabase = createAdminClient()

  /*
   * ⚠️ SCOPED BY user_id. The service role bypasses RLS, so this is the access
   * control: without it, any lead id would be researchable by any user.
   */
  const { data: lead } = await supabase
    .from('extracted_leads')
    .select(
      'id, full_name, job_title, location, company_name, company_id, company_website_url, company_url, company_industry, company_size, company_employee_count, companies(domain)',
    )
    .eq('user_id', userId)
    .eq('id', body.leadId)
    .maybeSingle()

  if (!lead) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }

  /*
   * ⚠️ `companies.domain` IS THE REAL SOURCE, not the lead column.
   *
   * On production data `company_website_url` is null for all 1,074 leads,
   * while 557 of 2,094 companies already carry a domain. Reading only the
   * lead threw away every one of them. When neither has it, `askHubble`
   * discovers it and writes it back to the company.
   */
  const companyDomain = (lead.companies as unknown as { domain: string | null } | null)?.domain ?? null

  const domain =
    companyDomain ??
    (() => {
      if (!lead.company_website_url) return null
      try {
        return new URL(lead.company_website_url).hostname.replace(/^www\./, '')
      } catch {
        return null
      }
    })()

  /*
   * What the CRM already holds, as context. The model is shown this ONE lead
   * because the question is about them — never the customer's wider database.
   */
  const known = [
    lead.full_name ? `Name: ${lead.full_name}` : null,
    lead.job_title ? `Title: ${lead.job_title}` : null,
    lead.location ? `Location: ${lead.location}` : null,
    lead.company_name ? `Company: ${lead.company_name}` : null,
    domain ? `Domain: ${domain}` : null,
    lead.company_industry ? `Industry: ${lead.company_industry}` : null,
    lead.company_size ? `Size: ${lead.company_size}` : null,
    lead.company_employee_count ? `Employees: ${lead.company_employee_count}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const subject: AskSubject = {
    leadId: lead.id,
    companyId: lead.company_id,
    companyName: lead.company_name,
    domain,
    personName: lead.full_name,
    personTitle: lead.job_title,
    known,
  }

  /*
   * ╔══════════════════════════════════════════════════════════════════════════╗
   * ║  STREAMED AS NDJSON, ONE OBJECT PER LINE.                                ║
   * ║                                                                          ║
   * ║  ⚠️ THE POINT IS HONESTY, NOT DECORATION. A question takes 40-90 seconds ║
   * ║  of real network work, and a single silent POST for that long is         ║
   * ║  indistinguishable from a hang. The phases below are emitted as they     ║
   * ║  actually occur — never a timer pretending to be progress, which would   ║
   * ║  eventually claim "reading 4 pages" when nothing was fetched.            ║
   * ║                                                                          ║
   * ║  NDJSON rather than SSE: the client only needs to read lines, and the    ║
   * ║  final line is the same object the non-streaming version returned.       ║
   * ╚══════════════════════════════════════════════════════════════════════════╝
   */
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (value: unknown) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`))
        } catch {
          // The client disconnected; the research below still completes and is
          // still cached, so the work is not wasted.
        }
      }

      try {
        const result = await askHubble(userId, subject, body.question, undefined, (update) =>
          send({ type: 'progress', ...update }),
        )

        send({
          type: 'answer',
          answer: result.answer,
          status: result.status,
          confidence: result.confidence,
          sources: result.sources,
          usage: result.usage,
          fromCache: result.fromCache,
        })
      } catch {
        // Never leak a stack, a query, or a storage path to the client.
        send({ type: 'error', error: 'RESEARCH_FAILED' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      // Without this some proxies buffer the whole response and the streaming
      // is invisible — the exact problem this exists to solve.
      'x-accel-buffering': 'no',
    },
  })
}
