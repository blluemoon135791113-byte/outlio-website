import 'server-only'

/**
 * Server-side upload validation and persistence.
 *
 * Validation order matters and follows spec §10.2 — each step is cheaper than
 * the next, so hostile input is rejected as early as possible:
 *
 *   1. authenticated + canUseScraper + plan limits   (caller does this)
 *   2. file count, then per-file size by ACTUAL BYTES
 *   3. extension + declared MIME                     (hints only)
 *   4. content sniffing of the first 4 KB            (the real check)
 *   5. sha256 over the full content
 *   6. server-generated storage key
 *
 * Client-side validation is UX only. Nothing here trusts it.
 */
import { createHash, randomUUID } from 'node:crypto'

import { AppError, type ErrorCode } from '@/lib/errors/catalog'
import { SNIFF_BYTES, hasAllowedExtension, hasPlausibleMimeType, sniffHtml } from '@/lib/upload/sniff'
import { buildStorageKey, sanitizeDisplayFilename } from '@/lib/upload/storage-key'
import { createAdminClient } from '@/lib/supabase/admin'

export const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? 'uploads'

export type FileRejection = {
  filename: string
  code: ErrorCode
  /** User-facing. Never contains internals. */
  message: string
}

export type AcceptedFile = {
  fileId: string
  displayName: string
  bytes: Uint8Array
  byteSize: number
  sha256: string
}

export type ValidationOutcome = {
  accepted: AcceptedFile[]
  rejected: FileRejection[]
}

/**
 * Validates one file's bytes. Returns either an accepted descriptor or a
 * rejection carrying a catalog code.
 */
export function validateFileBytes(
  originalName: string,
  declaredType: string | null,
  bytes: Uint8Array,
  maxFileBytes: number,
): AcceptedFile | FileRejection {
  const displayName = sanitizeDisplayFilename(originalName)

  const reject = (code: ErrorCode, message: string): FileRejection => ({
    filename: displayName,
    code,
    message,
  })

  // 2. Size, measured from the bytes we actually hold — never a declared value.
  if (bytes.byteLength === 0) {
    return reject('ERR_FILE_EMPTY', 'This file appears to be empty.')
  }
  if (bytes.byteLength > maxFileBytes) {
    return reject(
      'ERR_FILE_TYPE',
      `This file is larger than the ${Math.round(maxFileBytes / (1024 * 1024))} MB limit.`,
    )
  }

  // 3. Extension and MIME — hints. Cheap, and give a clearer message than a
  //    sniff failure would.
  if (!hasAllowedExtension(originalName)) {
    return reject(
      'ERR_FILE_TYPE',
      "That file type isn't supported. Upload .html files saved from a lead search-results page.",
    )
  }
  if (!hasPlausibleMimeType(declaredType)) {
    return reject(
      'ERR_FILE_TYPE',
      "That file type isn't supported. Upload .html files saved from a lead search-results page.",
    )
  }

  // 4. Content sniffing — the check that actually decides.
  const sniff = sniffHtml(bytes.subarray(0, SNIFF_BYTES), bytes.byteLength)
  if (!sniff.ok) {
    const message =
      sniff.code === 'ERR_FILE_EMPTY'
        ? 'This file appears to be empty.'
        : sniff.code === 'ERR_FILE_TYPE'
          ? "That file type isn't supported. Upload .html files saved from a lead search-results page."
          : "We couldn't recognize this as a lead search-results page. Make sure you saved the full page."
    return reject(sniff.code, message)
  }

  // 5. Content hash over the full file.
  const sha256 = createHash('sha256').update(bytes).digest('hex')

  return {
    fileId: randomUUID(),
    displayName,
    bytes,
    byteSize: bytes.byteLength,
    sha256,
  }
}

/**
 * Creates the job, uploads every accepted file, and records the rows.
 *
 * The job row and its file rows are written first so that a crash mid-upload
 * leaves a recoverable job rather than orphaned storage objects. Objects
 * without a matching row are cleaned by the worker's startup sweep.
 */
export async function createExtractionJob(
  userId: string,
  accepted: AcceptedFile[],
  dedupeMode: 'keep_all' | 'remove_exact' | 'remove_likely' | 'review',
  /**
   * Set when the job came from the browser extension rather than an HTML
   * upload. NULL keeps source A behaving exactly as before — this is the only
   * change the extension required in the existing ingestion path.
   */
  captureSessionId: string | null = null,
): Promise<{ jobId: string; duplicateWarnings: string[] }> {
  if (accepted.length === 0) {
    throw new AppError('ERR_FILE_FORMAT', 'createExtractionJob called with no files')
  }

  const supabase = createAdminClient()
  const jobId = randomUUID()
  const totalBytes = accepted.reduce((sum, f) => sum + f.byteSize, 0)

  const { error: jobError } = await supabase.from('extraction_jobs').insert({
    id: jobId,
    // Service role bypasses RLS — this id comes from a verified session only.
    user_id: userId,
    status: 'uploaded',
    dedupe_mode: dedupeMode,
    capture_session_id: captureSessionId,
    file_count: accepted.length,
    total_bytes: totalBytes,
    progress_step: 'Uploading files',
    progress_current: 0,
    progress_total: accepted.length,
  })

  if (jobError) {
    throw new AppError('ERR_STORAGE', `job insert failed: ${jobError.code ?? ''}`)
  }

  // Warn, do not block, on re-uploading identical content (spec §10.2 step 5).
  const duplicateWarnings: string[] = []
  const { data: existing } = await supabase
    .from('uploaded_files')
    .select('content_sha256, original_filename')
    .eq('user_id', userId)
    .in('content_sha256', accepted.map((f) => f.sha256))

  const seenHashes = new Set((existing ?? []).map((r) => r.content_sha256))

  for (const file of accepted) {
    const storagePath = buildStorageKey(userId, jobId, file.fileId)

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, file.bytes, {
        contentType: 'text/html',
        upsert: false,
      })

    if (uploadError) {
      await supabase.from('extraction_jobs').update({
        status: 'failed',
        error_code: 'ERR_STORAGE',
        error_message: 'Upload failed',
      }).eq('id', jobId)
      throw new AppError('ERR_STORAGE', 'storage upload failed')
    }

    const { error: fileError } = await supabase.from('uploaded_files').insert({
      id: file.fileId,
      user_id: userId,
      extraction_job_id: jobId,
      original_filename: file.displayName,
      storage_path: storagePath,
      byte_size: file.byteSize,
      content_sha256: file.sha256,
      status: 'pending',
    })

    if (fileError) {
      // 23505 on (user_id, content_sha256) means identical content already
      // exists. Surface as a warning; the object is already stored.
      if (fileError.code === '23505') {
        duplicateWarnings.push(file.displayName)
        await supabase.storage.from(STORAGE_BUCKET).remove([storagePath])
        continue
      }
      throw new AppError('ERR_STORAGE', `file insert failed: ${fileError.code ?? ''}`)
    }

    if (seenHashes.has(file.sha256)) {
      duplicateWarnings.push(file.displayName)
    }
  }

  return { jobId, duplicateWarnings }
}
