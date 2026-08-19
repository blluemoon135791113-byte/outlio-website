import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import { assertAccess } from '@/lib/auth/access'
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
    const ctx = await assertAccess()
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
      'id, full_name, job_title, location, company_name, company_id, company_website_url, company_url, company_industry, company_size, company_employee_count',
    )
    .eq('user_id', userId)
    .eq('id', body.leadId)
    .maybeSingle()

  if (!lead) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }

  const domain = (() => {
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

  try {
    const result = await askHubble(userId, subject, body.question)

    return NextResponse.json({
      answer: result.answer,
      status: result.status,
      confidence: result.confidence,
      sources: result.sources,
      usage: result.usage,
      fromCache: result.fromCache,
    })
  } catch {
    // Never leak a stack, a query, or a storage path to the client.
    return NextResponse.json({ error: 'RESEARCH_FAILED' }, { status: 500 })
  }
}
