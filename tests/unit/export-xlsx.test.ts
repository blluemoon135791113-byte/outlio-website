/**
 * The Excel download: real hyperlinks, and no formula anywhere.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ EVERY ASSERTION READS THE FILE BACK. Checking what was PASSED to the  ║
 * ║  writer would prove nothing about what Excel opens — so each test writes  ║
 * ║  a real .xlsx, parses it with the same library a customer's spreadsheet   ║
 * ║  would meet, and inspects the cells that came out.                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'

import { toCsv, toTable, type CsvColumn } from '@/lib/export/sanitize'
import { toXlsx } from '@/lib/export/xlsx'

type Row = Record<string, string | number | null>

const columns: CsvColumn<Row>[] = ['Name', 'LinkedIn Profile', 'Sales Navigator URL', 'Job Title', 'List Count', 'Notes'].map(
  (header) => ({ header, value: (row: Row) => row[header] ?? null }),
)

const rows: Row[] = [
  {
    Name: "=cmd|'/c calc'!A1",
    'LinkedIn Profile': 'https://www.linkedin.com/in/fabricated-1',
    'Sales Navigator URL': 'https://www.linkedin.com/sales/lead/fabricated-1',
    'Job Title': 'Founder',
    'List Count': 3,
    Notes: 'javascript:alert(1)',
  },
  {
    Name: 'Ada Example',
    'LinkedIn Profile': null,
    'Sales Navigator URL': 'https://www.linkedin.com/sales/lead/fabricated-2',
    'Job Title': '+44 lead',
    'List Count': 0,
    Notes: 'see https://example.com',
  },
]

async function readBack(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook()
  // exceljs declares its own `Buffer` type, which newer Node typings do not satisfy.
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer)
  const sheet = workbook.worksheets[0]!
  const headers = (sheet.getRow(1).values as unknown[]).slice(1).map(String)
  const cell = (row: number, header: string) => sheet.getRow(row).getCell(headers.indexOf(header) + 1)
  return { sheet, headers, cell }
}

describe('toXlsx', () => {
  it('makes every URL cell a real hyperlink whose target is the text shown', async () => {
    const { cell } = await readBack(await toXlsx(toTable(rows, columns), 'Leads'))

    for (const [row, header, url] of [
      [2, 'LinkedIn Profile', 'https://www.linkedin.com/in/fabricated-1'],
      [2, 'Sales Navigator URL', 'https://www.linkedin.com/sales/lead/fabricated-1'],
      [3, 'Sales Navigator URL', 'https://www.linkedin.com/sales/lead/fabricated-2'],
    ] as const) {
      const value = cell(row, header).value as { text?: string; hyperlink?: string }
      expect(value.hyperlink, `${header} row ${row}`).toBe(url)
      expect(value.text, `${header} row ${row}`).toBe(url)
    }
  })

  it('styles links with the theme hyperlink slot, not a colour literal', async () => {
    const { cell } = await readBack(await toXlsx(toTable(rows, columns), 'Leads'))
    const font = cell(2, 'LinkedIn Profile').font
    expect(font?.underline).toBeTruthy()
    expect(font?.color?.theme).toBe(10)
  })

  it('never writes a formula into any cell', async () => {
    const { sheet } = await readBack(await toXlsx(toTable(rows, columns), 'Leads'))
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        expect(cell.formula, String(cell.address)).toBeFalsy()
        expect(cell.type).not.toBe(ExcelJS.ValueType.Formula)
      })
    })
  })

  it('keeps the hostile name as inert, sanitized text', async () => {
    const { cell } = await readBack(await toXlsx(toTable(rows, columns), 'Leads'))
    const name = cell(2, 'Name')
    expect(name.type).toBe(ExcelJS.ValueType.String)
    expect(name.value).toBe("'=cmd|'/c calc'!A1")
  })

  it('does not link a non-http scheme, or text that merely contains a URL', async () => {
    const { cell } = await readBack(await toXlsx(toTable(rows, columns), 'Leads'))
    expect(cell(2, 'Notes').value).toBe('javascript:alert(1)')
    expect(cell(3, 'Notes').value).toBe('see https://example.com')
  })

  it('keeps numbers as numbers and sanitizes a leading +', async () => {
    const { cell } = await readBack(await toXlsx(toTable(rows, columns), 'Leads'))
    expect(cell(2, 'List Count').value).toBe(3)
    expect(cell(3, 'List Count').value).toBe(0)
    expect(cell(3, 'Job Title').value).toBe("'+44 lead")
  })

  it('writes N/A for a missing value, exactly as the CSV does', async () => {
    const { cell } = await readBack(await toXlsx(toTable(rows, columns), 'Leads'))
    expect(cell(3, 'LinkedIn Profile').value).toBe('N/A')
  })

  it('freezes and bolds the header row', async () => {
    const { sheet } = await readBack(await toXlsx(toTable(rows, columns), 'Leads'))
    expect(sheet.getRow(1).font?.bold).toBe(true)
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
  })

  it('refuses characters Excel forbids in a sheet name', async () => {
    const { sheet } = await readBack(await toXlsx(toTable(rows, columns), 'Leads/[2026]:*?'))
    expect(sheet.name).not.toMatch(/[[\]:*?/\\]/)
    expect(sheet.name.length).toBeLessThanOrEqual(31)
  })
})

/*
 * ⚠️ THE TWO DOWNLOADS OF ONE JOB MUST MATCH. `toCsv` was refactored onto
 * `toTable` so both writers share one shaping step; this proves the CSV is
 * byte-for-byte what `toTable` describes, so the workbook cannot drift from it.
 */
