import 'server-only'

/**
 * Captured page → the EXISTING extraction pipeline.
 *
 * This file is a bridge, not a second scraper. A page captured by the
 * extension takes exactly the same road as an uploaded HTML file:
 *
 *   validateFileBytes()   same content sniffing, same size limits
 *   createExtractionJob() same storage key scheme, same rows
 *   finalize_upload_job() same credit pre-flight, same queue insert
 *   processJob()          same parser, same charge, same dedupe, same CSV
 *
 * The ONLY difference is that extraction_jobs.capture_session_id is set. If
 * you find yourself adding parsing logic here, something has gone wrong — the
 * whole point is that there is one scraper engine, not two.
 */
import { after } from 'next/server'

import { AppError } from '@/lib/errors/catalog'
import { claimAndProcessJob } from '@/lib/worker/process-job'
import { maxUploadFileBytes } from '@/lib/upload/limits'
import { createExtractionJob, validateFileBytes } from '@/lib/upload/process'
import { createAdminClient } from '@/lib/supabase/admin'

export type IngestOutcome = {
  jobId: string
  /** Queued for processing. Counts arrive over Realtime as the worker runs. */
  queued: boolean
}

/**
 * Validates captured HTML and enqueues it as a single-file extraction job.
 *
 * Rejections use the same catalog codes the uploader returns, so the popup and
 * the dashboard describe a malformed page identically.
 */
export async function ingestCapturedPage(input: {
  userId: string
  captureSessionId: string
  pageId: string
  html: string
  pageIdentifier: string | null
}): Promise<IngestOutcome> {
  const bytes = new TextEncoder().encode(input.html)

  // Step 1: identical validation to an uploaded file, including the 4 KB
  // content sniff. A page that would have been rejected as a file is rejected
  // here for the same reason.
  const displayName = input.pageIdentifier
    ? `capture-${input.pageIdentifier}.html`
    : 'capture.html'

  const validated = validateFileBytes(displayName, 'text/html', bytes, maxUploadFileBytes())

  if ('code' in validated) {
    throw new AppError(validated.code, `capture rejected: ${validated.message}`)
  }

  // Step 2: same job creation, same server-generated storage key.
  const { jobId } = await createExtractionJob(
    input.userId,
    [validated],
    'remove_exact',
    input.captureSessionId,
  )

  // Link the page row to its job before anything can process it, so a crash
  // between here and the queue still leaves a traceable record.
  const admin = createAdminClient()
  await admin
    .from('capture_pages')
    .update({ extraction_job_id: jobId, status: 'queued' })
    .eq('id', input.pageId)
    .eq('user_id', input.userId)

  // Step 3: same finalisation — credit pre-flight, usage counters and the
  // queue insert in one transaction.
  const { data: finalizeStatus, error } = await admin.rpc('finalize_upload_job', {
    p_job_id: jobId,
    p_user_id: input.userId,
  })

  if (error) {
    throw new AppError('ERR_INTERNAL', 'capture finalize failed')
  }

  if (finalizeStatus === 'insufficient_credits') {
    throw new AppError('ERR_LIMIT_REACHED', 'no extraction credits left')
  }

  if (!['ok', 'already_finalized'].includes(finalizeStatus as string)) {
    throw new AppError('ERR_INTERNAL', `capture finalize returned ${finalizeStatus}`)
  }

  // Step 4: same trigger the uploader uses. The job is durable in the queue
  // first, so a missed wake-up is recovered by the reaper rather than lost.
  after(async () => {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await claimAndProcessJob(jobId, input.userId, `capture:${jobId}:${attempt}`)
        return
      } catch {
        // One retry inside this wake-up; the reaper is the durable backstop.
      }
    }
  })

  return { jobId, queued: true }
}
