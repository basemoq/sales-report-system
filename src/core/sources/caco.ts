import { parseDateCell } from '../dates'
import { matchKey, parseNumber } from '../text'
import type { CellValue, SheetData } from '../workbook'
import { cellAt, dataRows, findHeaderRow, type ColumnSpec } from './headers'
import { findLabeledText } from './labeled'

export class CacoFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CacoFormatError'
  }
}

export interface CacoParameters {
  shopId: string
  from: Date | null
  to: Date | null
}

export interface CacoSummaryRow {
  orderType: string
  /** Payment method → amount, keyed by the method names the export used. */
  byMethod: Record<string, number>
  total: number
}

export interface CacoSummary {
  parameters: CacoParameters
  paymentMethods: string[]
  rows: CacoSummaryRow[]
  /** The export's own total band, per method. */
  reportedTotals: Record<string, number>
  grandTotal: number
}

export interface CacoTransaction {
  userId: string
  userFullName: string | null
  manager: string | null
  shopId: string | null
  date: Date
  time: string | null
  receiptNo: string | null
  amount: number
  paymentMethod: string
  orderType: string | null
  salesOrderNumber: string | null
  status: string | null
}

export interface CacoDetailed {
  parameters: CacoParameters
  transactions: CacoTransaction[]
  /** The `Total amount:` band the export closes with, when present. */
  reportedTotal: number | null
  /** Rows below the header that carried no readable transaction. */
  skippedRows: number
}

const SHOP_ID_LABELS = ['Shop ID']
const FROM_LABELS = ['Transaction Date & Time From']
const TO_LABELS = ['Transaction Date & Time To']

const SUMMARY_TITLE = matchKey('Finance CACO report (summary)')
const DETAILED_TITLE = matchKey('Finance CACO report (detailed)')
const ORDER_TYPE_HEADER = matchKey('PAYMENT_ORDER_TYPE')
const TOTAL_ROW = new Set([matchKey('total'), matchKey('Total amount:'), matchKey('Total amount')])

/** `N rows are displayed` / `N rows total` — the export's own framing bands. */
const ROW_COUNT_BAND = /rows?\s+(are\s+displayed|total)/i

const text = (cell: CellValue): string | null => {
  if (cell === null) return null
  const value = String(cell).trim()
  return value === '' ? null : value
}

function readParameters(sheets: readonly SheetData[]): CacoParameters {
  const shopId = findLabeledText(sheets, SHOP_ID_LABELS)
  if (shopId === null) {
    throw new CacoFormatError('تعذّر العثور على Shop ID في بيانات التقرير.')
  }
  return {
    shopId,
    from: parseDateCell(findLabeledText(sheets, FROM_LABELS)),
    to: parseDateCell(findLabeledText(sheets, TO_LABELS)),
  }
}

function titleOf(sheets: readonly SheetData[]): string {
  const first = sheets[0]?.rows[0]?.[0]
  return typeof first === 'string' ? matchKey(first) : ''
}

export function isCacoSummary(sheets: readonly SheetData[]): boolean {
  return titleOf(sheets) === SUMMARY_TITLE
}

export function isCacoDetailed(sheets: readonly SheetData[]): boolean {
  return titleOf(sheets) === DETAILED_TITLE
}

const isFramingBand = (row: CellValue[]) =>
  row.some((cell) => typeof cell === 'string' && ROW_COUNT_BAND.test(cell))

/**
 * Reads the summary export's matrix of payment order types against payment
 * methods. The export repeats each merged cell across its span, so a method is
 * only counted once per column position.
 */
export function parseCacoSummary(sheets: readonly SheetData[]): CacoSummary {
  const parameters = readParameters(sheets)
  const sheet = sheets[0]
  if (!sheet) throw new CacoFormatError('الملف لا يحتوي على أي ورقة عمل.')

  const headerIndex = sheet.rows.findIndex(
    (row) => typeof row[0] === 'string' && matchKey(row[0]) === ORDER_TYPE_HEADER,
  )
  if (headerIndex === -1) {
    throw new CacoFormatError('تعذّر العثور على صف PAYMENT_ORDER_TYPE في تقرير CACO المختصر.')
  }

  const headerRow = sheet.rows[headerIndex]
  const methodColumns: { method: string; column: number }[] = []
  const seen = new Set<string>()
  for (let column = 1; column < headerRow.length; column += 1) {
    const method = text(headerRow[column])
    if (method === null || seen.has(matchKey(method))) continue
    seen.add(matchKey(method))
    methodColumns.push({ method, column })
  }
  if (methodColumns.length === 0) {
    throw new CacoFormatError('صف PAYMENT_ORDER_TYPE لا يحتوي على أي طريقة دفع.')
  }

  const rows: CacoSummaryRow[] = []
  let reportedTotals: Record<string, number> = {}

  for (const row of sheet.rows.slice(headerIndex + 1)) {
    const label = text(row[0])
    if (label === null || isFramingBand(row)) continue

    const byMethod: Record<string, number> = {}
    for (const { method, column } of methodColumns) {
      byMethod[method] = parseNumber(row[column]) ?? 0
    }

    if (TOTAL_ROW.has(matchKey(label))) {
      reportedTotals = byMethod
      continue
    }

    rows.push({
      orderType: label,
      byMethod,
      total: Object.values(byMethod).reduce((sum, value) => sum + value, 0),
    })
  }

  return {
    parameters,
    paymentMethods: methodColumns.map(({ method }) => method),
    rows,
    reportedTotals,
    grandTotal: Object.values(reportedTotals).reduce((sum, value) => sum + value, 0),
  }
}

