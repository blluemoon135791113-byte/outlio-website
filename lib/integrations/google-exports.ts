import 'server-only'

import { randomBytes } from 'node:crypto'

import {
  EXPORT_COLUMN_ORDER,
  enrichmentHeaders,
  toCanonicalExportRecord,
  type ExportLead,
} from '@/lib/export/leads'
import type { ExportResult } from '@/lib/integrations/types'

const REQUEST_TIMEOUT_MS = 30_000

/**
 * The columns for one export: the canonical eight, then merged intelligence.
 *
 * Computed across the whole batch so every row is the same width. A row that
 * lacks a column another row has gets an empty cell — a ragged sheet is not a
 * sheet, and Google will not accept one.
 */
function columnsFor(leads: readonly ExportLead[]): string[] {
  return [...EXPORT_COLUMN_ORDER, ...enrichmentHeaders(leads)]
}

function rowValues(lead: ExportLead, columns: readonly string[]): string[] {
  const record = toCanonicalExportRecord(lead)
  return columns.map((column) => record[column] ?? '')
}

function safeTitle(value: string | undefined, suffix: string): string {
  const cleaned = value?.trim().replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ')
  return (cleaned || `Outlio leads ${new Date().toISOString().slice(0, 10)}`).slice(0, 120) + suffix
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

async function googleRequest(url: string, accessToken: string, init: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...init.headers },
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

function failure(leads: readonly ExportLead[], code: string, message: string): ExportResult {
  return {
    successfulCount: 0,
    failedCount: leads.length,
    failures: leads.map((lead) => ({ sourceId: lead.id, code, message })),
  }
}

export async function exportLeadsToGoogleSheet(
  accessToken: string,
  leads: readonly ExportLead[],
  title?: string,
): Promise<ExportResult> {
  try {
    const createResponse = await googleRequest('https://sheets.googleapis.com/v4/spreadsheets', accessToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { title: safeTitle(title, '') } }),
    })
    const created = await createResponse.json().catch(() => null) as { spreadsheetId?: string; spreadsheetUrl?: string } | null
    if (createResponse.status === 401) return failure(leads, 'GOOGLE_AUTH_REJECTED', 'Google authorization expired. Reconnect Google.')
    if (!createResponse.ok || !created?.spreadsheetId) return failure(leads, 'GOOGLE_SHEETS_CREATE_FAILED', 'Google Sheets could not create this spreadsheet.')

    const columns = columnsFor(leads)
    const values = [columns, ...leads.map((lead) => rowValues(lead, columns))]
    const updateResponse = await googleRequest(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(created.spreadsheetId)}/values/A1?valueInputOption=RAW`,
      accessToken,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ range: 'A1', majorDimension: 'ROWS', values }),
      },
    )
    if (updateResponse.status === 401) return failure(leads, 'GOOGLE_AUTH_REJECTED', 'Google authorization expired. Reconnect Google.')
    if (!updateResponse.ok) return failure(leads, 'GOOGLE_SHEETS_WRITE_FAILED', 'Google Sheets created the file but could not write the lead rows.')
    return {
      successfulCount: leads.length,
      failedCount: 0,
      destinationId: created.spreadsheetId,
      destinationUrl: created.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${created.spreadsheetId}`,
    }
  } catch {
    return failure(leads, 'GOOGLE_UNAVAILABLE', 'Google could not be reached. Please try again.')
  }
}

export async function exportLeadsToGoogleDrive(
  accessToken: string,
  leads: readonly ExportLead[],
  title?: string,
): Promise<ExportResult> {
  const columns = columnsFor(leads)
  const csv = [columns, ...leads.map((lead) => rowValues(lead, columns))]
    .map((row) => row.map((value) => csvCell(String(value))).join(','))
    .join('\r\n') + '\r\n'
  const boundary = `outlio_${randomBytes(16).toString('hex')}`
  const name = safeTitle(title, '.csv')
  const body = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, mimeType: 'text/csv' })}\r\n`,
    `--${boundary}\r\nContent-Type: text/csv; charset=UTF-8\r\n\r\n${csv}\r\n`,
    `--${boundary}--`,
  ].join('')

  try {
    const response = await googleRequest('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', accessToken, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    })
    const created = await response.json().catch(() => null) as { id?: string; webViewLink?: string } | null
    if (response.status === 401) return failure(leads, 'GOOGLE_AUTH_REJECTED', 'Google authorization expired. Reconnect Google.')
    if (!response.ok || !created?.id) return failure(leads, 'GOOGLE_DRIVE_UPLOAD_FAILED', 'Google Drive could not save this CSV file.')
    return {
      successfulCount: leads.length,
      failedCount: 0,
      destinationId: created.id,
      destinationUrl: created.webViewLink ?? `https://drive.google.com/open?id=${created.id}`,
    }
  } catch {
    return failure(leads, 'GOOGLE_UNAVAILABLE', 'Google could not be reached. Please try again.')
  }
}
