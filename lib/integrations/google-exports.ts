import 'server-only'

import { randomBytes } from 'node:crypto'

import {
  EXPORT_COLUMN_ORDER,
  enrichmentHeaders,
  toCanonicalExportRecord,
  type ExportLead,
} from '@/lib/export/leads'
import { linkableUrl } from '@/lib/export/links'
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

/**
 * The `batchUpdate` requests that make URL cells clickable.
 *
 * ⚠️ A FORMATTING PASS OVER CELLS ALREADY WRITTEN, NOT A FORMULA IN THEM. The
 * rows go in with `valueInputOption=RAW`, which stores every value as literal
 * text — that is what keeps a lead named `=cmd|'/c calc'!A1` inert. The link is
 * then set on the cell's text format, which is Sheets' own link API: the cell
 * still holds the plain URL, and nothing is ever evaluated. (docs/SCRAPER_AUDIT.md
 * §H2 — the approved way to keep links without reintroducing `=HYPERLINK`.)
 *
 * One request per column that contains a link, not one per cell, so a
 * thousand-lead export is a handful of requests rather than thousands. Row 0 is
 * the header and is never linked.
 */
function linkRequestsFor(values: readonly (readonly string[])[], sheetId: number): object[] {
  const [header, ...rows] = values
  if (!header || rows.length === 0) return []

  const requests: object[] = []
  for (let column = 0; column < header.length; column += 1) {
    const cells = rows.map((row) => {
      const uri = linkableUrl(row[column])
      return { values: [uri ? { userEnteredFormat: { textFormat: { link: { uri } } } } : {}] }
    })
    if (!cells.some((cell) => Object.keys(cell.values[0]).length > 0)) continue

    requests.push({
      updateCells: {
        start: { sheetId, rowIndex: 1, columnIndex: column },
        rows: cells,
        // Only the link is touched. The value written above is left exactly as is.
        fields: 'userEnteredFormat.textFormat.link',
      },
    })
  }
  return requests
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
    const created = await createResponse.json().catch(() => null) as {
      spreadsheetId?: string
      spreadsheetUrl?: string
      sheets?: { properties?: { sheetId?: number } }[]
    } | null
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

    /*
     * ⚠️ THE ROWS HAVE LANDED; FROM HERE NOTHING MAY REPORT THE EXPORT AS FAILED.
     * Every lead is in the sheet as readable text. If the link pass fails, the
     * customer has a complete sheet whose URLs are not clickable — calling that
     * a failed export would tell them their leads are missing when they are not,
     * and invite a second export that duplicates the file. So it is caught here,
     * separately from the outer catch, and only logged — with the status code and
     * never a URL, since those are lead data.
     *
     * A new spreadsheet's first sheet is id 0; the create response is read in
     * case Google ever says otherwise.
     */
    const linkRequests = linkRequestsFor(values, created.sheets?.[0]?.properties?.sheetId ?? 0)
    if (linkRequests.length > 0) {
      try {
        const linkResponse = await googleRequest(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(created.spreadsheetId)}:batchUpdate`,
          accessToken,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requests: linkRequests }),
          },
        )
        if (!linkResponse.ok) {
          console.warn(`[google-exports] rows written, links not applied (HTTP ${linkResponse.status})`)
        }
      } catch {
        console.warn('[google-exports] rows written, links not applied (request failed)')
      }
    }

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
