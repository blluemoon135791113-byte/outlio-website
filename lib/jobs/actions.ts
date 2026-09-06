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
/** Raw saved pages live in the uploads bucket. */
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? 'uploads'

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
   * Downloading is FREE — credits are an extraction currency only.
   *
   * Exports used to cost 1 credit. That made the advertised monthly lead
   * ceilings unreachable: a Base user has 100 credits, so 50 full batches, but
   * paying to download turned every cycle into 3 credits and cut the real
   * ceiling by a third. Extraction is where the cost is; a user must never have
   * to choose between running a batch and collecting the leads they paid for.
   *
   * Abuse is bounded by ACTION_LIMITS.export above, not by a charge.
   */

  // Signed URLs are never logged (CLAUDE.md).
  return { status: 'ready', url: signed.signedUrl }
}

/**
 * Soft-deletes a job: it leaves the history list and parks in the Trash box.
 *
 * ⚠️ NOTHING IS ERASED HERE. Leads, files and the CSV all survive; restore
 * brings the run straight back. Erasure is `deleteJobAction`, deliberately
 * separate and deliberately confirmed twice in the UI.
 */
export async function trashJobAction(
  _prev: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const ctx = await assertUser()
  const limit = await consume(ACTION_LIMITS.export, `user:${ctx.userId}`)
  if (!limit.allowed) return { status: 'error', message: 'Too many requests. Please wait and try again.' }
  const jobId = uuid.safeParse(formData.get('job_id'))
  if (!jobId.success) return { status: 'error', message: 'Missing job.' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('extraction_jobs')
    .update({ trashed_at: new Date().toISOString() })
    .eq('id', jobId.data)
    .eq('user_id', ctx.userId!)

  if (error) return { status: 'error', message: 'Could not move that run to trash.' }

  revalidatePath('/dashboard/jobs')
  return { status: 'purged', deleted: 0 }
}

/** Restores a trashed run to the history list. Nothing was erased on trash. */
export async function restoreJobAction(
  _prev: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const ctx = await assertUser()
  const limit = await consume(ACTION_LIMITS.export, `user:${ctx.userId}`)
  if (!limit.allowed) return { status: 'error', message: 'Too many requests. Please wait and try again.' }
  const jobId = uuid.safeParse(formData.get('job_id'))
  if (!jobId.success) return { status: 'error', message: 'Missing job.' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('extraction_jobs')
    .update({ trashed_at: null })
    .eq('id', jobId.data)
    .eq('user_id', ctx.userId!)

  if (error) return { status: 'error', message: 'Could not restore that run.' }

  revalidatePath('/dashboard/jobs')
  return { status: 'purged', deleted: 0 }
}

const STORAGE_REMOVE_BATCH = 50

/**
 * PERMANENTLY deletes a job: lead rows, uploaded file records, the stored
 * page files, the export CSV, and the job row itself.
 *
 * This is the only path in the workspace that erases — and it exists because
 * "free up workspace" must be available without asking support. Ownership is
 * re-verified on every step; storage paths are checked to sit inside the
 * caller's prefix before a single object is removed.
 */
export async function deleteJobAction(
  _prev: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const ctx = await assertUser()
  const limit = await consume(ACTION_LIMITS.export, `user:${ctx.userId}`)
  if (!limit.allowed) return { status: 'error', message: 'Too many requests. Please wait and try again.' }
  const jobId = uuid.safeParse(formData.get('job_id'))
  if (!jobId.success) return { status: 'error', message: 'Missing job.' }

  const supabase = createAdminClient()

  // Lead data first — the workspace-freeing part — through the same RPC the
  // purge used, so dedupe keys survive even a permanent delete.
  const { error: purgeError } = await supabase.rpc('purge_job_leads', {
    p_job_id: jobId.data,
    p_user_id: ctx.userId!,
  })
  if (purgeError) return { status: 'error', message: 'Could not clear that data. Please try again.' }

  const { data: files, error: filesError } = await supabase
    .from('uploaded_files')
    .select('storage_path')
    .eq('user_id', ctx.userId!)
    .eq('extraction_job_id', jobId.data)
  if (filesError) return { status: 'error', message: 'Could not resolve that run. Please try again.' }

  const uploadPaths = (files ?? [])
    .map((row) => row.storage_path as string)
    .filter((path) => keyBelongsToUser(path, ctx.userId!))

  const { data: job } = await supabase
    .from('extraction_jobs')
    .select('export_storage_path')
    .eq('id', jobId.data)
    .eq('user_id', ctx.userId!)
    .maybeSingle()

  const exportPath = job?.export_storage_path ?? null
  if (exportPath && !keyBelongsToUser(exportPath, ctx.userId!)) {
    return { status: 'error', message: 'That export is not available.' }
  }

  // Storage objects, batched. Best effort: a storage hiccup must not strand
  // the database rows in a half-deleted state the user cannot see.
  for (let i = 0; i < uploadPaths.length; i += STORAGE_REMOVE_BATCH) {
    await supabase.storage.from(STORAGE_BUCKET).remove(uploadPaths.slice(i, i + STORAGE_REMOVE_BATCH))
  }
  if (exportPath) {
    await supabase.storage.from(EXPORT_BUCKET).remove([exportPath])
  }

  await supabase.from('uploaded_files').delete().eq('user_id', ctx.userId!).eq('extraction_job_id', jobId.data)
  await supabase.from('job_queue').delete().eq('job_id', jobId.data)

  const { error: deleteError } = await supabase
    .from('extraction_jobs')
    .delete()
    .eq('id', jobId.data)
    .eq('user_id', ctx.userId!)
  if (deleteError) return { status: 'error', message: 'Could not delete that run. Please try again.' }

  revalidatePath('/dashboard/jobs')
  return { status: 'purged', deleted: uploadPaths.length }
}
