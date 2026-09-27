import ExcelJS from 'exceljs'
import bundledStockTemplateUrl from '../assets/stock-template.xlsx?url'
import { matchKey } from './text'

/**
 * The showroom's device count, on the stock sheet the region collects: one row
 * per shop, a column per device, and a closing «Comments» column.
 *
 * The columns are read from the template's own header row rather than listed
 * here, so when the region adds or renames a device the new sheet replaces
 * `assets/stock-template.xlsx` and the form follows it.
 */
export interface StockColumn {
  /** 1-based column in the sheet. */
  column: number
  /** The header exactly as the sheet writes it — spacing included. */
  header: string
  /** What the form shows: the header trimmed. */
  label: string
}

export interface StockLayout {
  shopColumn: number
  commentsColumn: number | null
  devices: StockColumn[]
}

export interface StockCount {
  shopId: string | null
  /** Keyed by the device header as the template writes it; null = not counted. */
  counts: Record<string, number | null>
  comments: string
}

export class StockTemplateError extends Error {}

const SHOP = matchKey('SHOP')
const COMMENTS = matchKey('Comments')
const HEADER_ROW = 1
const DATA_ROW = 2

let bundled: Promise<ArrayBuffer> | null = null

/** The blank stock sheet shipped with the app. */
export function getStockTemplateBytes(): Promise<ArrayBuffer> {
  bundled ??= fetch(bundledStockTemplateUrl).then((response) => {
    if (!response.ok) throw new Error(`تعذّر تحميل قالب الجرد (${response.status}).`)
    return response.arrayBuffer()
  })
  return bundled
}

function headerText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object' && 'richText' in value) {
    return value.richText.map((part) => part.text).join('')
  }
  return String(value)
}

async function loadSheet(templateBytes: ArrayBuffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(templateBytes)
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new StockTemplateError('قالب الجرد لا يحتوي على أي ورقة عمل.')
  return { workbook, sheet }
}

function layoutOf(sheet: ExcelJS.Worksheet): StockLayout {
  let shopColumn: number | null = null
  let commentsColumn: number | null = null
  const devices: StockColumn[] = []

  sheet.getRow(HEADER_ROW).eachCell({ includeEmpty: false }, (cell, column) => {
    const header = headerText(cell.value)
    const key = matchKey(header.trim())
    if (key === '') return
    if (key === SHOP) shopColumn = column
    else if (key === COMMENTS) commentsColumn = column
    else devices.push({ column, header, label: header.replace(/\s+/g, ' ').trim() })
  })

  if (shopColumn === null) {
    throw new StockTemplateError('تعذّر العثور على عمود «SHOP» في قالب الجرد.')
  }
  if (devices.length === 0) {
    throw new StockTemplateError('قالب الجرد لا يحتوي على أي جهاز.')
  }
  return { shopColumn, commentsColumn, devices }
}

/** The devices the form asks for, in the sheet's order. */
export async function readStockLayout(templateBytes: ArrayBuffer): Promise<StockLayout> {
  const { sheet } = await loadSheet(templateBytes)
  return layoutOf(sheet)
}

/**
 * Writes the count into the template's second row. A device left empty stays an
 * empty cell, as on the sheets the region already collects — "not counted" is
 * not the same thing as zero, and a typed 0 is written as 0.
 */
export async function fillStockTemplate(
  templateBytes: ArrayBuffer,
  count: StockCount,
): Promise<{ bytes: ArrayBuffer; counted: number }> {
  const { workbook, sheet } = await loadSheet(templateBytes)
  const layout = layoutOf(sheet)
  const row = sheet.getRow(DATA_ROW)

  if (count.shopId) row.getCell(layout.shopColumn).value = count.shopId
  let counted = 0
  for (const device of layout.devices) {
    const value = count.counts[device.header]
    if (value === null || value === undefined || !Number.isFinite(value)) continue
    row.getCell(device.column).value = value
    counted++
  }
  const comments = count.comments.trim()
  if (layout.commentsColumn !== null && comments !== '') {
    row.getCell(layout.commentsColumn).value = comments
  }
  row.commit()

  const bytes = (await workbook.xlsx.writeBuffer()) as ArrayBuffer
  return { bytes, counted }
}

/**
 * A count is a whole number of devices on the shelf: digits only, Arabic-Indic
 * digits accepted. Anything else is not a count — the field is left as typed
 * and reported, not guessed at.
 */
export function parseCount(text: string): number | null | 'invalid' {
  const normalized = text
    .trim()
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
  if (normalized === '') return null
  if (!/^\d{1,5}$/.test(normalized)) return 'invalid'
  return Number(normalized)
}
