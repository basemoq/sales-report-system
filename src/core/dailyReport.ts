import ExcelJS from 'exceljs'
import type { CacoSummary } from './sources/caco'
import type { CardTotals, MadaReconciliation } from './sources/mada'
import type { TabsReport, TabsTotals } from './sources/tabs'
import { matchKey } from './text'

export interface BssTotals {
  billPayment: number
  ordering: number
  cashSales: number
}

export interface DailyFigures {
  date: Date | null
  tabs: TabsTotals
  bss: BssTotals
  cards: CardTotals
  /** The six system figures added up, mirroring the template's own SUM. */
  totalSales: number
  /** What the template derives: everything not settled on a card. */
  cashDeposit: number
}

export interface DailySources {
  caco?: CacoSummary
  tabs?: TabsReport
  mada?: MadaReconciliation
}

const ZERO_TABS: TabsTotals = { billPayment: 0, ordering: 0, cashCollection: 0 }
const ZERO_BSS: BssTotals = { billPayment: 0, ordering: 0, cashSales: 0 }
const ZERO_CARDS: CardTotals = { mada: 0, visa: 0, mastercard: 0 }

/** CACO order types, as the export names them, against the template's BSS rows. */
const BSS_FROM_CACO: Record<keyof BssTotals, string> = {
  billPayment: 'Invoice Payment',
  ordering: 'Sales Order Payment',
  cashSales: 'Top Up',
}

function bssFromCaco(caco: CacoSummary): BssTotals {
  const byType = new Map(caco.rows.map((row) => [matchKey(row.orderType), row.total]))
  return {
    billPayment: byType.get(matchKey(BSS_FROM_CACO.billPayment)) ?? 0,
    ordering: byType.get(matchKey(BSS_FROM_CACO.ordering)) ?? 0,
    cashSales: byType.get(matchKey(BSS_FROM_CACO.cashSales)) ?? 0,
  }
}

/**
 * Money is carried to halalas. Summing raw floats leaves artefacts like
 * 1411.1599999999999, which would be written into the sheet as-is.
 */
const round2 = (value: number): number => Math.round(value * 100) / 100

const roundAll = <T extends object>(totals: T): T =>
  Object.fromEntries(
    Object.entries(totals).map(([key, value]) => [key, round2(value as number)]),
  ) as T

/** Combines the day's three sources into the figures the template carries. */
export function buildDailyFigures(sources: DailySources): DailyFigures {
  const tabs = roundAll(sources.tabs?.totals ?? ZERO_TABS)
  const bss = roundAll(sources.caco ? bssFromCaco(sources.caco) : ZERO_BSS)
  const cards = roundAll(sources.mada?.cards ?? ZERO_CARDS)

  // Totalled from the rounded parts, so this matches the template's own SUM.
  const totalSales = round2(
    tabs.billPayment +
      tabs.ordering +
      tabs.cashCollection +
      bss.billPayment +
      bss.ordering +
      bss.cashSales,
  )

  return {
    date: sources.caco?.parameters.from ?? sources.mada?.terminalDate ?? null,
    tabs,
    bss,
    cards,
    totalSales,
    cashDeposit: round2(totalSales - cards.mada - cards.visa - cards.mastercard),
  }
}

export class TemplateFillError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TemplateFillError'
  }
}

export interface FillResult {
  bytes: ArrayBuffer
  /** Cells written, as `B12 = 7049.08`, for showing what the fill changed. */
  written: string[]
  /**
   * Targets left alone because the template computes them itself. Overwriting
   * one would replace a formula with a stale constant.
   */
  skippedFormulas: string[]
  warnings: string[]
}

const SYSTEM_COLUMN = ['النظام']
const CATEGORY_COLUMN = ['التصنيف']
const AMOUNT_COLUMN = ['اجمالى المبلغ', 'إجمالي المبلغ', 'المبلغ']
const DATE_LABEL = ['التاريخ']
const SHOP_CODE_LABEL = ['كود المعرض']

const CARD_HEADERS: Record<keyof CardTotals, string[]> = {
  mada: ['شبكة - مدي', 'شبكة مدى', 'مدى', 'شبكة - مدى'],
  visa: ['فيزا'],
  mastercard: ['ماستر كارد', 'ماستركارد'],
}

/** Template row labels, against the figures that fill them. */
const AMOUNT_ROWS: { system: string; category: string[]; value: (f: DailyFigures) => number }[] = [
  { system: 'TABS', category: ['Total Bill Payment'], value: (f) => f.tabs.billPayment },
  { system: 'TABS', category: ['Total Ordering'], value: (f) => f.tabs.ordering },
  { system: 'TABS', category: ['Total Cash Collection'], value: (f) => f.tabs.cashCollection },
  { system: 'BSS', category: ['Total Bill Payment'], value: (f) => f.bss.billPayment },
  { system: 'BSS', category: ['Total Ordering'], value: (f) => f.bss.ordering },
  { system: 'BSS', category: ['Total Cash Sales'], value: (f) => f.bss.cashSales },
]

