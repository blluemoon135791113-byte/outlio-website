import 'server-only'

import { loadAccountExportRecords } from '@/lib/export/account-loader'
import { normalizeExportLeads, type ExportLead, type ExportLeadSource } from '@/lib/export/leads'
import { ClayExportProvider } from '@/lib/integrations/clay'
import { exportLeadsToGoogleDrive, exportLeadsToGoogleSheet } from '@/lib/integrations/google-exports'
import { exportLeadsToGhl } from '@/lib/integrations/ghl'
import { getGhlConnectionMetadata, getGhlCredentials, markGhlConnectionUsed, updateGhlConnectionTest } from '@/lib/integrations/ghl-repository'
import {
  getGoogleAccessToken,
  getGoogleConnectionMetadata,
  markGoogleConnectionUsed,
  markGoogleReconnectRequired,
} from '@/lib/integrations/google-repository'
import {
  getClayCredentials,
  markClayConnectionUsed,
  updateClayConnectionTest,
} from '@/lib/integrations/repository'
import { recordSecurityEvent } from '@/lib/security/events'
import { createAdminClient } from '@/lib/supabase/admin'
const EXPORT_LEAD_SELECT =
  'id, extraction_job_id, full_name, linkedin_url, job_title, company_name, company_url, company_website_url, sales_navigator_url, location, enrichment, company_industry, company_size, company_headquarters, connection_degree, is_reachable, list_count, last_activity, added_to_list_at, work_email, email_status, mobile_phone, phone_status' as const

export type ExportSelectionInput =
  | { userId: string; leadIds: readonly string[]; accountListJobId?: never }
  | { userId: string; accountListJobId: string; leadIds?: never }

type ExportBatch = {
  records: ExportLead[]
  extractionJobId: string | null
  recordType: 'lead' | 'account'
}

async function loadExportBatch(input: ExportSelectionInput): Promise<ExportBatch> {
  if (typeof input.accountListJobId === 'string') {
    const records = await loadAccountExportRecords(input.userId, input.accountListJobId)
    return { records, extractionJobId: input.accountListJobId, recordType: 'account' }
  }

  const admin = createAdminClient()
  const requestedIds = [...new Set(input.leadIds)]
  if (requestedIds.length === 0) throw new Error('EXPORT_EMPTY')
  const { data: rows, error } = await admin
    .from('extracted_leads')
    .select(EXPORT_LEAD_SELECT)
    .eq('user_id', input.userId)
    .in('id', requestedIds)
    .order('source_row_index', { ascending: true })
  if (error) throw new Error('EXPORT_LEADS_UNAVAILABLE')
  if (!rows || rows.length !== requestedIds.length) throw new Error('EXPORT_SOURCE_NOT_FOUND')
  const jobIds = new Set(rows.map((row) => row.extraction_job_id))
  return {
    records: normalizeExportLeads(rows as ExportLeadSource[]),
    extractionJobId: jobIds.size === 1 ? rows[0]?.extraction_job_id ?? null : null,
    recordType: 'lead',
  }
}

function sourceReference(recordType: ExportBatch['recordType'], sourceId: string) {
  return recordType === 'account'
    ? { lead_id: null, account_list_entry_id: sourceId }
    : { lead_id: sourceId, account_list_entry_id: null }
}

export type LeadExportServiceResult = {
  exportJobId: string
  status: 'completed' | 'partial' | 'failed'
  successfulCount: number
  failedCount: number
}

export type GoogleExportDestination = 'google_sheets' | 'google_drive'

export type GoogleLeadExportServiceResult = LeadExportServiceResult & {
  destinationUrl: string | null
}

export type GhlLeadExportServiceResult = LeadExportServiceResult & {
  totalRequested: number
  failures: NonNullable<import('@/lib/integrations/types').ExportResult['failures']>
}

