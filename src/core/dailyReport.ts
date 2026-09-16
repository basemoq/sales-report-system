import ExcelJS from 'exceljs'
import type { CacoDetailed, CacoSummary, CacoTransaction } from './sources/caco'
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
  /** Stands in for the summary when only the detailed export was uploaded. */
  detailed?: CacoDetailed
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
 * Order types the detailed export names outright in its description column.
 * A sales order is described by what was sold instead, so every other
 * description is one — which is what makes the split derivable at all.
 */
const NAMED_ORDER_TYPES = new Map<string, keyof BssTotals | null>([
  [matchKey('Invoice Payment'), 'billPayment'],
  [matchKey('Top Up'), 'cashSales'],
  // Summary rows of their own, and no row in the template.
  [matchKey('Refund'), null],
  [matchKey('EVD Voucher'), null],
])

const REFUND = matchKey('Refund')

/** Which template row a transaction belongs to; null for a row with none. */
function bucketOf(transaction: CacoTransaction): keyof BssTotals | null {
  const described = matchKey((transaction.orderType ?? '').trim())
  if (!NAMED_ORDER_TYPES.has(described)) return 'ordering'
  return NAMED_ORDER_TYPES.get(described) ?? null
}

const isRefund = (transaction: CacoTransaction): boolean =>
  matchKey((transaction.orderType ?? '').trim()) === REFUND

/** Same line, same money: how a refund is tied to the sale it reverses. */
function reverses(refund: CacoTransaction, sale: CacoTransaction): boolean {
  const sameLine =
    (refund.msisdn !== null && refund.msisdn === sale.msisdn) ||
    (refund.account !== null && refund.account === sale.account)
  return sameLine && Math.abs(Math.abs(refund.amount) - sale.amount) < 0.005
}

export interface RefundMatch {
  refund: CacoTransaction
  /** The transaction it reverses, or null when none was found in the day. */
  reversed: CacoTransaction | null
}

/**
 * Pairs each `Refund` row with the sale it reverses.
 *
 * A cancelled sale is left in the export — the original row stays, marked
 * `Superseded`, and a `Refund` row carries the money back out — so counting the
 * original alone overstates the day by its amount. The two are tied by the line
 * they were sold against (MSISDN, or the account when the export omits it) and
 * an equal amount, which is what tells a genuine reversal from an unrelated
 * refund that happens to share a figure. Each sale can only be reversed once.
 */
export function matchRefunds(detailed: CacoDetailed): RefundMatch[] {
  const sales = detailed.transactions.filter((transaction) => !isRefund(transaction))
  const taken = new Set<CacoTransaction>()

  return detailed.transactions.filter(isRefund).map((refund) => ({
    refund,
    reversed: sales.find((sale) => !taken.has(sale) && reverses(refund, sale)) ?? null,
  })).map((match) => {
    if (match.reversed) taken.add(match.reversed)
    return match
  })
}

/**
 * Takes each matched refund off the row its original sale was counted in. A
 * refund whose original is not in the day is left alone and reported instead:
 * which row it belongs to cannot be known, and guessing moves real money.
 */
function applyRefunds(totals: BssTotals, detailed: CacoDetailed): BssTotals {
  for (const { refund, reversed } of matchRefunds(detailed)) {
    if (reversed === null) continue
    const bucket = bucketOf(reversed)
    // A refund is a deduction whichever sign the export gives it.
    if (bucket !== null) totals[bucket] -= Math.abs(refund.amount)
  }
  return totals
}

/**
 * The same split the summary reports, recovered from the per-transaction export
 * so a day can be reported from it alone. Verified against a real pair: all
 * three figures match the summary to the halala.
 */
function bssFromDetailed(detailed: CacoDetailed): BssTotals {
  const totals: BssTotals = { billPayment: 0, ordering: 0, cashSales: 0 }

  for (const transaction of detailed.transactions) {
    const bucket = bucketOf(transaction)
    if (bucket === null || isRefund(transaction)) continue
    totals[bucket] += transaction.amount
  }

  return applyRefunds(totals, detailed)
}

/** The refund total the summary reports as its own order-type row. */
function summaryRefundTotal(caco: CacoSummary): number {
  return caco.rows
    .filter((row) => matchKey(row.orderType) === REFUND)
    .reduce((sum, row) => sum + Math.abs(row.total), 0)
}

