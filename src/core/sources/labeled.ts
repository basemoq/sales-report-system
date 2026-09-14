import type { CellValue, SheetData } from '../workbook'
import { matchKey } from '../text'

const isBlank = (cell: CellValue) => cell === null || String(cell).trim() === ''

/**
 * Reads a value written next to a label rather than under a header — the way a
 * sheet states its shop id or location in a banner above the table. The value
 * is taken from the cell after the label, then before it (RTL layouts put it
 * there), then directly below.
 */
export function findLabeledValue(
  sheets: readonly SheetData[],
  aliases: readonly string[],
): CellValue {
  const wanted = new Set(aliases.map(matchKey))

  for (const sheet of sheets) {
    for (let r = 0; r < sheet.rows.length; r += 1) {
      const row = sheet.rows[r]
      for (let c = 0; c < row.length; c += 1) {
        const cell = row[c]
        if (typeof cell !== 'string') continue

        // Labels are often written with a trailing colon.
        const label = matchKey(cell.replace(/[:：]\s*$/, ''))
        if (!wanted.has(label)) continue

        const candidates: CellValue[] = [
          row[c + 1] ?? null,
          c > 0 ? (row[c - 1] ?? null) : null,
          sheet.rows[r + 1]?.[c] ?? null,
        ]
        const value = candidates.find((candidate) => !isBlank(candidate))
        if (value !== undefined) return value
      }
    }
  }

  return null
}

export function findLabeledText(
  sheets: readonly SheetData[],
  aliases: readonly string[],
): string | null {
  const value = findLabeledValue(sheets, aliases)
  if (isBlank(value)) return null
  return String(value).trim()
}
