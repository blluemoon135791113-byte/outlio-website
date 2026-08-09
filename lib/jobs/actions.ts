'use server'

/**
 * Job actions: download the CSV, purge the data, retry a stalled job.
 */
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { assertAccess, assertUser } from '@/lib/auth/access'
import { consume } from '@/lib/auth/rate-limit'
import { ACTION_LIMITS } from '@/lib/security/action-limits'
import { keyBelongsToUser } from '@/lib/upload/storage-key'
import { createAdminClient } from '@/lib/supabase/admin'

function signedUrlTtl(): number {
  const parsed = Number.parseInt(process.env.SIGNED_URL_TTL_SECONDS ?? '60', 10)
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 3600 ? parsed : 60
}

const SIGNED_URL_TTL = signedUrlTtl()
const uuid = z.string().uuid()

/** Exports live in their own private bucket — see lib/worker/process-job.ts. */
const EXPORT_BUCKET = process.env.SUPABASE_EXPORT_BUCKET ?? 'exports'

export type JobActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'ready'; url: string }
  | { status: 'purged'; deleted: number }

/**
 * Issues a short-lived signed URL for a job's CSV.
 *
 * Ownership is re-verified against the session on every call — never trusted
 * from the form — and the stored path is checked to sit inside the caller's
 * prefix before signing.
 */
export async function getDownloadUrlAction(
  _prev: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  // Downloading is a product capability, so an expired or suspended account
  // must not be able to bypass the page guard by invoking this action directly.
  const ctx = await assertAccess()
  const limit = await consume(ACTION_LIMITS.export, `user:${ctx.userId}`)
  if (!limit.allowed) return { status: 'error', message: 'Too many requests. Please wait and try again.' }
  const jobId = uuid.safeParse(formData.get('job_id'))
  if (!jobId.success) return { status: 'error', message: 'Missing job.' }

  const supabase = createAdminClient()

  const { data: job } = await supabase
    .from('extraction_jobs')
    .select('id, export_storage_path, status')
    // Service role bypasses RLS — this scoping IS the authorization.
    .eq('id', jobId.data)
    .eq('user_id', ctx.userId!)
    .maybeSingle()

  if (!job?.export_storage_path) {
    return { status: 'error', message: 'That export is not ready yet.' }
  }

  // Defence in depth: the path must be inside this user's prefix.
  if (!keyBelongsToUser(job.export_storage_path, ctx.userId!)) {
    return { status: 'error', message: 'That export is not available.' }
  }

  const { data: signed, error } = await supabase.storage
    .from(EXPORT_BUCKET)
    .createSignedUrl(job.export_storage_path, SIGNED_URL_TTL, {
      download: `outlio-leads-${jobId.data.slice(0, 8)}.csv`,
    })

  if (error || !signed?.signedUrl) {
    return { status: 'error', message: "We couldn't build your export. Please try again." }
  }

  /*
   * Spend the export credit only after Storage proves it can sign the object.
   * The URL remains server-local until the credit succeeds, so a failed charge
   * never discloses it and a signing outage never consumes a user's credit.
   */
  const { data: remainingRaw, error: creditError } = await supabase.rpc(
    'consume_credit',
    {
      p_user_id: ctx.userId!,
      p_amount: 1,
    },
  )

  if (creditError || typeof remainingRaw !== 'number') {
    return { status: 'error', message: "We couldn't verify your credits. Please try again." }
  }

  if (remainingRaw < 0) {
    return {
      status: 'error',
      message:
        "You're out of credits for this month. Upgrade your plan or wait for the reset.",
    }
  }

  // Signed URLs are never logged (CLAUDE.md).
  return { status: 'ready', url: signed.signedUrl }
}

/**
 * Purges a job's lead rows once the user has their CSV.
 *
 * The dedupe keys survive in `lead_keys`, so duplicate detection across future
 * uploads still works while the personal data genuinely disappears.
 */
export async function purgeJobAction(
  _prev: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const ctx = await assertUser()
  const limit = await consume(ACTION_LIMITS.export, `user:${ctx.userId}`)
  if (!limit.allowed) return { status: 'error', message: 'Too many requests. Please wait and try again.' }
  const jobId = uuid.safeParse(formData.get('job_id'))
  if (!jobId.success) return { status: 'error', message: 'Missing job.' }

  const supabase = createAdminClient()

  const { data, error } = await supabase.rpc('purge_job_leads', {
    p_job_id: jobId.data,
    p_user_id: ctx.userId!,
  })

  if (error) {
    return { status: 'error', message: "We couldn't clear that data. Please try again." }
  }

  revalidatePath('/dashboard/jobs')
  return { status: 'purged', deleted: typeof data === 'number' ? data : 0 }
}
