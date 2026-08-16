import 'server-only'

import { normalizeExportLeads, type ExportLeadSource } from '@/lib/export/leads'
import { ClayExportProvider } from '@/lib/integrations/clay'
import { HubSpotContactExportProvider } from '@/lib/integrations/hubspot-contacts'
import { SalesforceLeadExportProvider } from '@/lib/integrations/salesforce-leads'
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
  getHubSpotAccessToken,
  getHubSpotConnectionMetadata,
  markHubSpotConnectionUsed,
  markHubSpotReconnectRequired,
} from '@/lib/integrations/hubspot-repository'
import {
  getSalesforceAccessContext,
  getSalesforceConnectionMetadata,
  markSalesforceConnectionUsed,
  markSalesforceReconnectRequired,
  refreshSalesforceAccessContext,
} from '@/lib/integrations/salesforce-repository'
import {
  getClayCredentials,
  markClayConnectionUsed,
  updateClayConnectionTest,
} from '@/lib/integrations/repository'
import { recordSecurityEvent } from '@/lib/security/events'
import { createAdminClient } from '@/lib/supabase/admin'
const EXPORT_LEAD_SELECT =
  'id, extraction_job_id, full_name, linkedin_url, job_title, company_name, company_url, company_website_url, sales_navigator_url, location, enrichment' as const

export type LeadExportServiceResult = {
  exportJobId: string
  status: 'completed' | 'partial' | 'failed'
  successfulCount: number
  failedCount: number
}

export type SalesforceLeadExportServiceResult = LeadExportServiceResult & {
  totalRequested: number
  failures: NonNullable<import('@/lib/integrations/types').ExportResult['failures']>
}

export type GoogleExportDestination = 'google_sheets' | 'google_drive'

export type GoogleLeadExportServiceResult = LeadExportServiceResult & {
  destinationUrl: string | null
}

export type GhlLeadExportServiceResult = LeadExportServiceResult & {
  totalRequested: number
  failures: NonNullable<import('@/lib/integrations/types').ExportResult['failures']>
}

