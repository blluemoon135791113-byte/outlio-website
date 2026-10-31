import 'server-only'

/**
 * Starts uploads whose browser never sent the start request.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ ONLY WHEN EVERY FILE HAS ARRIVED, AND ONLY THROUGH THE FRONT DOOR.   ║
 * ║                                                                          ║
 * ║  An upload is two browser requests: send the files, then start the job. ║
 * ║  When the second is lost (a deploy mid-upload, a stalled file, a closed ║
 * ║  tab) the job sat in `uploaded` until someone opened the dashboard —    ║
 * ║  measured 2026-10-31: 11 minutes.                                       ║
 * ║                                                                          ║
 * ║  Age alone is not enough: file rows exist BEFORE their bytes arrive, so ║
 * ║  a large batch on a slow link would be started half-uploaded and its    ║
 * ║  late files failed. A job is recovered only when storage holds every    ║
 * ║  one of its files — and it is started by `finalize_upload_job`, the     ║
 * ║  same call the browser makes, so the credit gate and the daily-limit    ║
 * ║  metering apply exactly as they would have.                             ║
 * ║                                                                          ║
 * ║  Anything else is left alone: the dashboard's `reap_orphaned_uploads`   ║
 * ║  still fails an upload whose files never came.                          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import { STORAGE_BUCKET } from '@/lib/upload/process'
import { keyBelongsToUser } from '@/lib/upload/storage-key'
import { createAdminClient } from '@/lib/supabase/admin'

/** How long an upload may sit unstarted before the scheduler looks at it. */
export const STALLED_UPLOAD_MINUTES = 2

/** Jobs looked at per tick. */
const PER_TICK = 20

export type RecoveryOutcome = { started: number; waiting: number; refused: number }

/** PURE. Every expected file is present among the stored names. */
export function allFilesArrived(storagePaths: readonly string[], storedNames: ReadonlySet<string>): boolean {
  return storagePaths.length > 0 && storagePaths.every((path) => storedNames.has(path.split('/').at(-1) ?? ''))
}

export async function recoverStalledUploads(now = new Date()): Promise<RecoveryOutcome> {
  const db = createAdminClient()
  const outcome: RecoveryOutcome = { started: 0, waiting: 0, refused: 0 }
  const before = new Date(now.getTime() - STALLED_UPLOAD_MINUTES * 60_000).toISOString()

  const { data: jobs, error } = await db
    .from('extraction_jobs')
    .select('id, user_id')
    .eq('status', 'uploaded')
    .lt('created_at', before)
    .order('created_at', { ascending: true })
    .limit(PER_TICK)
  if (error) throw new Error(`stalled upload read failed: ${error.code ?? 'unknown'}`)

  for (const job of jobs ?? []) {
    const userId = job.user_id as string
    const { data: files, error: filesError } = await db
      .from('uploaded_files')
      .select('storage_path')
      // Service role bypasses RLS — scoping by user_id is mandatory.
      .eq('user_id', userId)
      .eq('extraction_job_id', job.id)
      .is('deleted_at', null)
    if (filesError) throw new Error(`stalled upload files read failed: ${filesError.code ?? 'unknown'}`)
    const paths = (files ?? [])
      .map((file) => file.storage_path as string)
      .filter((path) => keyBelongsToUser(path, userId))

    const { data: stored, error: listError } = await db.storage
      .from(STORAGE_BUCKET)
      .list(`${userId}/${job.id}`, { limit: 1_000 })
    if (listError) throw new Error('stalled upload storage list failed')
    if (!allFilesArrived(paths, new Set((stored ?? []).map((object) => object.name)))) {
      outcome.waiting += 1
      continue
    }

    const { data: status, error: finalizeError } = await db.rpc('finalize_upload_job', {
      p_job_id: job.id as string,
      p_user_id: userId,
    })
    if (finalizeError) throw new Error(`finalize_upload_job failed: ${finalizeError.code ?? 'unknown'}`)
    if (status === 'ok' || status === 'already_finalized') outcome.started += 1
    else outcome.refused += 1
  }
  return outcome
}