export async function exportSelectedLeadsToGhl(input: ExportSelectionInput): Promise<GhlLeadExportServiceResult> {
  const admin = createAdminClient()
  const batch = await loadExportBatch(input)
  const rows = batch.records
  const connection = await getGhlConnectionMetadata(input.userId)
  const stored = await getGhlCredentials(input.userId)
  if (!connection || connection.status !== 'connected' || !stored) throw new Error('GHL_NOT_CONNECTED')
  const { data: exportJob, error: createError } = await admin.from('export_jobs').insert({
    user_id: input.userId, extraction_job_id: batch.extractionJobId, provider: 'ghl', status: 'processing',
    record_type: batch.recordType, lead_count: batch.recordType === 'lead' ? rows.length : 0,
    account_count: batch.recordType === 'account' ? rows.length : 0, started_at: new Date().toISOString(),
  }).select('id').single()
  if (createError || !exportJob) throw new Error('EXPORT_JOB_CREATE_FAILED')

  try {
    const result = await exportLeadsToGhl(stored.credentials, rows)
    const status = result.failedCount === 0 ? 'completed' : result.successfulCount > 0 ? 'partial' : 'failed'
    if (result.records?.length) {
      for (const record of result.records) {
        await admin.from('integration_record_links').upsert({
          user_id: input.userId,
          connection_id: connection.id,
          ...sourceReference(batch.recordType, record.sourceId),
          provider_record_id: record.providerRecordId,
        }, { onConflict: batch.recordType === 'account' ? 'connection_id,account_list_entry_id' : 'connection_id,lead_id' })
      }
    }
    if (result.failures?.length) {
      await admin.from('export_job_errors').insert(result.failures.map((failure) => ({ export_job_id: exportJob.id, user_id: input.userId, ...sourceReference(batch.recordType, failure.sourceId), error_code: failure.code, error_message: failure.message })))
    }
    await admin.from('export_jobs').update({
      status, successful_count: result.successfulCount, failed_count: result.failedCount,
      error_code: status === 'failed' ? result.failures?.[0]?.code ?? 'GHL_EXPORT_FAILED' : null,
      error_message: status === 'failed' ? result.failures?.[0]?.message ?? 'HighLevel could not accept this export.' : null,
      completed_at: new Date().toISOString(),
    }).eq('id', exportJob.id).eq('user_id', input.userId)
    const authFailure = result.failures?.find((failure) => failure.code === 'GHL_AUTH_REJECTED')
    if (authFailure) await updateGhlConnectionTest(input.userId, { ok: false, reconnectRequired: true, message: authFailure.message })
    else if (result.successfulCount > 0) await markGhlConnectionUsed(input.userId)
    return { exportJobId: exportJob.id, status, totalRequested: rows.length, successfulCount: result.successfulCount, failedCount: result.failedCount, failures: result.failures ?? [] }
  } catch (error) {
    await admin.from('export_jobs').update({ status: 'failed', failed_count: rows.length, error_code: 'GHL_EXPORT_FAILED', error_message: 'HighLevel could not accept this export.', completed_at: new Date().toISOString() }).eq('id', exportJob.id).eq('user_id', input.userId)
    throw error
  }
}

export async function exportSelectedLeadsToGoogle(input: ExportSelectionInput & {
  destination: GoogleExportDestination
  name?: string
}): Promise<GoogleLeadExportServiceResult> {
  const admin = createAdminClient()
  const batch = await loadExportBatch(input)
  const rows = batch.records

  const connection = await getGoogleConnectionMetadata(input.userId)
  if (!connection || connection.status !== 'connected') throw new Error('GOOGLE_NOT_CONNECTED')
  const { data: exportJob, error: createError } = await admin.from('export_jobs').insert({
    user_id: input.userId,
    extraction_job_id: batch.extractionJobId,
    provider: input.destination,
    status: 'processing',
    record_type: batch.recordType,
    lead_count: batch.recordType === 'lead' ? rows.length : 0,
    account_count: batch.recordType === 'account' ? rows.length : 0,
    started_at: new Date().toISOString(),
  }).select('id').single()
  if (createError || !exportJob) throw new Error('EXPORT_JOB_CREATE_FAILED')

  try {
    const accessToken = await getGoogleAccessToken(input.userId)
    const result = input.destination === 'google_sheets'
      ? await exportLeadsToGoogleSheet(accessToken, rows, input.name)
      : await exportLeadsToGoogleDrive(accessToken, rows, input.name)
    const status = result.failedCount === 0 ? 'completed' : result.successfulCount > 0 ? 'partial' : 'failed'
    if (result.failures?.length) {
      await admin.from('export_job_errors').insert(result.failures.map((failure) => ({
        export_job_id: exportJob.id,
        user_id: input.userId,
        ...sourceReference(batch.recordType, failure.sourceId),
        error_code: failure.code,
        error_message: failure.message,
      })))
    }
    await admin.from('export_jobs').update({
      status,
      successful_count: result.successfulCount,
      failed_count: result.failedCount,
      destination_id: result.destinationId ?? null,
      destination_url: result.destinationUrl ?? null,
      error_code: status === 'failed' ? result.failures?.[0]?.code ?? 'GOOGLE_EXPORT_FAILED' : null,
      error_message: status === 'failed' ? result.failures?.[0]?.message ?? 'Google could not accept the export.' : null,
      completed_at: new Date().toISOString(),
    }).eq('id', exportJob.id).eq('user_id', input.userId)
    if (result.failures?.some((failure) => failure.code === 'GOOGLE_AUTH_REJECTED')) await markGoogleReconnectRequired(input.userId)
    else if (result.successfulCount > 0) await markGoogleConnectionUsed(input.userId)
    await recordSecurityEvent({
      event: status === 'completed' ? 'export.completed' : 'export.failed',
      level: status === 'completed' ? 'info' : 'warn',
      userId: input.userId,
      context: { provider: input.destination, export_job_id: exportJob.id, successful_count: result.successfulCount, failed_count: result.failedCount },
    })
    return {
      exportJobId: exportJob.id,
      status,
      successfulCount: result.successfulCount,
      failedCount: result.failedCount,
      destinationUrl: result.destinationUrl ?? null,
    }
  } catch (error) {
    await admin.from('export_jobs').update({
      status: 'failed', failed_count: rows.length, error_code: 'GOOGLE_EXPORT_FAILED',
      error_message: 'Google could not accept this export.', completed_at: new Date().toISOString(),
    }).eq('id', exportJob.id).eq('user_id', input.userId)
    throw error
  }
}

