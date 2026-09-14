import { describe, expect, it } from 'vitest'
import { toISODate } from '../dates'
import type { CellValue, SheetData } from '../workbook'
import {
  CacoFormatError,
  checkDetailedTotal,
  isCacoDetailed,
  isCacoSummary,
  parseCacoDetailed,
  parseCacoSummary,
  totalsByPaymentMethod,
} from './caco'

const sheet = (rows: CellValue[][]): SheetData[] => [{ name: 'Sheet', rows }]

/**
 * Mirrors the real summary export: a title, a parameter band, a row-count band,
 * then the order-type × payment-method matrix closed by a total row.
 */
function summarySheet(
  rows: CellValue[][] = [
    ['Top Up', 235, 188, 0, 0],
    ['Refund', 0, 0, 0, 0],
    ['Invoice Payment', 2048.39, 241.59, 0, 0],
    ['Sales Order Payment', 230.36, 1180.8, 0, 0],
    ['EVD Voucher', 0, 0, 0, 0],
    ['total', 2513.75, 1610.39, 0, 0],
  ],
): SheetData[] {
  return sheet([
    ['Finance CACO report (summary)'],
    [],
    ['Specified Report Parameters', 'Specified Report Parameters', 'Specified Report Parameters'],
    ['Parameter', 'Value', 'Parameter Type'],
    ['Transaction Date & Time From', 'Sep 13,2026 00:00', 'External'],
    ['Transaction Date & Time To', 'Sep 13,2026 23:59', 'Simple'],
    ['Shop ID', 'WFW430', 'Calculable'],
    ['User ID', 'All', 'Simple'],
    ['Report Results', '6 rows total', '6 rows total', '6 rows total', '6 rows total'],
    ['PAYMENT_ORDER_TYPE', 'Cash', 'SPAN Offline', 'Bank Transfer', 'Payment Link'],
    ...rows,
    ['6 rows are displayed', '6 rows are displayed'],
  ])
}

const DETAILED_HEADER: CellValue[] = [
  'User ID',
  'User Full Name',
  'Manager',
  'Shop ID',
  'Contact Person',
  'City',
  'Region',
  'Distribution channel',
  'Partner Name',
  'Account',
  'Prepaid/Postpaid',
  'Sub no (MSISDN)',
  'Time',
  'Date',
  'Receipt No',
  'Amount',
  'Payment Method',
  'Payment Order type/Description',
  'Sales order number',
  'Sales order Status',
]

const tx = (
  userId: string,
  amount: number,
  method: string,
  date = '13-Sep-2026',
): CellValue[] => [
  userId, userId, 'Hussain.Khorma', 'WFW430', 'Basem.Alawalgy', 'Mecca', 'Western Region',
  'FBO South', 'Southwind', '1001053035', 'Prepaid', '966541703895', '5:38 PM', date,
  'ZN_fde6cc55', amount, method, 'Setup Fee', '1054040706', 'Processed',
]

function detailedSheet(
  rows: CellValue[][],
  total: number | null = 4124.14,
): SheetData[] {
  return sheet([
    ['Finance CACO report (detailed)'],
    [],
    ['Specified Report Parameters', 'Specified Report Parameters'],
    ['Parameter', 'Value'],
    ['Transaction Date & Time From', 'Sep 13,2026 00:00'],
    ['Transaction Date & Time To', 'Sep 13,2026 23:59'],
    ['Shop ID', 'WFW430'],
    ['User ID', 'All'],
    ['Payment Method', 'All'],
    [],
    ['Report Results', '24 rows total'],
    DETAILED_HEADER,
    ...rows,
    ...(total === null ? [] : [['Total amount:', total] as CellValue[]]),
    ['24 rows are displayed', '24 rows are displayed'],
  ])
}

describe('report identification', () => {
  it('tells the two CACO exports apart by their title', () => {
    expect(isCacoSummary(summarySheet())).toBe(true)
    expect(isCacoDetailed(summarySheet())).toBe(false)
    expect(isCacoDetailed(detailedSheet([tx('a', 10, 'Cash')]))).toBe(true)
    expect(isCacoSummary(detailedSheet([tx('a', 10, 'Cash')]))).toBe(false)
  })

  it('does not mistake an unrelated workbook for a CACO export', () => {
    expect(isCacoSummary(sheet([['تقرير مبيعات المعارض اليومي']]))).toBe(false)
    expect(isCacoDetailed(sheet([[null]]))).toBe(false)
  })
})