const DETAILED_COLUMNS: ColumnSpec[] = [
  { key: 'userId', aliases: ['User ID'], required: true },
  { key: 'userFullName', aliases: ['User Full Name'] },
  { key: 'manager', aliases: ['Manager'] },
  { key: 'shopId', aliases: ['Shop ID'] },
  { key: 'time', aliases: ['Time'] },
  { key: 'date', aliases: ['Date'], required: true },
  { key: 'receiptNo', aliases: ['Receipt No'] },
  { key: 'amount', aliases: ['Amount'], required: true },
  { key: 'paymentMethod', aliases: ['Payment Method'], required: true },
  { key: 'orderType', aliases: ['Payment Order type/Description'] },
  { key: 'salesOrderNumber', aliases: ['Sales order number'] },
  { key: 'status', aliases: ['Sales order Status'] },
]

/** Reads the per-transaction export, one row per receipt line. */
export function parseCacoDetailed(sheets: readonly SheetData[]): CacoDetailed {
  const parameters = readParameters(sheets)
  const sheet = sheets[0]
  if (!sheet) throw new CacoFormatError('الملف لا يحتوي على أي ورقة عمل.')

  const header = findHeaderRow(sheet.rows, DETAILED_COLUMNS)
  if (header === null || header.missing.length > 0) {
    throw new CacoFormatError(
      'تعذّر العثور على صف العناوين في تقرير CACO المفصّل (المطلوب: User ID و Date و Amount و Payment Method).',
    )
  }

  const transactions: CacoTransaction[] = []
  let reportedTotal: number | null = null
  let skippedRows = 0

  for (const row of dataRows(sheet.rows, header)) {
    const first = text(row[0])
    if (first !== null && TOTAL_ROW.has(matchKey(first))) {
      reportedTotal = parseNumber(row[1])
      continue
    }
    if (isFramingBand(row)) continue

    const date = parseDateCell(cellAt(row, header, 'date'))
    const amount = parseNumber(cellAt(row, header, 'amount'))
    const userId = text(cellAt(row, header, 'userId'))
    const paymentMethod = text(cellAt(row, header, 'paymentMethod'))

    if (date === null || amount === null || userId === null || paymentMethod === null) {
      skippedRows += 1
      continue
    }

    transactions.push({
      userId,
      userFullName: text(cellAt(row, header, 'userFullName')),
      manager: text(cellAt(row, header, 'manager')),
      shopId: text(cellAt(row, header, 'shopId')),
      date,
      time: text(cellAt(row, header, 'time')),
      receiptNo: text(cellAt(row, header, 'receiptNo')),
      amount,
      paymentMethod,
      orderType: text(cellAt(row, header, 'orderType')),
      salesOrderNumber: text(cellAt(row, header, 'salesOrderNumber')),
      status: text(cellAt(row, header, 'status')),
    })
  }

  return { parameters, transactions, reportedTotal, skippedRows }
}

/** Amounts per payment method, as the export names them. */
export function totalsByPaymentMethod(
  transactions: readonly CacoTransaction[],
): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const transaction of transactions) {
    totals[transaction.paymentMethod] =
      (totals[transaction.paymentMethod] ?? 0) + transaction.amount
  }
  return totals
}

/**
 * Compares the rows actually read against the total the export printed. A
 * mismatch means rows were dropped or double-counted, which is worth stopping
 * for rather than reporting a wrong figure.
 */
export function checkDetailedTotal(
  report: CacoDetailed,
  tolerance = 0.01,
): { ok: boolean; summed: number; reported: number | null; difference: number } {
  const summed = report.transactions.reduce((sum, t) => sum + t.amount, 0)
  if (report.reportedTotal === null) {
    return { ok: true, summed, reported: null, difference: 0 }
  }
  const difference = summed - report.reportedTotal
  return {
    ok: Math.abs(difference) <= tolerance,
    summed,
    reported: report.reportedTotal,
    difference,
  }
}
