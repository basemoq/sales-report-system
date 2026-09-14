import { parseDateCell, toISODate } from '../dates'
import type { DayDetail, LocationSummary, SalesRecord } from '../model'
import { matchKey, parseNumber } from '../text'
import type { SheetData } from '../workbook'
import { cellAt, dataRows, findHeaderRow, type ColumnSpec } from './headers'
import { findLabeledText } from './labeled'

export interface ShoorFile {
  fileName: string
  sheets: SheetData[]
}

export interface LocationIdentity {
  shopId: string
  locationName: string
}

export interface RowProblem {
  fileName: string
  /** 1-based row number as it appears in the sheet. */
  rowNumber: number
  reason: string
}

export interface ShoorIngest {
  records: SalesRecord[]
  locations: LocationSummary[]
  /** Rows that could not be read; the rest of the file is still ingested. */
  problems: RowProblem[]
}

export class LocationConflictError extends Error {
  readonly conflicts: string[]

  constructor(conflicts: string[]) {
    super(`تعارض في تعريف المواقع:\n${conflicts.join('\n')}`)
    this.name = 'LocationConflictError'
    this.conflicts = conflicts
  }
}

export class MissingLocationError extends Error {
  readonly fileName: string

  constructor(fileName: string, detail: string) {
    super(`الملف "${fileName}": ${detail}`)
    this.name = 'MissingLocationError'
    this.fileName = fileName
  }
}

const SHOP_ID_LABELS = ['Shop ID', 'ShopID', 'Shop No', 'رقم الفرع', 'رقم الموقع', 'كود الفرع']
const LOCATION_LABELS = ['Location', 'Shop Name', 'الموقع', 'اسم الموقع', 'الفرع', 'اسم الفرع']

export const SHOOR_COLUMNS: ColumnSpec[] = [
  { key: 'date', aliases: ['التاريخ', 'Date', 'Business Date'], required: true },
  {
    key: 'amount',
    aliases: ['المبلغ', 'صافي المبيعات', 'Net Sales', 'Amount', 'Total'],
    required: true,
  },
  { key: 'employee', aliases: ['الموظف', 'الكاشير', 'Employee', 'Cashier'] },
  { key: 'transactions', aliases: ['عدد العمليات', 'Transactions', 'Checks', 'Count'] },
]

/** Reads the shop a file belongs to from the banner above its table. */
export function readLocationIdentity(file: ShoorFile): LocationIdentity {
  const shopId = findLabeledText(file.sheets, SHOP_ID_LABELS)
  const locationName = findLabeledText(file.sheets, LOCATION_LABELS)

  if (shopId === null) {
    throw new MissingLocationError(file.fileName, 'لم يُعثر على رقم الفرع (Shop ID).')
  }
  if (locationName === null) {
    throw new MissingLocationError(file.fileName, 'لم يُعثر على اسم الموقع.')
  }
  return { shopId, locationName }
}

/**
 * Resolves one shop identity per file and refuses the batch when they disagree.
 * A shop id carrying two names, or one name claimed by two shop ids, means the
 * upload mixes exports that cannot be combined, so processing stops rather than
 * silently merging two branches into one row.
 */
export function resolveLocations(
  files: readonly { fileName: string; identity: LocationIdentity }[],
): Map<string, string> {
  const byShopId = new Map<string, { name: string; fileName: string }>()
  const byName = new Map<string, { shopId: string; fileName: string }>()
  const conflicts: string[] = []

  for (const { fileName, identity } of files) {
    const { shopId, locationName } = identity
    const nameKey = matchKey(locationName)

    const seenId = byShopId.get(shopId)
    if (seenId && matchKey(seenId.name) !== nameKey) {
      conflicts.push(
        `رقم الفرع ${shopId} مُسمّى "${seenId.name}" في "${seenId.fileName}" و "${locationName}" في "${fileName}".`,
      )
    } else if (!seenId) {
      byShopId.set(shopId, { name: locationName, fileName })
    }

    const seenName = byName.get(nameKey)
    if (seenName && seenName.shopId !== shopId) {
      conflicts.push(
        `الموقع "${locationName}" مرتبط برقم الفرع ${seenName.shopId} في "${seenName.fileName}" و ${shopId} في "${fileName}".`,
      )
    } else if (!seenName) {
      byName.set(nameKey, { shopId, fileName })
    }
  }

  if (conflicts.length > 0) throw new LocationConflictError(conflicts)

  return new Map([...byShopId].map(([shopId, entry]) => [shopId, entry.name]))
}

