import type { CellValue } from '../workbook'
import { matchKey } from '../text'

export interface ColumnSpec {
  /** Field name the matched column index is reported under. */
  key: string
  /** Header labels that identify this column, in any spelling variant. */
  aliases: string[]
  required?: boolean
}

export interface HeaderMatch {
  /** 0-indexed row holding the headers. */
  headerRowIndex: number
  /** Field key → 0-indexed column. */
  columns: Record<string, number>
  /** Keys from the spec that were required but absent. */
  missing: string[]
}

/** How far into the sheet a header row may sit, past title and logo bands. */
const MAX_HEADER_SCAN_ROWS = 30

function matchRow(row: CellValue[], specs: ColumnSpec[]): Record<string, number> {
  const aliasToKey = new Map<string, string>()
  for (const spec of specs) {
    for (const alias of spec.aliases) {
      aliasToKey.set(matchKey(alias), spec.key)
    }
  }

  const columns: Record<string, number> = {}
  row.forEach((cell, index) => {
    if (typeof cell !== 'string') return
    const key = aliasToKey.get(matchKey(cell))
    // First column wins, so a repeated label later in the row cannot shadow it.
    if (key !== undefined && !(key in columns)) columns[key] = index
  })
  return columns
}

/**
 * Locates the header row and maps each spec'd field to its column. Source
 * exports put titles, dates and logos above the table, so the header is found
 * by content rather than assumed to be row 1. The row matching the most spec'd
 * fields wins.
 */
export function findHeaderRow(rows: CellValue[][], specs: ColumnSpec[]): HeaderMatch | null {
  const limit = Math.min(rows.length, MAX_HEADER_SCAN_ROWS)
  let best: HeaderMatch | null = null

  for (let index = 0; index < limit; index += 1) {
    const columns = matchRow(rows[index], specs)
    const matched = Object.keys(columns).length
    if (matched === 0) continue

    const bestMatched = best === null ? 0 : Object.keys(best.columns).length
    if (matched > bestMatched) {
      best = { headerRowIndex: index, columns, missing: [] }
    }
  }

  if (best === null) return null

  best.missing = specs
    .filter((spec) => spec.required && !(spec.key in best!.columns))
    .map((spec) => spec.key)
  return best
}

/** Rows below the header, with fully blank rows dropped. */
export function dataRows(rows: CellValue[][], header: HeaderMatch): CellValue[][] {
  return rows
    .slice(header.headerRowIndex + 1)
    .filter((row) => row.some((cell) => cell !== null && String(cell).trim() !== ''))
}

export function cellAt(row: CellValue[], header: HeaderMatch, key: string): CellValue {
  const index = header.columns[key]
  return index === undefined ? null : (row[index] ?? null)
}
