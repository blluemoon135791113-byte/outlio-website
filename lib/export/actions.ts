'use server'

import { z } from 'zod'

import { assertAccess } from '@/lib/auth/access'
import { consume } from '@/lib/auth/rate-limit'
import {
  exportSelectedLeadsToClay,
  exportSelectedLeadsToGoogle,
  exportSelectedLeadsToGhl,
  exportSelectedLeadsToHubSpot,
  exportSelectedLeadsToSalesforce,
} from '@/lib/export/service'
import { ACTION_LIMITS } from '@/lib/security/action-limits'
import { createAdminClient } from '@/lib/supabase/admin'

export type LeadExportActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | {
      status: 'success'
      message: string
      successfulCount: number
      failedCount: number
    }

const selectedLeadIdsSchema = z
  .array(z.string().uuid())
  .min(1)
  .max(1_000)
  .refine((values) => new Set(values).size === values.length)

const jobIdSchema = z.string().uuid()

async function leadIdsFromForm(userId: string, formData: FormData): Promise<string[] | null> {
  const rawLeadIds = formData.get('lead_ids')
  if (rawLeadIds) {
    try {
      const parsed = selectedLeadIdsSchema.safeParse(JSON.parse(String(rawLeadIds)))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  const jobId = jobIdSchema.safeParse(formData.get('job_id'))
  if (!jobId.success) return null
  const { data, error } = await createAdminClient()
    .from('extracted_leads')
    .select('id')
    .eq('user_id', userId)
    .eq('extraction_job_id', jobId.data)
    .order('source_row_index', { ascending: true })
    .limit(1_000)
  if (error || !data?.length) return null
  return data.map((row) => row.id)
}

export async function exportSelectedLeadsToClayAction(
  _previous: LeadExportActionState,
  formData: FormData,
): Promise<LeadExportActionState> {
  const ctx = await assertAccess()
  const userId = ctx.userId!
  const limit = await consume(ACTION_LIMITS.export, `user:${userId}`)
  if (!limit.allowed) {
    return { status: 'error', message: 'Too many export requests. Please wait and try again.' }
  }

  const leadIds = await leadIdsFromForm(userId, formData)
  if (!leadIds) {
    return { status: 'error', message: 'Select between 1 and 1,000 leads to export.' }
  }

  try {
    const result = await exportSelectedLeadsToClay({ userId, leadIds })
    if (result.status === 'failed') {
      return {
        status: 'error',
        message: `Clay did not accept ${result.failedCount.toLocaleString()} selected lead${result.failedCount === 1 ? '' : 's'}. Test the connection and try again.`,
      }
    }

    return {
      status: 'success',
      message:
        result.failedCount > 0
          ? `Export completed with some errors. ${result.successfulCount.toLocaleString()} exported, ${result.failedCount.toLocaleString()} failed.`
          : `${result.successfulCount.toLocaleString()} selected lead${result.successfulCount === 1 ? '' : 's'} exported to Clay.`,
      successfulCount: result.successfulCount,
      failedCount: result.failedCount,
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'CLAY_NOT_CONNECTED') {
      return { status: 'error', message: 'Connect Clay in Settings before exporting leads.' }
    }
    if (code === 'EXPORT_SOURCE_NOT_FOUND') {
      return { status: 'error', message: 'One or more selected leads are no longer available.' }
    }
    if (code === 'EXPORT_EMPTY') {
      return { status: 'error', message: 'Select at least one lead to export.' }
    }
    return { status: 'error', message: 'The Clay export could not be completed. Please try again.' }
  }
}

export async function exportSelectedLeadsToHubSpotAction(
  _previous: LeadExportActionState,
  formData: FormData,
): Promise<LeadExportActionState> {
  const ctx = await assertAccess()
  const userId = ctx.userId!
  const limit = await consume(ACTION_LIMITS.export, `user:${userId}`)
  if (!limit.allowed) {
    return { status: 'error', message: 'Too many export requests. Please wait and try again.' }
  }

  const leadIds = await leadIdsFromForm(userId, formData)
  if (!leadIds) {
    return { status: 'error', message: 'Select between 1 and 1,000 leads to export.' }
  }

  try {
    const result = await exportSelectedLeadsToHubSpot({
      userId,
      leadIds,
    })
    if (result.status === 'failed') {
      return {
        status: 'error',
        message: `HubSpot did not accept ${result.failedCount.toLocaleString()} selected lead${result.failedCount === 1 ? '' : 's'}. Reconnect HubSpot if the problem continues.`,
      }
    }

    return {
      status: 'success',
      message: result.failedCount > 0
        ? `HubSpot export completed with errors. ${result.successfulCount.toLocaleString()} exported, ${result.failedCount.toLocaleString()} failed.`
        : `${result.successfulCount.toLocaleString()} selected lead${result.successfulCount === 1 ? '' : 's'} exported to HubSpot.`,
      successfulCount: result.successfulCount,
      failedCount: result.failedCount,
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'HUBSPOT_NOT_CONNECTED' || code.includes('Reconnect HubSpot')) {
      return { status: 'error', message: 'Connect or reconnect HubSpot in Settings before exporting leads.' }
    }
    if (code === 'EXPORT_SOURCE_NOT_FOUND') {
      return { status: 'error', message: 'One or more selected leads are no longer available.' }
    }
    if (code === 'EXPORT_EMPTY') {
      return { status: 'error', message: 'Select at least one lead to export.' }
    }
    return { status: 'error', message: 'The HubSpot export could not be completed. Please try again.' }
  }
}

export async function exportSelectedLeadsToSalesforceAction(
  _previous: LeadExportActionState,
  formData: FormData,
): Promise<LeadExportActionState> {
  const ctx = await assertAccess()
  const userId = ctx.userId!
  const limit = await consume(ACTION_LIMITS.export, `user:${userId}`)
  if (!limit.allowed) {
    return { status: 'error', message: 'Too many export requests. Please wait and try again.' }
  }

  const leadIds = await leadIdsFromForm(userId, formData)
  if (!leadIds) {
    return { status: 'error', message: 'Select between 1 and 1,000 leads to export.' }
  }

  try {
    const result = await exportSelectedLeadsToSalesforce({
      userId,
      leadIds,
    })
    if (result.status === 'failed') {
      return {
        status: 'error',
        message: `Salesforce did not accept ${result.failedCount.toLocaleString()} selected lead${result.failedCount === 1 ? '' : 's'}. Reconnect Salesforce if the problem continues.`,
      }
    }
    return {
      status: 'success',
      message: result.failedCount > 0
        ? `Salesforce export completed with errors. ${result.successfulCount.toLocaleString()} exported, ${result.failedCount.toLocaleString()} failed.`
        : `${result.successfulCount.toLocaleString()} selected lead${result.successfulCount === 1 ? '' : 's'} exported to Salesforce.`,
      successfulCount: result.successfulCount,
      failedCount: result.failedCount,
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'SALESFORCE_NOT_CONNECTED' || code.includes('Reconnect Salesforce')) {
      return { status: 'error', message: 'Connect or reconnect Salesforce in Settings before exporting leads.' }
    }
    if (code === 'EXPORT_SOURCE_NOT_FOUND') {
      return { status: 'error', message: 'One or more selected leads are no longer available.' }
    }
    if (code === 'EXPORT_EMPTY') {
      return { status: 'error', message: 'Select at least one lead to export.' }
    }
    return { status: 'error', message: 'The Salesforce export could not be completed. Please try again.' }
  }
}

export async function exportSelectedLeadsToGoogleAction(
  _previous: LeadExportActionState,
  formData: FormData,
): Promise<LeadExportActionState & { destinationUrl?: string }> {
  const ctx = await assertAccess()
  const userId = ctx.userId!
  const limit = await consume(ACTION_LIMITS.export, `user:${userId}`)
  if (!limit.allowed) return { status: 'error', message: 'Too many export requests. Please wait and try again.' }
  const destination = z.enum(['google_sheets', 'google_drive']).safeParse(formData.get('destination'))
  const leadIds = await leadIdsFromForm(userId, formData)
  if (!destination.success || !leadIds) return { status: 'error', message: 'Select between 1 and 1,000 leads to export.' }

  try {
    const result = await exportSelectedLeadsToGoogle({
      userId,
      leadIds,
      destination: destination.data,
      name: String(formData.get('name') ?? '').trim() || undefined,
    })
    if (result.status === 'failed') return { status: 'error', message: 'Google could not create this export. Reconnect Google if the problem continues.' }
    const label = destination.data === 'google_sheets' ? 'Google Sheets' : 'Google Drive'
    return {
      status: 'success',
      message: `${result.successfulCount.toLocaleString()} lead${result.successfulCount === 1 ? '' : 's'} exported to ${label}.`,
      successfulCount: result.successfulCount,
      failedCount: result.failedCount,
      destinationUrl: result.destinationUrl ?? undefined,
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'GOOGLE_NOT_CONNECTED' || code.includes('Reconnect Google')) return { status: 'error', message: 'Connect or reconnect Google in Settings before exporting leads.' }
    if (code === 'EXPORT_SOURCE_NOT_FOUND') return { status: 'error', message: 'One or more selected leads are no longer available.' }
    return { status: 'error', message: 'The Google export could not be completed. Please try again.' }
  }
}

export async function exportSelectedLeadsToGhlAction(
  _previous: LeadExportActionState,
  formData: FormData,
): Promise<LeadExportActionState> {
  const ctx = await assertAccess()
  const userId = ctx.userId!
  const limit = await consume(ACTION_LIMITS.export, `user:${userId}`)
  if (!limit.allowed) return { status: 'error', message: 'Too many export requests. Please wait and try again.' }
  const leadIds = await leadIdsFromForm(userId, formData)
  if (!leadIds) return { status: 'error', message: 'Select between 1 and 1,000 leads to export.' }
  try {
    const result = await exportSelectedLeadsToGhl({ userId, leadIds })
    if (result.status === 'failed') return { status: 'error', message: `HighLevel did not accept ${result.failedCount.toLocaleString()} lead${result.failedCount === 1 ? '' : 's'}. Update the token or check its scopes.` }
    return {
      status: 'success',
      message: result.failedCount ? `HighLevel export completed with errors. ${result.successfulCount.toLocaleString()} exported, ${result.failedCount.toLocaleString()} failed.` : `${result.successfulCount.toLocaleString()} lead${result.successfulCount === 1 ? '' : 's'} exported to HighLevel.`,
      successfulCount: result.successfulCount,
      failedCount: result.failedCount,
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'GHL_NOT_CONNECTED') return { status: 'error', message: 'Connect or update HighLevel in Settings before exporting leads.' }
    if (code === 'EXPORT_SOURCE_NOT_FOUND') return { status: 'error', message: 'One or more selected leads are no longer available.' }
    return { status: 'error', message: 'The HighLevel export could not be completed. Please try again.' }
  }
}
