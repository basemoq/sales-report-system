import { describe, expect, it } from 'vitest'
import type { CellValue } from '../workbook'
import { cellAt, dataRows, findHeaderRow, type ColumnSpec } from './headers'

const SPECS: ColumnSpec[] = [
  { key: 'date', aliases: ['التاريخ', 'Date'], required: true },
  { key: 'location', aliases: ['الموقع', 'الفرع', 'Location'], required: true },
  { key: 'amount', aliases: ['المبلغ', 'صافي المبيعات', 'Amount'], required: true },
  { key: 'employee', aliases: ['الموظف', 'Employee'] },
]

describe('findHeaderRow', () => {
  it('maps each specified field to its column', () => {
    const rows: CellValue[][] = [
      ['التاريخ', 'الموقع', 'المبلغ'],
      ['2025-03-01', 'الرياض', 100],
    ]
    const header = findHeaderRow(rows, SPECS)

    expect(header?.headerRowIndex).toBe(0)
    expect(header?.columns).toEqual({ date: 0, location: 1, amount: 2 })
    expect(header?.missing).toEqual([])
  })

  it('finds a header sitting below a title band', () => {
    const rows: CellValue[][] = [
      ['تقرير المبيعات اليومية', null, null],
      ['الفترة: مارس 2025', null, null],
      [null, null, null],
      ['التاريخ', 'الموقع', 'المبلغ'],
      ['2025-03-01', 'الرياض', 100],
    ]
    expect(findHeaderRow(rows, SPECS)?.headerRowIndex).toBe(3)
  })

  it('matches a header despite spelling variants', () => {
    const rows: CellValue[][] = [['التاريـخ', 'الفــرع', 'صافي  المبيعات']]
    expect(findHeaderRow(rows, SPECS)?.columns).toEqual({ date: 0, location: 1, amount: 2 })
  })

  it('matches English headers from the same spec', () => {
    const rows: CellValue[][] = [['Date', 'Location', 'Amount']]
    expect(findHeaderRow(rows, SPECS)?.columns).toEqual({ date: 0, location: 1, amount: 2 })
  })

  it('reports a required column the sheet does not carry', () => {
    const rows: CellValue[][] = [['التاريخ', 'المبلغ']]
    expect(findHeaderRow(rows, SPECS)?.missing).toEqual(['location'])
  })

  it('leaves an optional column out of the map without reporting it missing', () => {
    const rows: CellValue[][] = [['التاريخ', 'الموقع', 'المبلغ']]
    const header = findHeaderRow(rows, SPECS)
    expect(header?.columns.employee).toBeUndefined()
    expect(header?.missing).toEqual([])
  })

  it('prefers the row matching the most fields', () => {
    const rows: CellValue[][] = [
      ['التاريخ', null, null],
      ['التاريخ', 'الموقع', 'المبلغ'],
    ]
    expect(findHeaderRow(rows, SPECS)?.headerRowIndex).toBe(1)
  })

  it('keeps the first of a repeated label', () => {
    const rows: CellValue[][] = [['المبلغ', 'الموقع', 'المبلغ']]
    expect(findHeaderRow(rows, SPECS)?.columns.amount).toBe(0)
  })

  it('returns null when no row looks like a header', () => {
    const rows: CellValue[][] = [
      ['a', 'b'],
      ['c', 'd'],
    ]
    expect(findHeaderRow(rows, SPECS)).toBeNull()
  })
})

describe('dataRows', () => {
  it('returns the rows under the header and drops blank ones', () => {
    const rows: CellValue[][] = [
      ['التاريخ', 'الموقع', 'المبلغ'],
      ['2025-03-01', 'الرياض', 100],
      [null, null, null],
      ['   ', '', null],
      ['2025-03-02', 'جدة', 200],
    ]
    const header = findHeaderRow(rows, SPECS)!
    expect(dataRows(rows, header)).toEqual([
      ['2025-03-01', 'الرياض', 100],
      ['2025-03-02', 'جدة', 200],
    ])
  })
})

describe('cellAt', () => {
  it('reads a mapped column, and null for one the sheet lacks', () => {
    const rows: CellValue[][] = [
      ['التاريخ', 'الموقع', 'المبلغ'],
      ['2025-03-01', 'الرياض', 100],
    ]
    const header = findHeaderRow(rows, SPECS)!
    expect(cellAt(rows[1], header, 'location')).toBe('الرياض')
    expect(cellAt(rows[1], header, 'employee')).toBeNull()
  })
})