describe('toTable and toCsv agree', () => {
  it('serialises exactly the headers and cells toTable produces', () => {
    const table = toTable(rows, columns)
    const csv = toCsv(rows, columns, { bom: false })
    const csvField = (v: string | number) => {
      const s = String(v)
      return /["\r\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const expected =
      [table.headers, ...table.rows].map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n'
    expect(csv).toBe(expected)
  })

  it('drops an all-empty column from both, unless pinned', () => {
    const sparse: Row[] = [{ Name: 'A', Empty: null }, { Name: 'B', Empty: '' }]
    const cols: CsvColumn<Row>[] = ['Name', 'Empty'].map((header) => ({ header, value: (r: Row) => r[header] ?? null }))

    expect(toTable(sparse, cols).headers).toEqual(['Name'])
    expect(toTable(sparse, cols, { alwaysKeep: ['Empty'] }).headers).toEqual(['Name', 'Empty'])
  })
})

describe('the Excel download is reachable', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8')

  it('is offered in the export menu beside the CSV', () => {
    const menu = read('components/jobs/RowActions.tsx')
    expect(menu).toContain('/api/exports/xlsx?job=')
    expect(menu).toContain('<DownloadExcel')
  })

  it('uses the same access gate as the CSV download, not a bare session check', () => {
    const route = read('app/api/exports/xlsx/route.ts')
    expect(route).toContain('assertAccess()')
  })

  /*
   * Every other `export` action is O(1); this one rebuilds the whole job per
   * request, so it gets its own, tighter bucket rather than sharing theirs.
   */
  it('is rate-limited on its own bucket, tighter than the shared export one', async () => {
    const route = read('app/api/exports/xlsx/route.ts')
    expect(route).toContain('consume(ACTION_LIMITS.workbook')
    expect(route).not.toContain('consume(ACTION_LIMITS.export')

    const { ACTION_LIMITS } = await import('@/lib/security/action-limits')
    expect(ACTION_LIMITS.workbook.bucket).not.toBe(ACTION_LIMITS.export.bucket)
    expect(ACTION_LIMITS.workbook.maxAttempts).toBeLessThan(ACTION_LIMITS.export.maxAttempts)
  })

  it('reuses the CSV row builders instead of re-deriving columns', () => {
    const builder = read('lib/export/job-workbook.ts')
    expect(builder).toContain('leadExportShape(')
    expect(builder).toContain('accountExportShape(')
    expect(builder).toContain('toTable(')
  })
})
