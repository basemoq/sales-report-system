import { describe, expect, it } from 'vitest'
import {
  eachDayInclusive,
  excelSerialToDate,
  parseDateCell,
  periodKey,
  reportIdFromDates,
  toISODate,
} from './dates'

const iso = (value: unknown) => {
  const parsed = parseDateCell(value)
  return parsed === null ? null : toISODate(parsed)
}

describe('parseDateCell', () => {
  it('reads a Date without shifting it across a timezone', () => {
    expect(iso(new Date(Date.UTC(2025, 2, 9)))).toBe('2025-03-09')
  })

  it('reads day-first text as written in the source reports', () => {
    expect(iso('09/03/2025')).toBe('2025-03-09')
    expect(iso('9-3-2025')).toBe('2025-03-09')
    expect(iso('31/12/2025')).toBe('2025-12-31')
  })

  it('reads ISO text', () => {
    expect(iso('2025-03-09')).toBe('2025-03-09')
    expect(iso('2025-03-09T14:30:00')).toBe('2025-03-09')
  })

  it('reads an Excel serial, as a number and as exported text', () => {
    expect(iso(45725)).toBe('2025-03-09')
    expect(iso('45725')).toBe('2025-03-09')
  })

  it('rejects a cell that does not hold a date', () => {
    expect(parseDateCell(null)).toBeNull()
    expect(parseDateCell('')).toBeNull()
    expect(parseDateCell('   ')).toBeNull()
    expect(parseDateCell('إجمالي')).toBeNull()
    expect(parseDateCell(true)).toBeNull()
  })

  it('rejects an impossible calendar date instead of rolling it over', () => {
    expect(parseDateCell('31/02/2025')).toBeNull()
    expect(parseDateCell('2025-13-01')).toBeNull()
  })
})

describe('excelSerialToDate', () => {
  it('maps serial 1 to 1900-01-01', () => {
    expect(toISODate(excelSerialToDate(1)!)).toBe('1900-01-01')
  })

  it('compensates for the 1900 leap-year bug before serial 60', () => {
    expect(toISODate(excelSerialToDate(59)!)).toBe('1900-02-28')
    expect(toISODate(excelSerialToDate(61)!)).toBe('1900-03-01')
  })

  it('rejects a serial outside the representable range', () => {
    expect(excelSerialToDate(0)).toBeNull()
    expect(excelSerialToDate(-5)).toBeNull()
  })

  it('drops the time-of-day fraction', () => {
    expect(toISODate(excelSerialToDate(45725.75)!)).toBe('2025-03-09')
  })
})

describe('periodKey', () => {
  it('groups a date under its year and month', () => {
    expect(periodKey(new Date(Date.UTC(2025, 2, 9)))).toBe('2025-03')
    expect(periodKey(new Date(Date.UTC(2025, 11, 31)))).toBe('2025-12')
  })
})

describe('reportIdFromDates', () => {
  it('identifies a report by the latest date it covers', () => {
    const dates = [
      new Date(Date.UTC(2025, 2, 1)),
      new Date(Date.UTC(2025, 2, 31)),
      new Date(Date.UTC(2025, 2, 15)),
    ]
    expect(reportIdFromDates(dates)).toBe('2025-03-31')
  })

  it('is order-independent', () => {
    const a = new Date(Date.UTC(2025, 2, 1))
    const b = new Date(Date.UTC(2025, 2, 31))
    expect(reportIdFromDates([a, b])).toBe(reportIdFromDates([b, a]))
  })

  it('returns null when there are no dates to identify the report by', () => {
    expect(reportIdFromDates([])).toBeNull()
  })
})

describe('eachDayInclusive', () => {
  it('includes both endpoints', () => {
    const days = eachDayInclusive(new Date(Date.UTC(2025, 2, 1)), new Date(Date.UTC(2025, 2, 3)))
    expect(days.map(toISODate)).toEqual(['2025-03-01', '2025-03-02', '2025-03-03'])
  })

  it('returns a single day when start equals end', () => {
    const day = new Date(Date.UTC(2025, 2, 1))
    expect(eachDayInclusive(day, day).map(toISODate)).toEqual(['2025-03-01'])
  })

  it('spans a month boundary', () => {
    const days = eachDayInclusive(new Date(Date.UTC(2025, 1, 27)), new Date(Date.UTC(2025, 2, 2)))
    expect(days.map(toISODate)).toEqual([
      '2025-02-27',
      '2025-02-28',
      '2025-03-01',
      '2025-03-02',
    ])
  })
})
