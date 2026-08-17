/**
 * POST /api/extension/company — record a website seen on a company page.
 *
 * ⚠️ NOT A CAPTURE. No HTML arrives, no leads are created, no credit is spent
 * and the session's page count does not move. A company page yields no leads;
 * billing it as a capture would charge for nothing.
 *
 * The extension only sends this for a company page the USER opened during a
 * session they started. Nothing in this product navigates to one — see the
 * header of `extensions/adapters/salesnav-company.ts`.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { RULES, consume } from '@/lib/auth/rate-limit'
import { recordCompanyObservation } from '@/lib/extension/company-observation'
import { resolveExtensionAuth } from '@/lib/extension/auth'

export const runtime = 'nodejs'

const bodySchema = z.object({
  /** Sales Navigator's numeric company id. */
  companyId: z.string().regex(/^\d{1,20}$/),
  companyName: z.string().trim().min(1).max(200).nullable().optional(),
  /*
   * ⚠️ `z.string().url()` alone accepts `javascript:alert(1)`, and this value
   * is stored and later rendered as a link. The protocol refinement is the
   * guard — the same one that protects evidence `source_url`.
   */
  websiteUrl: z
    .string()
    .url()
    .max(2048)
    .refine((value) => {
      try {
        const protocol = new URL(value).protocol
        return protocol === 'http:' || protocol === 'https:'
      } catch {
        return false
      }
    }, 'websiteUrl must be http or https'),
})

export async function POST(request: Request) {
  const auth = await resolveExtensionAuth(request)

  if (!auth.ok) {
    return NextResponse.json({ error: auth.code }, { status: auth.status })
  }

  const { ctx, device } = auth
  const userId = ctx.userId!

  // Shares the capture bucket: a user browsing companies quickly is normal,
  // a device sending thousands of these is not.
  const limit = await consume(RULES.extensionCapture, `device:${device.id}`)
  if (!limit.allowed) {
    return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 })
  }

  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await request.json())
  } catch {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 })
  }

  try {
    const outcome = await recordCompanyObservation(userId, {
      companyId: body.companyId,
      companyName: body.companyName ?? null,
      websiteUrl: body.websiteUrl,
    })

    return NextResponse.json({
      // Honest either way: zero means the user has no leads at this company
      // yet, or they already had a website. Both are worth showing.
      leadsUpdated: outcome.leadsUpdated,
      companyUpdated: outcome.companyUpdated,
    })
  } catch {
    return NextResponse.json({ error: 'OBSERVATION_FAILED' }, { status: 500 })
  }
}