/**
 * The summary's own Refund row, taken off `Total Ordering` when the detailed
 * export is not there to say what each refund reversed.
 *
 * The summary's rows are gross — a cancelled sale sits in its order-type row
 * and the money back out in the Refund row — so leaving the refund out
 * overstates the day. Ordering is where it goes because that is what these
 * refunds reverse: a cancelled sales order. It is stated in the notes, and
 * uploading the detailed export replaces the assumption with the real row.
 */
function applySummaryRefunds(totals: BssTotals, caco: CacoSummary): BssTotals {
  totals.ordering -= summaryRefundTotal(caco)
  return totals
}

/**
 * The day's refunds: how much came off the figures, and any refund that could
 * not be placed. The deducted total belongs beside the figures — it explains a
 * number the operator is reading — while an unplaced refund is a warning,
 * because it is still in the figures and needs a person.
 */
export interface RefundSummary {
  /** Total taken off the figures, 0 when the day had no refund. */
  deducted: number
  /** Refunds left in the figures because their original was not found. */
  unplaced: string[]
}

export function refundSummary(sources: DailySources): RefundSummary {
  const summary: RefundSummary = { deducted: 0, unplaced: [] }

  for (const { refund, reversed } of sources.detailed ? matchRefunds(sources.detailed) : []) {
    const amount = Math.abs(refund.amount)
    const line = refund.msisdn ?? refund.account ?? refund.receiptNo ?? '—'
    if (reversed === null) {
      summary.unplaced.push(
        `مرتجع بمبلغ ${amount.toFixed(2)} على ${line} لم يُعثر على عمليته الأصلية في نفس اليوم، فلم يُخصم — راجعه يدويًا.`,
      )
      continue
    }
    summary.deducted += amount
  }

  // The summary reports refunds without saying what each reversed, so it counts
  // only when the detailed export is not there to place them.
  if (sources.caco && sources.detailed === undefined) {
    summary.deducted += summaryRefundTotal(sources.caco)
  }

  summary.deducted = round2(summary.deducted)
  return summary
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
  const cards = roundAll(sources.mada?.cards ?? ZERO_CARDS)
  // The summary's rows are gross: a cancelled sale sits in its order-type row
  // and the money back out sits in a Refund row of its own. So the refunds are
  // netted off here too, from the detailed export that says what each reversed.
  const bss = roundAll(
    sources.caco
      ? sources.detailed
        ? applyRefunds(bssFromCaco(sources.caco), sources.detailed)
        : applySummaryRefunds(bssFromCaco(sources.caco), sources.caco)
      : sources.detailed
        ? bssFromDetailed(sources.detailed)
        : ZERO_BSS,
  )

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
    date:
      sources.caco?.parameters.from ??
      sources.detailed?.parameters.from ??
      sources.mada?.terminalDate ??
      null,
    tabs,
    bss,
    cards,
    totalSales,
    cashDeposit: round2(totalSales - cards.mada - cards.visa - cards.mastercard),
  }
}

/**
 * Moves the Visa figure into the MasterCard column, for the receipts where the
 * terminal printed a MasterCard settlement under a `visa` heading. The two look
 * identical on paper, so this is applied only when the operator says so.
 */
