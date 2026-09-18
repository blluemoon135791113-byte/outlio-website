/**
 * Clickable links in exported leads, without a single formula.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ TWO THINGS MUST HOLD AT ONCE, AND THEY PULL IN OPPOSITE DIRECTIONS.   ║
 * ║                                                                           ║
 * ║  The links must work — a Sales Navigator URL the customer has to copy and ║
 * ║  paste is the complaint this exists to fix. And no cell may ever carry a  ║
 * ║  formula, because lead text is attacker-controlled (SCRAPER_AUDIT §H2).   ║
 * ║  So the rows are still written RAW, and the link is applied afterwards as ║
 * ║  cell formatting. Both halves have assertions here.                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ExportLead } from '@/lib/export/leads'
import { linkableUrl } from '@/lib/export/links'
import { exportLeadsToGoogleSheet } from '@/lib/integrations/google-exports'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('linkableUrl', () => {
  it('links a plain http or https address, exactly as written', () => {
    expect(linkableUrl('https://www.linkedin.com/sales/lead/fabricated-1')).toBe(
      'https://www.linkedin.com/sales/lead/fabricated-1',
    )
    expect(linkableUrl('  http://example.com/path?q=1  ')).toBe('http://example.com/path?q=1')
  })

  it('leaves ordinary text alone', () => {
    for (const value of ['Ada Example', 'Founder', 'N/A', '', 'example.com', 'www.example.com']) {
      expect(linkableUrl(value), value).toBeNull()
    }
  })

  /*
   * The display text IS the target, so nobody can make a cell say one thing
   * and open another. A value that merely contains a URL is not linked.
   */
  it('only links a cell whose entire value is the URL', () => {
    expect(linkableUrl('see https://example.com')).toBeNull()
    expect(linkableUrl('https://example.com and more')).toBeNull()
  })

  it('refuses every scheme but http and https', () => {
    for (const value of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'ftp://example.com',
      'mailto:ada@example.com',
    ]) {
      expect(linkableUrl(value), value).toBeNull()
    }
  })

  it('refuses a URL carrying credentials, the classic phishing shape', () => {
    expect(linkableUrl('https://bank.example@evil.example/login')).toBeNull()
    expect(linkableUrl('https://user:pass@example.com')).toBeNull()
  })

  it('refuses a formula even when it contains a URL', () => {
    expect(linkableUrl('=HYPERLINK("https://example.com","x")')).toBeNull()
  })

  it('refuses a non-string', () => {
    expect(linkableUrl(null)).toBeNull()
    expect(linkableUrl(undefined)).toBeNull()
    expect(linkableUrl(42)).toBeNull()
  })
})

const lead: ExportLead = {
  id: '0642de5b-ad00-4b95-96eb-aa17e60ccf9d',
  name: '=cmd|\'/c calc\'!A1',
  linkedinUrl: 'https://www.linkedin.com/in/fabricated-1',
  jobTitle: 'Founder',
  companyName: 'Example Co',
  companyUrl: 'https://example.com',
  location: 'London',
  salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/fabricated-1',
}

type Captured = { url: string; body: unknown }

function mockGoogle(options: { batchStatus?: number; batchThrows?: boolean } = {}) {
  const calls: Captured[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url)
      calls.push({ url: target, body: init?.body ? JSON.parse(String(init.body)) : null })

      if (target.endsWith('/v4/spreadsheets')) {
        return Response.json({
          spreadsheetId: 'sheet-id',
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-id',
          sheets: [{ properties: { sheetId: 7 } }],
        })
      }
      if (target.includes('/values/A1')) return Response.json({ updatedRows: 2 })
      if (target.endsWith(':batchUpdate')) {
        if (options.batchThrows) throw new Error('socket hang up')
        return Response.json({ replies: [] }, { status: options.batchStatus ?? 200 })
      }
      throw new Error(`unexpected request: ${target}`)
    }),
  )
  return calls
}

type UpdateCells = {
  updateCells: {
    start: { sheetId: number; rowIndex: number; columnIndex: number }
    rows: { values: { userEnteredFormat?: { textFormat?: { link?: { uri: string } } } }[] }[]
    fields: string
  }
}