describe('parseCacoSummary', () => {
  it('reads the shop and date range from the parameter band', () => {
    const report = parseCacoSummary(summarySheet())

    expect(report.parameters.shopId).toBe('WFW430')
    expect(toISODate(report.parameters.from!)).toBe('2026-09-13')
    expect(toISODate(report.parameters.to!)).toBe('2026-09-13')
  })

  it('reads the payment methods from the matrix header', () => {
    expect(parseCacoSummary(summarySheet()).paymentMethods).toEqual([
      'Cash',
      'SPAN Offline',
      'Bank Transfer',
      'Payment Link',
    ])
  })

  it('reads each order type against every payment method', () => {
    const report = parseCacoSummary(summarySheet())
    const invoice = report.rows.find((row) => row.orderType === 'Invoice Payment')!

    expect(invoice.byMethod).toEqual({
      Cash: 2048.39,
      'SPAN Offline': 241.59,
      'Bank Transfer': 0,
      'Payment Link': 0,
    })
    expect(invoice.total).toBeCloseTo(2289.98, 2)
  })

  it('keeps the total band out of the order-type rows', () => {
    const report = parseCacoSummary(summarySheet())

    expect(report.rows.map((row) => row.orderType)).toEqual([
      'Top Up',
      'Refund',
      'Invoice Payment',
      'Sales Order Payment',
      'EVD Voucher',
    ])
    expect(report.reportedTotals).toEqual({
      Cash: 2513.75,
      'SPAN Offline': 1610.39,
      'Bank Transfer': 0,
      'Payment Link': 0,
    })
    expect(report.grandTotal).toBeCloseTo(4124.14, 2)
  })

  it('ignores the row-count bands the export frames the matrix with', () => {
    expect(parseCacoSummary(summarySheet()).rows).toHaveLength(5)
  })

  it('counts a repeated merged header only once', () => {
    const sheets = summarySheet()
    sheets[0].rows[9] = ['PAYMENT_ORDER_TYPE', 'Cash', 'Cash', 'SPAN Offline']
    expect(parseCacoSummary(sheets).paymentMethods).toEqual(['Cash', 'SPAN Offline'])
  })

  it('refuses a file with no Shop ID to attribute the figures to', () => {
    const sheets = summarySheet()
    sheets[0].rows[6] = ['User ID', 'All', 'Simple']
    expect(() => parseCacoSummary(sheets)).toThrow(CacoFormatError)
  })

  it('refuses a file whose matrix header is missing', () => {
    const sheets = summarySheet()
    sheets[0].rows[9] = ['Something Else', 'Cash']
    expect(() => parseCacoSummary(sheets)).toThrow(/PAYMENT_ORDER_TYPE/)
  })
})

describe('parseCacoDetailed', () => {
  const rows = [
    tx('mansour.alremy', 40.25, 'SPAN Offline'),
    tx('Basem.Alawalgy', 10, 'SPAN Offline'),
    tx('Ali.Malzahrani', 470, 'Cash'),
  ]

  it('reads one transaction per row', () => {
    const report = parseCacoDetailed(detailedSheet(rows, 520.25))

    expect(report.transactions).toHaveLength(3)
    expect(report.skippedRows).toBe(0)
    expect(report.transactions[0]).toMatchObject({
      userId: 'mansour.alremy',
      manager: 'Hussain.Khorma',
      shopId: 'WFW430',
      time: '5:38 PM',
      amount: 40.25,
      paymentMethod: 'SPAN Offline',
      status: 'Processed',
    })
    expect(toISODate(report.transactions[0].date)).toBe('2026-09-13')
  })

  it('reads the total band the export closes with', () => {
    expect(parseCacoDetailed(detailedSheet(rows, 520.25)).reportedTotal).toBe(520.25)
  })

  it('totals the amounts per payment method', () => {
    const report = parseCacoDetailed(detailedSheet(rows, 520.25))
    expect(totalsByPaymentMethod(report.transactions)).toEqual({
      'SPAN Offline': 50.25,
      Cash: 470,
    })
  })

  it('confirms the rows read add up to the total the export printed', () => {
    const check = checkDetailedTotal(parseCacoDetailed(detailedSheet(rows, 520.25)))
    expect(check).toMatchObject({ ok: true, summed: 520.25, reported: 520.25 })
  })

  it('reports a mismatch between the rows read and the printed total', () => {
    const check = checkDetailedTotal(parseCacoDetailed(detailedSheet(rows, 999)))
    expect(check.ok).toBe(false)
    expect(check.difference).toBeCloseTo(-478.75, 2)
  })

  it('accepts a file with no printed total to check against', () => {
    const check = checkDetailedTotal(parseCacoDetailed(detailedSheet(rows, null)))
    expect(check).toMatchObject({ ok: true, reported: null })
  })

  it('counts a row it could not read rather than dropping it silently', () => {
    const broken = tx('someone', 10, 'Cash')
    broken[15] = 'غير متاح' // Amount
    const report = parseCacoDetailed(detailedSheet([...rows, broken], 520.25))

    expect(report.transactions).toHaveLength(3)
    expect(report.skippedRows).toBe(1)
  })

  it('refuses a file whose header lacks the columns the figures come from', () => {
    const sheets = detailedSheet(rows)
    sheets[0].rows[11] = ['User ID', 'City', 'Region']
    expect(() => parseCacoDetailed(sheets)).toThrow(CacoFormatError)
  })

  it('reads a multi-line order description as one value', () => {
    const multiline = tx('x', 259, 'SPAN Offline')
    multiline[17] = '"Deposit Product"\n"Physical SIM"\nSetup Fee'
    const report = parseCacoDetailed(detailedSheet([multiline], 259))

    expect(report.transactions[0].orderType).toBe('"Deposit Product"\n"Physical SIM"\nSetup Fee')
  })
})