export async function exportSelectedLeadsToGhl(input: { userId: string; leadIds: readonly string[] }): Promise<GhlLeadExportServiceResult> {
  const admin = createAdminClient()
  const requestedIds = [...new Set(input.leadIds)]
  if (!requestedIds.length) throw new Error('EXPORT_EMPTY')
  const { data: rows, error: leadError } = await admin.from('extracted_leads').select(EXPORT_LEAD_SELECT).eq('user_id', input.userId).in('id', requestedIds).order('source_row_index', { ascending: true })
  if (leadError) throw new Error('EXPORT_LEADS_UNAVAILABLE')
  if (!rows || rows.length !== requestedIds.length) throw new Error('EXPORT_SOURCE_NOT_FOUND')
  const connection = await getGhlConnectionMetadata(input.userId)
  const stored = await getGhlCredentials(input.userId)
  if (!connection || connection.status !== 'connected' || !stored) throw new Error('GHL_NOT_CONNECTED')
  const extractionJobIds = new Set(rows.map((row) => row.extraction_job_id))
  const extractionJobId = extractionJobIds.size === 1 ? rows[0]?.extraction_job_id ?? null : null
  const { data: exportJob, error: createError } = await admin.from('export_jobs').insert({
    user_id: input.userId, extraction_job_id: extractionJobId, provider: 'ghl', status: 'processing', lead_count: rows.length, started_at: new Date().toISOString(),
  }).select('id').single()
  if (createError || !exportJob) throw new Error('EXPORT_JOB_CREATE_FAILED')

  try {
    const result = await exportLeadsToGhl(stored.credentials, normalizeExportLeads(rows as ExportLeadSource[]))
    const status = result.failedCount === 0 ? 'completed' : result.successfulCount > 0 ? 'partial' : 'failed'
    if (result.records?.length) {
      await admin.from('integration_record_links').upsert(result.records.map((record) => ({ user_id: input.userId, connection_id: connection.id, lead_id: record.leadId, provider_record_id: record.providerRecordId })), { onConflict: 'connection_id,lead_id' })
    }
    if (result.failures?.length) {
      await admin.from('export_job_errors').insert(result.failures.map((failure) => ({ export_job_id: exportJob.id, user_id: input.userId, lead_id: failure.leadId, error_code: failure.code, error_message: failure.message })))
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
    return { exportJobId: exportJob.id, status, totalRequested: requestedIds.length, successfulCount: result.successfulCount, failedCount: result.failedCount, failures: result.failures ?? [] }
  } catch (error) {
    await admin.from('export_jobs').update({ status: 'failed', failed_count: rows.length, error_code: 'GHL_EXPORT_FAILED', error_message: 'HighLevel could not accept this export.', completed_at: new Date().toISOString() }).eq('id', exportJob.id).eq('user_id', input.userId)
    throw error
  }
}

export async function exportSelectedLeadsToGoogle(input: {
  userId: string
  leadIds: readonly string[]
  destination: GoogleExportDestination
  name?: string
}): Promise<GoogleLeadExportServiceResult> {
  const admin = createAdminClient()
  const requestedIds = [...new Set(input.leadIds)]
  if (requestedIds.length === 0) throw new Error('EXPORT_EMPTY')
  const { data: rows, error: leadError } = await admin
    .from('extracted_leads')
    .select(EXPORT_LEAD_SELECT)
    .eq('user_id', input.userId)
    .in('id', requestedIds)
    .order('source_row_index', { ascending: true })
  if (leadError) throw new Error('EXPORT_LEADS_UNAVAILABLE')
  if (!rows || rows.length !== requestedIds.length) throw new Error('EXPORT_SOURCE_NOT_FOUND')

  const connection = await getGoogleConnectionMetadata(input.userId)
  if (!connection || connection.status !== 'connected') throw new Error('GOOGLE_NOT_CONNECTED')
  const extractionJobIds = new Set(rows.map((row) => row.extraction_job_id))
  const extractionJobId = extractionJobIds.size === 1 ? rows[0]?.extraction_job_id ?? null : null
  const { data: exportJob, error: createError } = await admin.from('export_jobs').insert({
    user_id: input.userId,
    extraction_job_id: extractionJobId,
    provider: input.destination,
    status: 'processing',
    lead_count: rows.length,
    started_at: new Date().toISOString(),
  }).select('id').single()
  if (createError || !exportJob) throw new Error('EXPORT_JOB_CREATE_FAILED')

  try {
    const accessToken = await getGoogleAccessToken(input.userId)
    const leads = normalizeExportLeads(rows as ExportLeadSource[])
    const result = input.destination === 'google_sheets'
      ? await exportLeadsToGoogleSheet(accessToken, leads, input.name)
      : await exportLeadsToGoogleDrive(accessToken, leads, input.name)
    const status = result.failedCount === 0 ? 'completed' : result.successfulCount > 0 ? 'partial' : 'failed'
    if (result.failures?.length) {
      await admin.from('export_job_errors').insert(result.failures.map((failure) => ({
        export_job_id: exportJob.id,
        user_id: input.userId,
        lead_id: failure.leadId,
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

export async function exportSelectedLeadsToClay(input: {
  userId: string
  leadIds: readonly string[]
}): Promise<LeadExportServiceResult> {
  const admin = createAdminClient()
  const requestedIds = [...new Set(input.leadIds)]
  if (requestedIds.length === 0) throw new Error('EXPORT_EMPTY')

  const { data: rows, error: leadError } = await admin
    .from('extracted_leads')
    .select(EXPORT_LEAD_SELECT)
    .eq('user_id', input.userId)
    .in('id', requestedIds)
    .order('source_row_index', { ascending: true })
  if (leadError) throw new Error('EXPORT_LEADS_UNAVAILABLE')
  // Service-role reads bypass RLS. A partial match means at least one id was
  // missing or belonged to someone else, so fail the whole request.
  if (!rows || rows.length !== requestedIds.length) throw new Error('EXPORT_SOURCE_NOT_FOUND')

  const extractionJobIds = new Set(rows.map((row) => row.extraction_job_id))
  const extractionJobId = extractionJobIds.size === 1 ? rows[0]?.extraction_job_id ?? null : null

  const stored = await getClayCredentials(input.userId)
  if (!stored) throw new Error('CLAY_NOT_CONNECTED')

  const { data: exportJob, error: createError } = await admin
    .from('export_jobs')
    .insert({
      user_id: input.userId,
      extraction_job_id: extractionJobId,
      provider: 'clay',
      status: 'processing',
      lead_count: rows.length,
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
    const leads = normalizeExportLeads(rows as ExportLeadSource[])
    const result = await provider.exportLeads(
      {
        userId: input.userId,
        connectionId: stored.connectionId,
        existingRecordIds: new Map(),
      },
      leads,
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
        lead_id: failure.leadId,
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

export async function exportSelectedLeadsToHubSpot(input: {
  userId: string
  leadIds: readonly string[]
}): Promise<LeadExportServiceResult> {
  const admin = createAdminClient()
  const requestedIds = [...new Set(input.leadIds)]
  if (requestedIds.length === 0) throw new Error('EXPORT_EMPTY')

  const { data: rows, error: leadError } = await admin
    .from('extracted_leads')
    .select(EXPORT_LEAD_SELECT)
    .eq('user_id', input.userId)
    .in('id', requestedIds)
    .order('source_row_index', { ascending: true })
  if (leadError) throw new Error('EXPORT_LEADS_UNAVAILABLE')
  if (!rows || rows.length !== requestedIds.length) throw new Error('EXPORT_SOURCE_NOT_FOUND')

  const connection = await getHubSpotConnectionMetadata(input.userId)
  if (!connection || connection.status !== 'connected') {
    throw new Error('HUBSPOT_NOT_CONNECTED')
  }

  const { data: linkRows, error: linkError } = await admin
    .from('integration_record_links')
    .select('lead_id, provider_record_id')
    .eq('user_id', input.userId)
    .eq('connection_id', connection.id)
    .in('lead_id', requestedIds)
  if (linkError) throw new Error('HUBSPOT_LINKS_UNAVAILABLE')

  const existingRecordIds = new Map(
    (linkRows ?? []).map((row) => [row.lead_id, row.provider_record_id]),
  )
  const extractionJobIds = new Set(rows.map((row) => row.extraction_job_id))
  const extractionJobId = extractionJobIds.size === 1
    ? rows[0]?.extraction_job_id ?? null
    : null

  const { data: exportJob, error: createError } = await admin
    .from('export_jobs')
    .insert({
      user_id: input.userId,
      extraction_job_id: extractionJobId,
      provider: 'hubspot',
      status: 'processing',
      lead_count: rows.length,
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (createError || !exportJob) throw new Error('EXPORT_JOB_CREATE_FAILED')

  await recordSecurityEvent({
    event: 'export.started',
    userId: input.userId,
    context: {
      provider: 'hubspot',
      export_job_id: exportJob.id,
      lead_count: rows.length,
    },
  })

  try {
    const accessToken = await getHubSpotAccessToken(input.userId)
    const provider = new HubSpotContactExportProvider(accessToken)
    const result = await provider.exportLeads(
      {
        userId: input.userId,
        connectionId: connection.id,
        existingRecordIds,
      },
      normalizeExportLeads(rows as ExportLeadSource[]),
    )
    const status = result.failedCount === 0
      ? 'completed'
      : result.successfulCount > 0
        ? 'partial'
        : 'failed'

    if (result.records?.length) {
      const { error: recordLinkError } = await admin
        .from('integration_record_links')
        .upsert(
          result.records.map((record) => ({
            user_id: input.userId,
            connection_id: connection.id,
            lead_id: record.leadId,
            provider_record_id: record.providerRecordId,
          })),
          { onConflict: 'connection_id,lead_id' },
        )
      if (recordLinkError) throw new Error('HUBSPOT_RECORD_LINK_SAVE_FAILED')
    }

    if (result.failures?.length) {
      for (let offset = 0; offset < result.failures.length; offset += 500) {
        await admin.from('export_job_errors').insert(
          result.failures.slice(offset, offset + 500).map((failure) => ({
            export_job_id: exportJob.id,
            user_id: input.userId,
            lead_id: failure.leadId,
            error_code: failure.code,
            error_message: failure.message,
          })),
        )
      }
    }

    await admin
      .from('export_jobs')
      .update({
        status,
        successful_count: result.successfulCount,
        failed_count: result.failedCount,
        error_code: status === 'failed'
          ? result.failures?.[0]?.code ?? 'HUBSPOT_EXPORT_FAILED'
          : null,
        error_message: status === 'failed'
          ? result.failures?.[0]?.message ?? 'HubSpot did not accept the export.'
          : null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', exportJob.id)
      .eq('user_id', input.userId)

    if (result.failures?.some((failure) => [
      'HUBSPOT_AUTH_REJECTED',
      'HUBSPOT_SCHEMA_SCOPE_REQUIRED',
    ].includes(failure.code))) {
      await markHubSpotReconnectRequired(input.userId)
    } else if (result.successfulCount > 0) {
      await markHubSpotConnectionUsed(input.userId)
    }

    await recordSecurityEvent({
      event: status === 'completed'
        ? 'export.completed'
        : status === 'partial'
          ? 'export.partial'
          : 'export.failed',
      level: status === 'completed' ? 'info' : 'warn',
      userId: input.userId,
      context: {
        provider: 'hubspot',
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
  } catch (error) {
    await admin
      .from('export_jobs')
      .update({
        status: 'failed',
        failed_count: rows.length,
        error_code: 'HUBSPOT_EXPORT_FAILED',
        error_message: 'HubSpot could not accept this export.',
        completed_at: new Date().toISOString(),
      })
      .eq('id', exportJob.id)
      .eq('user_id', input.userId)

    if (error instanceof Error && error.message.includes('Reconnect HubSpot')) {
      await markHubSpotReconnectRequired(input.userId)
    }
    throw error
  }
}

export async function exportSelectedLeadsToSalesforce(input: {
  userId: string
  leadIds: readonly string[]
}): Promise<SalesforceLeadExportServiceResult> {
  const admin = createAdminClient()
  const requestedIds = [...new Set(input.leadIds)]
  if (requestedIds.length === 0) throw new Error('EXPORT_EMPTY')

  const { data: rows, error: leadError } = await admin
    .from('extracted_leads')
    .select(EXPORT_LEAD_SELECT)
    .eq('user_id', input.userId)
    .in('id', requestedIds)
    .order('source_row_index', { ascending: true })
  if (leadError) throw new Error('EXPORT_LEADS_UNAVAILABLE')
  if (!rows || rows.length !== requestedIds.length) throw new Error('EXPORT_SOURCE_NOT_FOUND')

  const connection = await getSalesforceConnectionMetadata(input.userId)
  if (!connection || connection.status !== 'connected') {
    throw new Error('SALESFORCE_NOT_CONNECTED')
  }

  const { data: linkRows, error: linkError } = await admin
    .from('integration_record_links')
    .select('lead_id, provider_record_id')
    .eq('user_id', input.userId)
    .eq('connection_id', connection.id)
    .in('lead_id', requestedIds)
  if (linkError) throw new Error('SALESFORCE_LINKS_UNAVAILABLE')

  const extractionJobIds = new Set(rows.map((row) => row.extraction_job_id))
  const extractionJobId = extractionJobIds.size === 1
    ? rows[0]?.extraction_job_id ?? null
    : null
  const { data: exportJob, error: createError } = await admin
    .from('export_jobs')
    .insert({
      user_id: input.userId,
      extraction_job_id: extractionJobId,
      provider: 'salesforce',
      status: 'processing',
      lead_count: rows.length,
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (createError || !exportJob) throw new Error('EXPORT_JOB_CREATE_FAILED')

  await recordSecurityEvent({
    event: 'export.started',
    userId: input.userId,
    context: {
      provider: 'salesforce',
      export_job_id: exportJob.id,
      lead_count: rows.length,
    },
  })

  try {
    const access = await getSalesforceAccessContext(input.userId)
    let provider = new SalesforceLeadExportProvider(
      access.accessToken,
      access.instanceUrl,
    )
    const exportContext = {
      userId: input.userId,
      connectionId: connection.id,
      existingRecordIds: new Map(
        (linkRows ?? []).map((row) => [row.lead_id, row.provider_record_id]),
      ),
    }
    const leads = normalizeExportLeads(rows as ExportLeadSource[])
    let result = await provider.exportLeads(exportContext, leads)
    if (
      result.successfulCount === 0 &&
      result.failures?.length === leads.length &&
      result.failures.every((failure) => failure.code === 'SALESFORCE_AUTH_REJECTED')
    ) {
      const refreshed = await refreshSalesforceAccessContext(input.userId)
      provider = new SalesforceLeadExportProvider(
        refreshed.accessToken,
        refreshed.instanceUrl,
      )
      result = await provider.exportLeads(exportContext, leads)
    }
    const status = result.failedCount === 0
      ? 'completed'
      : result.successfulCount > 0
        ? 'partial'
        : 'failed'

    if (result.records?.length) {
      const { error: recordLinkError } = await admin
        .from('integration_record_links')
        .upsert(
          result.records.map((record) => ({
            user_id: input.userId,
            connection_id: connection.id,
            lead_id: record.leadId,
            provider_record_id: record.providerRecordId,
          })),
          { onConflict: 'connection_id,lead_id' },
        )
      if (recordLinkError) throw new Error('SALESFORCE_RECORD_LINK_SAVE_FAILED')
    }

    if (result.failures?.length) {
      for (let offset = 0; offset < result.failures.length; offset += 500) {
        await admin.from('export_job_errors').insert(
          result.failures.slice(offset, offset + 500).map((failure) => ({
            export_job_id: exportJob.id,
            user_id: input.userId,
            lead_id: failure.leadId,
            error_code: failure.code,
            error_message: failure.message,
          })),
        )
      }
    }

    await admin
      .from('export_jobs')
      .update({
        status,
        successful_count: result.successfulCount,
        failed_count: result.failedCount,
        error_code: status === 'failed'
          ? result.failures?.[0]?.code ?? 'SALESFORCE_EXPORT_FAILED'
          : null,
        error_message: status === 'failed'
          ? result.failures?.[0]?.message ?? 'Salesforce did not accept the export.'
          : null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', exportJob.id)
      .eq('user_id', input.userId)

    if (result.failures?.some((failure) => failure.code === 'SALESFORCE_AUTH_REJECTED')) {
      await markSalesforceReconnectRequired(input.userId)
    } else if (result.successfulCount > 0) {
      await markSalesforceConnectionUsed(input.userId)
    }

    await recordSecurityEvent({
      event: status === 'completed'
        ? 'export.completed'
        : status === 'partial'
          ? 'export.partial'
          : 'export.failed',
      level: status === 'completed' ? 'info' : 'warn',
      userId: input.userId,
      context: {
        provider: 'salesforce',
        export_job_id: exportJob.id,
        successful_count: result.successfulCount,
        failed_count: result.failedCount,
      },
    })

    return {
      exportJobId: exportJob.id,
      status,
      totalRequested: requestedIds.length,
      successfulCount: result.successfulCount,
      failedCount: result.failedCount,
      failures: result.failures ?? [],
    }
  } catch (error) {
    await admin
      .from('export_jobs')
      .update({
        status: 'failed',
        failed_count: rows.length,
        error_code: 'SALESFORCE_EXPORT_FAILED',
        error_message: 'Salesforce could not accept this export.',
        completed_at: new Date().toISOString(),
      })
      .eq('id', exportJob.id)
      .eq('user_id', input.userId)
    if (error instanceof Error && error.message.includes('Reconnect Salesforce')) {
      await markSalesforceReconnectRequired(input.userId)
    }
    throw error
  }
}
