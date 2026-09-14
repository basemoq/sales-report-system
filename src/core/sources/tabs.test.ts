import { describe, expect, it } from 'vitest'
import { toISODate } from '../dates'
import type { PdfTextItem } from '../pdf'
import { parseTabsReport, TabsFormatError } from './tabs'

const at = (page: number, y: number, x: number, text: string): PdfTextItem => ({
  page,
  y,
  x,
  text,
})

/** The banner every page of the export carries, drawn as two runs. */
const banner = (page: number): PdfTextItem[] => [
  at(page, 988, 46, 'Date/Time:'),
  at(page, 987, 113, '13/09/2026'),
  at(page, 987, 177, '08:49 AM'),
  at(page, 940, 339, 'Consolidated'),
  at(page, 940, 464, 'Report'),
  at(page, 928, 47, 'Report Name: ARMBOCD'),
]

/** `Grand Total` prints letter-spaced, and its value a couple of points off. */
const grandTotal = (page: number, y: number, amount?: string): PdfTextItem[] => [
  at(page, y, 581, 'G r a n d T o t a l :'),
  ...(amount === undefined ? [] : [at(page, y + 2, 790, amount)]),
]

describe('parseTabsReport', () => {
  it('reads each section grand total', () => {
    const items = [
      ...banner(1),
      at(1, 897, 369, 'Bill Payment Report'),
      at(1, 872, 261, 'Warehouse:'),
      at(1, 872, 325, 'WFW430'),
      ...grandTotal(1, 570, '723.300'),
      ...banner(2),
      at(2, 895, 386, 'Ordring Report'),
      ...grandTotal(2, 877, '140.500'),
      ...banner(3),
      at(3, 893, 329, 'Cashiers Collection-Cash Report'),
      ...grandTotal(3, 876, '95.250'),
    ]

    expect(parseTabsReport(items).totals).toEqual({
      billPayment: 723.3,
      ordering: 140.5,
      cashCollection: 95.25,
    })
  })

  it('reads an empty grand total box as zero', () => {
    const items = [
      ...banner(1),
      at(1, 897, 369, 'Bill Payment Report'),
      ...grandTotal(1, 570, '723.300'),
      ...banner(2),
      at(2, 895, 386, 'Ordring Report'),
      ...grandTotal(2, 877),
    ]

    const totals = parseTabsReport(items).totals
    expect(totals.billPayment).toBeCloseTo(723.3, 2)
    expect(totals.ordering).toBe(0)
  })

  it('reads a section with no grand total line at all as zero', () => {
    const items = [
      ...banner(1),
      at(1, 897, 369, 'Bill Payment Report'),
      ...grandTotal(1, 570, '723.300'),
      ...banner(2),
      at(2, 893, 329, 'Cashiers Collection-Cash Report'),
    ]

    expect(parseTabsReport(items).totals.cashCollection).toBe(0)
  })

  it('takes the grand total from the last page of a section that spans pages', () => {
    const items = [
      ...banner(1),
      at(1, 893, 329, 'Cashiers Collection-Cash Report'),
      ...banner(2),
      at(2, 893, 329, 'Cashiers Collection-Cash Report'),
      ...grandTotal(2, 876, '410.000'),
    ]

    expect(parseTabsReport(items).totals.cashCollection).toBe(410)
  })

  it('ignores a sub total, which prints the same way as a grand total', () => {
    const items = [
      ...banner(1),
      at(1, 897, 369, 'Bill Payment Report'),
      at(1, 804, 593, 'S u b T o t a l :'),
      at(1, 804, 790, '149.360'),
      ...grandTotal(1, 570, '723.300'),
    ]

    expect(parseTabsReport(items).totals.billPayment).toBeCloseTo(723.3, 2)
  })

  it('accepts the correctly spelled Ordering Report heading', () => {
    const items = [
      ...banner(1),
      at(1, 895, 386, 'Ordering Report'),
      ...grandTotal(1, 877, '50.000'),
    ]
    expect(parseTabsReport(items).totals.ordering).toBe(50)
  })

  it('reads the warehouse and generation date from the banner', () => {
    const items = [
      ...banner(1),
      at(1, 897, 369, 'Bill Payment Report'),
      at(1, 872, 261, 'Warehouse:'),
      at(1, 872, 325, 'WFW430'),
      ...grandTotal(1, 570, '723.300'),
    ]

    const report = parseTabsReport(items)
    expect(report.warehouse).toBe('WFW430')
    expect(toISODate(report.generatedOn!)).toBe('2026-09-13')
  })

  it('lists the sections it recognised', () => {
    const items = [
      ...banner(1),
      at(1, 897, 369, 'Bill Payment Report'),
      ...grandTotal(1, 570, '723.300'),
      ...banner(2),
      at(2, 895, 386, 'Ordring Report'),
      ...grandTotal(2, 877),
    ]

    expect(parseTabsReport(items).sectionsFound).toEqual([
      'Bill Payment Report',
      'Ordring Report',
    ])
  })

  it('refuses a PDF that is not a consolidated TABS export', () => {
    expect(() => parseTabsReport([at(1, 700, 100, 'Some other document')])).toThrow(
      TabsFormatError,
    )
  })

  it('ignores a value drawn to the left of the label', () => {
    const items = [
      ...banner(1),
      at(1, 897, 369, 'Bill Payment Report'),
      at(1, 570, 100, '999.000'),
      ...grandTotal(1, 570),
    ]

    expect(parseTabsReport(items).totals.billPayment).toBe(0)
  })
})