export async function exportSelectedLeadsToClay(input: ExportSelectionInput): Promise<LeadExportServiceResult> {
  const admin = createAdminClient()
  const batch = await loadExportBatch(input)
  const rows = batch.records

  const stored = await getClayCredentials(input.userId)
  if (!stored) throw new Error('CLAY_NOT_CONNECTED')

  const { data: exportJob, error: createError } = await admin
    .from('export_jobs')
    .insert({
      user_id: input.userId,
      extraction_job_id: batch.extractionJobId,
      provider: 'clay',
      status: 'processing',
      record_type: batch.recordType,
      lead_count: batch.recordType === 'lead' ? rows.length : 0,
      account_count: batch.recordType === 'account' ? rows.length : 0,
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (createError || !exportJob) throw new Error('EXPORT_JOB_CREATE_FAILED')

  await recordSecurityEvent({
    event: 'export.started',
    userId: input.userId,
    context: { provider: 'clay', export_job_id: exportJob.id, lead_count: rows.length },
  })

  try {
    const provider = new ClayExportProvider(stored.credentials)
    const result = await provider.exportLeads(
      {
        userId: input.userId,
        connectionId: stored.connectionId,
        existingRecordIds: new Map(),
      },
      rows,
    )
    const status =
      result.failedCount === 0
        ? 'completed'
        : result.successfulCount > 0
          ? 'partial'
          : 'failed'
    const completedAt = new Date().toISOString()

    if (result.failures?.length) {
      const errorRows = result.failures.map((failure) => ({
        export_job_id: exportJob.id,
        user_id: input.userId,
        ...sourceReference(batch.recordType, failure.sourceId),
        error_code: failure.code,
        error_message: failure.message,
      }))
      for (let offset = 0; offset < errorRows.length; offset += 500) {
        await admin.from('export_job_errors').insert(errorRows.slice(offset, offset + 500))
      }
    }

    await admin
      .from('export_jobs')
      .update({
        status,
        successful_count: result.successfulCount,
        failed_count: result.failedCount,
        error_code: status === 'failed' ? result.failures?.[0]?.code ?? 'CLAY_EXPORT_FAILED' : null,
        error_message: status === 'failed' ? result.failures?.[0]?.message ?? 'Clay did not accept the export.' : null,
        completed_at: completedAt,
      })
      .eq('id', exportJob.id)
      .eq('user_id', input.userId)

    if (status === 'completed' || status === 'partial') await markClayConnectionUsed(input.userId)
    else {
      const first = result.failures?.[0]
      await updateClayConnectionTest(input.userId, {
        ok: false,
        reconnectRequired: first?.code === 'CLAY_AUTH_REJECTED' || first?.code === 'CLAY_WEBHOOK_NOT_FOUND',
        message: first?.message,
      })
    }

    await recordSecurityEvent({
      event: status === 'completed' ? 'export.completed' : status === 'partial' ? 'export.partial' : 'export.failed',
      level: status === 'completed' ? 'info' : 'warn',
      userId: input.userId,
      context: {
        provider: 'clay',
        export_job_id: exportJob.id,
        successful_count: result.successfulCount,
        failed_count: result.failedCount,
      },
    })

    return {
      exportJobId: exportJob.id,
      status,
      successfulCount: result.successfulCount,
      failedCount: result.failedCount,
    }
  } catch {
    await admin
      .from('export_jobs')
      .update({
        status: 'failed',
        failed_count: rows.length,
        error_code: 'CLAY_EXPORT_FAILED',
        error_message: 'Clay could not accept this export.',
        completed_at: new Date().toISOString(),
      })
      .eq('id', exportJob.id)
      .eq('user_id', input.userId)

    throw new Error('CLAY_EXPORT_FAILED')
  }
}
