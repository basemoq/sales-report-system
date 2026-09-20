import { describe, expect, it } from 'vitest'
import { formatDayLabel, formatMoney, reportFileName } from './format'

describe('reportFileName', () => {
  it('names the file after the report and the day it covers', () => {
    expect(reportFileName('2026-09-13')).toBe('sales-report-2026-09-13.xlsx')
  })

  // Chrome drops a `download` attribute that is not ASCII, and the file then
  // arrives as «download» with no extension — it will not open on a click.
  it('stays in characters a browser will keep', () => {
    expect(reportFileName('2026-09-13')).toMatch(/^[\x20-\x7e]+\.xlsx$/)
  })

  it('gives two days two file names, so neither overwrites the other', () => {
    expect(reportFileName('2026-09-13')).not.toBe(reportFileName('2026-09-14'))
  })
})

describe('formatMoney', () => {
  it('carries halalas and groups thousands, for checking against the export', () => {
    expect(formatMoney(1411.16)).toBe('1,411.16')
    expect(formatMoney(423)).toBe('423.00')
    expect(formatMoney(-50)).toBe('-50.00')
  })
})

describe('formatDayLabel', () => {
  it('names the weekday, which is what a daily report is checked against', () => {
    expect(formatDayLabel('2026-09-13')).toBe('2026-09-13 (الأحد)')
  })

  it('leaves an unreadable date alone', () => {
    expect(formatDayLabel('not a date')).toBe('not a date')
  })
})
