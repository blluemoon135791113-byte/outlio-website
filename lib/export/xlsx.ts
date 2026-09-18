import 'server-only'

/**
 * The Excel writer — the second of the two writers `sanitizeCell` serves.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  WHY THIS FILE EXISTS: A CSV CANNOT HOLD A LINK.                         ║
 * ║                                                                           ║
 * ║  The only way to make a CSV cell clickable in Excel is to write           ║
 * ║  `=HYPERLINK(...)` into it, and that is exactly what SCRAPER_AUDIT §H2    ║
 * ║  forbids: lead text is attacker-controlled, so no exported cell may ever  ║
 * ║  hold a formula. The approved resolution was to keep URLs as plain text   ║
 * ║  and "re-create clickable links at export time via the XLSX writer's link ║
 * ║  API". This is that writer.                                               ║
 * ║                                                                           ║
 * ║  A hyperlink here is a relationship in the file's package, not a formula  ║
 * ║  in the cell. The cell holds the URL as text; Excel opens it on Ctrl+click.║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ IT SERIALISES AN `ExportTable`, IT DOES NOT SHAPE ONE. Column dropping,
 * `N/A` and `sanitizeCell` all happen in `toTable`, which the CSV uses too — so
 * the workbook and the CSV of the same job have identical columns and cells.
 */
import ExcelJS from 'exceljs'

import { linkableUrl } from '@/lib/export/links'
import type { ExportTable } from '@/lib/export/sanitize'

/*
 * ⚠️ A THEME SLOT, NOT A COLOUR. Office themes reserve index 10 for hyperlinks
 * ("hlink"); Excel's own built-in Hyperlink style points at it. Using the slot
 * means the link looks exactly like one the user typed, follows the workbook's
 * theme, and puts no colour literal in the codebase.
 */
const HYPERLINK_THEME_COLOR = 10

/*
 * One definition of what a link looks like. Sharing it is a readability choice,
 * not a speed one: measured against a fresh object per cell at 10,000 rows, the
 * difference was inside the noise. It is never mutated.
 */
const LINK_FONT = { color: { theme: HYPERLINK_THEME_COLOR }, underline: true }

/** Sensible column widths in characters: readable, never absurdly wide. */
const MIN_WIDTH = 10
const MAX_WIDTH = 60

/** Excel refuses these characters in a sheet name, and names over 31 chars. */
function safeSheetName(name: string): string {
  return name.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet1'
}

/**
 * Serialises a shaped table to an .xlsx workbook, with every URL cell clickable.
 *
 * A cell becomes a link only when `linkableUrl` says so — its whole value is one
 * http(s) address — and the link target is exactly the text shown. Everything
 * else is written as a plain value: numbers stay numbers, and text stays text,
 * including a sanitized `'=cmd…`, which is a string here and never a formula.
 */
export async function toXlsx(table: ExportTable, sheetName: string): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Outlio'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet(safeSheetName(sheetName), {
    // The header stays visible while scrolling a long list.
    views: [{ state: 'frozen', ySplit: 1 }],
  })

  const header = sheet.addRow(table.headers.map(String))
  header.font = { bold: true }

  for (const values of table.rows) {
    const row = sheet.addRow(values)

    values.forEach((value, index) => {
      const url = linkableUrl(value)
      if (!url) return

      const cell = row.getCell(index + 1)
      cell.value = { text: url, hyperlink: url }
      cell.font = LINK_FONT
    })
  }

  sheet.columns.forEach((column, index) => {
    const longest = Math.max(
      String(table.headers[index] ?? '').length,
      ...table.rows.map((row) => String(row[index] ?? '').length),
    )
    column.width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, longest + 2))
  })

  return new Uint8Array(await workbook.xlsx.writeBuffer())
}
