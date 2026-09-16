import { describe, expect, it } from 'vitest'
import { formatDayLabel, formatMoney, reportFileName } from './format'

describe('reportFileName', () => {
  it('names the file after the report and the day it covers', () => {
    expect(reportFileName('2026-09-13')).toBe('تقرير المبيعات المعارض 2026-09-13.xlsx')
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