describe('the Google Sheets export', () => {
  it('still writes every value as RAW text, so no cell can become a formula', async () => {
    const calls = mockGoogle()
    await exportLeadsToGoogleSheet('access', [lead])

    const write = calls.find((c) => c.url.includes('/values/A1'))
    expect(write?.url).toContain('valueInputOption=RAW')
    expect(write?.url).not.toContain('USER_ENTERED')
  })

  it('makes the URL cells clickable with Sheets\' own link format', async () => {
    const calls = mockGoogle()
    const result = await exportLeadsToGoogleSheet('access', [lead])
    expect(result.successfulCount).toBe(1)

    const batch = calls.find((c) => c.url.endsWith(':batchUpdate'))
    expect(batch, 'no link pass was sent').toBeDefined()

    const requests = (batch!.body as { requests: UpdateCells[] }).requests
    const linked = requests.flatMap((r) =>
      r.updateCells.rows.flatMap((row) =>
        row.values.map((cell) => cell.userEnteredFormat?.textFormat?.link?.uri).filter(Boolean),
      ),
    )

    expect(linked).toEqual(
      expect.arrayContaining([
        'https://www.linkedin.com/in/fabricated-1',
        'https://www.linkedin.com/sales/lead/fabricated-1',
        'https://example.com',
      ]),
    )
  })

  it('touches only the link, never the value that was written', async () => {
    const calls = mockGoogle()
    await exportLeadsToGoogleSheet('access', [lead])

    const { requests } = calls.find((c) => c.url.endsWith(':batchUpdate'))!.body as {
      requests: UpdateCells[]
    }
    for (const request of requests) {
      expect(request.updateCells.fields).toBe('userEnteredFormat.textFormat.link')
      // Starts below the header: a column title is never a link.
      expect(request.updateCells.start.rowIndex).toBe(1)
      // The sheet id from the create response, not an assumed 0.
      expect(request.updateCells.start.sheetId).toBe(7)
    }
  })

  it('never links the hostile name, or anything else that is not a URL', async () => {
    const calls = mockGoogle()
    await exportLeadsToGoogleSheet('access', [lead])

    const serialized = JSON.stringify(calls.find((c) => c.url.endsWith(':batchUpdate'))!.body)
    expect(serialized).not.toContain('calc')
    expect(serialized).not.toContain('Founder')
  })

  it('sends one request per URL column, not one per cell', async () => {
    const calls = mockGoogle()
    await exportLeadsToGoogleSheet('access', Array.from({ length: 50 }, (_, i) => ({
      ...lead,
      id: `0642de5b-ad00-4b95-96eb-${String(i).padStart(12, '0')}`,
    })))

    const { requests } = calls.find((c) => c.url.endsWith(':batchUpdate'))!.body as {
      requests: UpdateCells[]
    }
    expect(requests.length).toBeLessThan(10)
    for (const request of requests) expect(request.updateCells.rows).toHaveLength(50)
  })

  it('skips the link pass entirely when nothing is linkable', async () => {
    const calls = mockGoogle()
    await exportLeadsToGoogleSheet('access', [
      { ...lead, linkedinUrl: null, companyUrl: null, salesNavigatorUrl: null },
    ])

    expect(calls.some((c) => c.url.endsWith(':batchUpdate'))).toBe(false)
  })

  /*
   * ⚠️ THE ROWS LANDED. A failed link pass leaves a complete sheet whose URLs
   * are plain text; reporting that as a failed export would tell the customer
   * their leads are missing, and invite a second export that duplicates it.
   */
  it('still reports success when the link pass is refused', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockGoogle({ batchStatus: 500 })

    await expect(exportLeadsToGoogleSheet('access', [lead])).resolves.toMatchObject({
      successfulCount: 1,
      failedCount: 0,
      destinationId: 'sheet-id',
    })
  })

  it('still reports success when the link pass cannot be reached', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockGoogle({ batchThrows: true })

    await expect(exportLeadsToGoogleSheet('access', [lead])).resolves.toMatchObject({
      successfulCount: 1,
      failedCount: 0,
    })
  })

  it('logs the status of a failed link pass and never a URL', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockGoogle({ batchStatus: 403 })
    await exportLeadsToGoogleSheet('access', [lead])

    expect(warn).toHaveBeenCalledTimes(1)
    const logged = String(warn.mock.calls[0]?.[0])
    expect(logged).toContain('403')
    expect(logged).not.toContain('linkedin.com')
  })
})
