import type {
  ExtractedLeadRow,
  ExtractionJobRow,
  UploadedFileRow,
} from '@/types/database'

export const DASHBOARD_JOB_SELECT =
  'id, status, dedupe_mode, file_count, total_bytes, progress_step, progress_current, progress_total, leads_parsed, leads_kept, duplicates_found, duplicates_removed, export_storage_path, error_message, started_at, completed_at, created_at, updated_at' as const

export const DASHBOARD_FILE_SELECT =
  'id, extraction_job_id, original_filename, byte_size, status, leads_found, error_message, processed_at, created_at' as const

export const DASHBOARD_LEAD_SELECT =
  'id, extraction_job_id, uploaded_file_id, full_name, linkedin_url, job_title, company_name, location, created_at' as const

export type DashboardJob = Pick<
  ExtractionJobRow,
  | 'id'
  | 'status'
  | 'dedupe_mode'
  | 'file_count'
  | 'total_bytes'
  | 'progress_step'
  | 'progress_current'
  | 'progress_total'
  | 'leads_parsed'
  | 'leads_kept'
  | 'duplicates_found'
  | 'duplicates_removed'
  | 'export_storage_path'
  | 'error_message'
  | 'started_at'
  | 'completed_at'
  | 'created_at'
  | 'updated_at'
>

export type DashboardFile = Pick<
  UploadedFileRow,
  | 'id'
  | 'extraction_job_id'
  | 'original_filename'
  | 'byte_size'
  | 'status'
  | 'leads_found'
  | 'error_message'
  | 'processed_at'
  | 'created_at'
>

export type DashboardLead = Pick<
  ExtractedLeadRow,
  | 'id'
  | 'extraction_job_id'
  | 'uploaded_file_id'
  | 'full_name'
  | 'linkedin_url'
  | 'job_title'
  | 'company_name'
  | 'location'
  | 'created_at'
>

export type CreditSnapshot = {
  allowance: number
  used: number
  remaining: number
}