function readRecords(file: ShoorFile, identity: LocationIdentity, problems: RowProblem[]) {
  const records: SalesRecord[] = []

  for (const sheet of file.sheets) {
    const header = findHeaderRow(sheet.rows, SHOOR_COLUMNS)
    if (header === null || header.missing.length > 0) continue

    for (const [index, row] of dataRows(sheet.rows, header).entries()) {
      const rowNumber = header.headerRowIndex + 2 + index
      const date = parseDateCell(cellAt(row, header, 'date'))
      const amount = parseNumber(cellAt(row, header, 'amount'))

      if (date === null) {
        // Total and subtotal bands carry an amount but no date; skip them quietly
        // only when they also carry no other row content worth reporting.
        if (amount !== null) {
          problems.push({ fileName: file.fileName, rowNumber, reason: 'تاريخ غير صالح' })
        }
        continue
      }
      if (amount === null) {
        problems.push({ fileName: file.fileName, rowNumber, reason: 'مبلغ غير صالح' })
        continue
      }

      const employee = cellAt(row, header, 'employee')
      const transactions = parseNumber(cellAt(row, header, 'transactions'))

      records.push({
        date,
        shopId: identity.shopId,
        locationName: identity.locationName,
        employee: typeof employee === 'string' && employee.trim() !== '' ? employee.trim() : null,
        amount,
        // A row standing for several checks counts as those checks, not one.
        transactions: transactions !== null && transactions > 0 ? transactions : 1,
        sourceFile: file.fileName,
      })
    }
  }

  return records
}

/** Day-by-day totals for one location, ascending by date. */
export function summarizeDays(records: readonly SalesRecord[]): DayDetail[] {
  const byDay = new Map<string, DayDetail>()

  for (const record of records) {
    const key = toISODate(record.date)
    const day = byDay.get(key)
    if (day) {
      day.amount += record.amount
      day.transactions += record.transactions
    } else {
      byDay.set(key, { date: key, amount: record.amount, transactions: record.transactions })
    }
  }

  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Combines a batch of shoor exports into per-location day-by-day summaries.
 * Throws before producing anything when the files disagree about which shop is
 * which, so a conflicting upload is never half-applied.
 */
export function ingestShoorFiles(files: readonly ShoorFile[]): ShoorIngest {
  const identified = files.map((file) => ({
    file,
    fileName: file.fileName,
    identity: readLocationIdentity(file),
  }))

  resolveLocations(identified)

  const problems: RowProblem[] = []
  const records = identified.flatMap(({ file, identity }) =>
    readRecords(file, identity, problems),
  )

  const byShop = new Map<string, SalesRecord[]>()
  for (const record of records) {
    const bucket = byShop.get(record.shopId)
    if (bucket) bucket.push(record)
    else byShop.set(record.shopId, [record])
  }

  const locations: LocationSummary[] = [...byShop.entries()]
    .map(([shopId, shopRecords]) => ({
      shopId,
      locationName: shopRecords[0].locationName,
      total: shopRecords.reduce((sum, record) => sum + record.amount, 0),
      transactions: shopRecords.reduce((sum, record) => sum + record.transactions, 0),
      days: summarizeDays(shopRecords),
    }))
    .sort((a, b) => a.shopId.localeCompare(b.shopId))

  return { records, locations, problems }
}