export function reassignVisaToMastercard(figures: DailyFigures): DailyFigures {
  return {
    ...figures,
    cards: {
      mada: figures.cards.mada,
      visa: 0,
      mastercard: round2(figures.cards.mastercard + figures.cards.visa),
    },
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
const SHOWROOM_LABEL = ['إسم المعرض', 'اسم المعرض']
const SUPERVISOR_LABEL = ['مشرف المعرض']

/** Who the report is for, chosen before the day's files are uploaded. */
export interface ReportIdentity {
  showroom: string
  supervisor: string
}

/** The header the template carries above its figures. */
export interface TemplateHeader extends Partial<ReportIdentity> {
  /** Written into `كود المعرض`; read from the sources rather than chosen. */
  shopId?: string | null
}

/** The two figures the template works out for itself, by their own headers. */
const DERIVED_HEADERS: { labels: string[]; value: (f: DailyFigures) => number }[] = [
  { labels: ['إجمالى المبيعات', 'إجمالي المبيعات', 'اجمالى المبيعات'], value: (f) => f.totalSales },
  { labels: ['ايداع نقدي', 'إيداع نقدي', 'الإيداع النقدي'], value: (f) => f.cashDeposit },
]

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

/**
 * Makes Excel work the formulas out again instead of trusting what the template
 * remembers.
 *
 * A spreadsheet stores each formula with the last value it produced. Filling in
 * new figures does not touch those stored values, and Excel on a desktop opens
 * a downloaded file in Protected View — which shows a file without calculating
 * it. The totals then read as whatever the template was last saved with: the
 * report showed 12,228.84 against rows adding to 1,480.00, while the same file
 * on a phone, which does calculate on open, was right.
 *
 * So the stored values are dropped and the workbook is marked for a full
 * recalculation on load. The formulas themselves are untouched.
 */
function forceRecalculation(workbook: ExcelJS.Workbook): void {
  workbook.calcProperties.fullCalcOnLoad = true

  for (const sheet of workbook.worksheets) {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const value = cell.value
        if (typeof value !== 'object' || value === null) return

        // A formula written out once and shared down a column is stored as a
        // reference to the cell that carries it; both keep a cached result.
        if ('formula' in value && typeof value.formula === 'string') {
          cell.value = {
            formula: value.formula,
            date1904: workbook.properties.date1904,
          } as ExcelJS.CellFormulaValue
        } else if ('sharedFormula' in value && typeof value.sharedFormula === 'string') {
          cell.value = {
            sharedFormula: value.sharedFormula,
            date1904: workbook.properties.date1904,
          } as ExcelJS.CellSharedFormulaValue
        }
      })
    })
  }
}

/**
 * Stores a figure as what a formula cell shows until Excel recalculates it. The
 * formula is untouched: this is the cached result beside it, which is what a
 * viewer displays before it calculates anything.
 */
function rememberResult(cell: ExcelJS.Cell, result: number): void {
  const value = cell.value
  if (typeof value !== 'object' || value === null) return

  if ('formula' in value && typeof value.formula === 'string') {
    cell.value = { formula: value.formula, result } as ExcelJS.CellFormulaValue
  } else if ('sharedFormula' in value && typeof value.sharedFormula === 'string') {
    cell.value = { sharedFormula: value.sharedFormula, result } as ExcelJS.CellSharedFormulaValue
  }
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
  header: TemplateHeader = {},
): Promise<FillResult> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(templateBytes)

  const sheet = workbook.worksheets[0]
  if (!sheet) throw new TemplateFillError('القالب لا يحتوي على أي ورقة عمل.')

  forceRecalculation(workbook)

  const written: string[] = []
  const skippedFormulas: string[] = []
  const warnings: string[] = []

  const write = (row: number, column: number, value: number | string | Date) => {
    const cell = sheet.getCell(row, column)
    if (holdsFormula(cell)) {
      skippedFormulas.push(cell.address)
      return
    }
    cell.value = value
    written.push(
      `${cell.address} = ${value instanceof Date ? value.toISOString().slice(0, 10) : value}`,
    )
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

  // The template computes these two itself, so its formulas are left alone —
  // but the figure this app worked out is stored alongside each as the value to
  // show until Excel recalculates. Protected View shows a file without
  // calculating it, and a blank total reads as badly as a stale one.
  for (const { labels, value } of DERIVED_HEADERS) {
    const header = findColumn(sheet, labels)
    if (header === null) continue
    rememberResult(sheet.getCell(header.row + 1, header.column), value(figures))
  }

  if (figures.date !== null) {
    const dateLabel = findColumn(sheet, DATE_LABEL)
    if (dateLabel === null) warnings.push('لم يُعثر في القالب على خانة «التاريخ».')
    else write(dateLabel.row, dateLabel.column + 1, figures.date)
  }

  // Left as the template has them when there is nothing to write.
  const headerTargets: [string | null | undefined, string[], string][] = [
    [header.showroom, SHOWROOM_LABEL, 'إسم المعرض'],
    [header.supervisor, SUPERVISOR_LABEL, 'مشرف المعرض'],
    [header.shopId, SHOP_CODE_LABEL, 'كود المعرض'],
  ]
  for (const [value, labels, name] of headerTargets) {
    if (value === undefined || value === null || value.trim() === '') continue
    const label = findColumn(sheet, labels)
    if (label === null) warnings.push(`لم يُعثر في القالب على خانة «${name}».`)
    else write(label.row, label.column + 1, value.trim())
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