const keysOf = (labels: readonly string[]) => new Set(labels.map(matchKey))

const cellText = (cell: ExcelJS.Cell): string | null => {
  const value = cell.value
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'object' && 'richText' in value) {
    return value.richText.map((part) => part.text).join('').trim()
  }
  return null
}

const holdsFormula = (cell: ExcelJS.Cell): boolean =>
  typeof cell.value === 'object' && cell.value !== null && 'formula' in cell.value

/** Column whose header row cell matches one of `labels`. */
function findColumn(
  sheet: ExcelJS.Worksheet,
  labels: readonly string[],
): { row: number; column: number } | null {
  const wanted = keysOf(labels)
  let found: { row: number; column: number } | null = null

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (found) return
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      if (found) return
      const text = cellText(cell)
      if (text !== null && wanted.has(matchKey(text))) {
        found = { row: rowNumber, column: columnNumber }
      }
    })
  })

  return found
}

/**
 * Writes the day's figures into the shop's own template, leaving its formulas
 * to do their work. Cells are located by their labels rather than by address,
 * so a template whose rows shift still fills correctly.
 */
export async function fillDailyTemplate(
  templateBytes: ArrayBuffer,
  figures: DailyFigures,
): Promise<FillResult> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(templateBytes)

  const sheet = workbook.worksheets[0]
  if (!sheet) throw new TemplateFillError('القالب لا يحتوي على أي ورقة عمل.')

  const written: string[] = []
  const skippedFormulas: string[] = []
  const warnings: string[] = []

  const write = (row: number, column: number, value: number | Date) => {
    const cell = sheet.getCell(row, column)
    if (holdsFormula(cell)) {
      skippedFormulas.push(cell.address)
      return
    }
    cell.value = value
    written.push(`${cell.address} = ${value instanceof Date ? value.toISOString().slice(0, 10) : value}`)
  }

  const systemColumn = findColumn(sheet, SYSTEM_COLUMN)
  const categoryColumn = findColumn(sheet, CATEGORY_COLUMN)
  const amountColumn = findColumn(sheet, AMOUNT_COLUMN)

  if (systemColumn === null || categoryColumn === null || amountColumn === null) {
    throw new TemplateFillError(
      'تعذّر العثور على أعمدة «النظام» و«التصنيف» و«اجمالى المبلغ» في القالب.',
    )
  }

  for (const target of AMOUNT_ROWS) {
    const wantedSystem = matchKey(target.system)
    const wantedCategory = keysOf(target.category)
    let filled = false

    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (filled || rowNumber <= systemColumn.row) return
      const system = cellText(row.getCell(systemColumn.column))
      const category = cellText(row.getCell(categoryColumn.column))
      if (system === null || category === null) return
      if (matchKey(system) !== wantedSystem || !wantedCategory.has(matchKey(category))) return

      write(rowNumber, amountColumn.column, target.value(figures))
      filled = true
    })

    if (!filled) {
      warnings.push(`لم يُعثر في القالب على صف «${target.system} — ${target.category[0]}».`)
    }
  }

  for (const [key, labels] of Object.entries(CARD_HEADERS) as [keyof CardTotals, string[]][]) {
    const header = findColumn(sheet, labels)
    if (header === null) {
      warnings.push(`لم يُعثر في القالب على عمود «${labels[0]}».`)
      continue
    }
    // The card figures sit on the row directly under their header band.
    write(header.row + 1, header.column, figures.cards[key])
  }

  if (figures.date !== null) {
    const dateLabel = findColumn(sheet, DATE_LABEL)
    if (dateLabel === null) warnings.push('لم يُعثر في القالب على خانة «التاريخ».')
    else write(dateLabel.row, dateLabel.column + 1, figures.date)
  }

  if (skippedFormulas.length > 0) {
    warnings.push(
      `تُركت الخلايا التالية كما هي لأنها معادلات يحسبها القالب: ${skippedFormulas.join('، ')}.`,
    )
  }

  return {
    bytes: (await workbook.xlsx.writeBuffer()) as ArrayBuffer,
    written,
    skippedFormulas,
    warnings,
  }
}

/**
 * Checks the template is for the shop the sources came from. The template
 * writes the code without its leading letter, so one containing the other
 * counts as a match.
 */
export async function checkTemplateShop(
  templateBytes: ArrayBuffer,
  sourceShopId: string,
): Promise<{ ok: boolean; templateShop: string | null }> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(templateBytes)
  const sheet = workbook.worksheets[0]
  if (!sheet) return { ok: false, templateShop: null }

  const label = findColumn(sheet, SHOP_CODE_LABEL)
  if (label === null) return { ok: true, templateShop: null }

  const templateShop = cellText(sheet.getCell(label.row, label.column + 1))
  if (templateShop === null) return { ok: true, templateShop: null }

  const a = matchKey(templateShop)
  const b = matchKey(sourceShopId)
  return { ok: a.includes(b) || b.includes(a), templateShop }
}
