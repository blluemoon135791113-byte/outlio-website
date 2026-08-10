/**
 * Upload limits.
 *
 * Env vars set the hard ceiling the SERVICE will accept at all. Per-user limits
 * come from `plans.limits` at runtime and are always the tighter of the two —
 * see `resolveUploadLimits`. No plan limit is hardcoded here.
 */
import type { PlanLimits } from '@/types/database'

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/** Absolute service ceiling — 10 MB, matching the bucket's file_size_limit. */
export function maxUploadFileBytes(): number {
  return envInt('MAX_UPLOAD_FILE_BYTES', 10 * 1024 * 1024)
}

/** Absolute service ceiling on files per job. */
export function maxFilesPerJob(): number {
  return envInt('MAX_FILES_PER_JOB', 100)
}

export type ResolvedUploadLimits = {
  maxFiles: number
  maxFileBytes: number
  /** `null` when the plan does not cap it. */
  maxRecordsPerExtraction: number | null
  /**
   * Files billed per credit. `null` means a flat 1 credit per extraction.
   * Priced by `lib/limits/credits.ts`; charged by the database.
   */
  filesPerCredit: number | null
}

/**
 * The effective limits for one user: the stricter of the plan's and the
 * service's. A plan can never raise a limit above what the service accepts.
 */
export function resolveUploadLimits(
  limits: PlanLimits | null,
): ResolvedUploadLimits {
  const serviceMaxFiles = maxFilesPerJob()
  const serviceMaxBytes = maxUploadFileBytes()

  const planFiles = limits?.files_per_extraction ?? null

  return {
    maxFiles: planFiles === null ? serviceMaxFiles : Math.min(planFiles, serviceMaxFiles),
    maxFileBytes: serviceMaxBytes,
    maxRecordsPerExtraction: limits?.records_per_extraction ?? null,
    filesPerCredit: limits?.files_per_credit ?? null,
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
