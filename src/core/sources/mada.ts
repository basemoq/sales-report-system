import { parseDateCell } from '../dates'
import { labelKey, type PdfTextItem } from '../pdf'
import { parseNumber } from '../text'

export class MadaFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MadaFormatError'
  }
}

export interface SchemeTotals {
  /** The scheme label exactly as the receipt printed it. */
  scheme: string
  count: number
  amount: number
}

/** The three card columns the daily template carries. */
export interface CardTotals {
  mada: number
  visa: number
  mastercard: number
}

export interface MadaReconciliation {
  terminalDate: Date | null
  schemes: SchemeTotals[]
  cards: CardTotals
  /** Schemes with money on them that no template column covers. */
  unmapped: SchemeTotals[]
  /** True when the receipt itself reported the totals as matched. */
  totalsMatched: boolean
  /**
   * The terminal sometimes prints a MasterCard settlement under the first
   * `visa` heading, which shows up as money on that section while the real
   * `VISA` section at the end of the receipt reports no transactions. The two
   * cases are identical on paper, so this only flags the shape — the operator
   * decides which column the amount belongs in.
   */
  visaMayBeMastercard: boolean
}

/** Card schemes a mada terminal settles, as printed at the section head. */
const SCHEME_LABELS = [
  'mada',
  'visa',
  'mc',
  'mastercard',
  'master card',
  'jb',
  'jcb',
  'amex',
  'gccnet',
]
const SCHEME_KEYS = new Set(SCHEME_LABELS.map(labelKey))

const TOTALS = labelKey('TOTALS')
const NO_TRANSACTIONS = labelKey('<NO TRANSACTIONS>')
const RECONCILIATION = labelKey('Reconciliation')
const TOTALS_MATCHED = labelKey('TotalsMatched')

/** `mada Host` and `POS TERMINAL` head subsections, not schemes. */
const SUBSECTION_KEYS = new Set(
  ['mada Host', 'POS TERMINAL', 'POS TERMINAL DETAILS'].map(labelKey),
)

/** Column the scheme name is printed in; deeper text is table content. */
const LEFT_MARGIN_TOLERANCE = 6

const BASELINE_TOLERANCE = 4

/** Reading order for a receipt: down each page, then left to right. */
function inReadingOrder(items: readonly PdfTextItem[]): PdfTextItem[] {
  return [...items].sort(
    (a, b) => a.page - b.page || b.y - a.y || a.x - b.x,
  )
}

function numbersOnBaseline(items: readonly PdfTextItem[], row: PdfTextItem): number[] {
  return items
    .filter(
      (item) =>
        item.page === row.page &&
        Math.abs(item.y - row.y) <= BASELINE_TOLERANCE &&
        item.x > row.x,
    )
    .sort((a, b) => a.x - b.x)
    .map((item) => parseNumber(item.text))
    .filter((value): value is number => value !== null)
}

/**
 * Reads a mada terminal's end-of-day reconciliation receipt into per-scheme
 * totals. Each scheme prints the same figure twice — once for the host and once
 * for the terminal — so only the first `TOTALS` after a scheme head is taken; a
 * scheme marked `<NO TRANSACTIONS>` settled nothing.
 */
export function parseMadaReconciliation(
  items: readonly PdfTextItem[],
): MadaReconciliation {
  const ordered = inReadingOrder(items)

  if (!ordered.some((item) => labelKey(item.text) === RECONCILIATION)) {
    throw new MadaFormatError('هذا الملف ليس إيصال موازنة مدى (Reconciliation).')
  }

  // The scheme name sits at the receipt's left margin; table rows start there too,
  // so the margin is taken from the text itself rather than assumed.
  const leftMargin = Math.min(...ordered.map((item) => item.x))

  const schemes: SchemeTotals[] = []
  let current: SchemeTotals | null = null
  let captured = false

  for (const item of ordered) {
    const key = labelKey(item.text)
    const atMargin = item.x <= leftMargin + LEFT_MARGIN_TOLERANCE

    if (atMargin && SCHEME_KEYS.has(key) && !SUBSECTION_KEYS.has(key)) {
      current = { scheme: item.text.trim(), count: 0, amount: 0 }
      captured = false
      schemes.push(current)
      continue
    }

    if (current === null || captured) continue

    if (key === NO_TRANSACTIONS) {
      captured = true
      continue
    }

    if (key === TOTALS) {
      const [count, amount] = numbersOnBaseline(ordered, item)
      current.count = count ?? 0
      // A row printing only one figure is the amount, not a count.
      current.amount = amount ?? count ?? 0
      captured = true
    }
  }

  const cards: CardTotals = { mada: 0, visa: 0, mastercard: 0 }
  const unmapped: SchemeTotals[] = []

  for (const scheme of schemes) {
    const key = labelKey(scheme.scheme)
    if (key === 'mada') cards.mada += scheme.amount
    else if (key === 'visa') cards.visa += scheme.amount
    else if (key === 'mc' || key === 'mastercard') cards.mastercard += scheme.amount
    else if (scheme.amount !== 0) unmapped.push(scheme)
  }

  const visaSections = schemes.filter((scheme) => labelKey(scheme.scheme) === 'visa')

  return {
    terminalDate: parseDateCell(findTerminalDate(ordered)),
    schemes,
    cards,
    unmapped,
    totalsMatched: ordered.some((item) => labelKey(item.text) === TOTALS_MATCHED),
    visaMayBeMastercard:
      visaSections.length > 1 &&
      visaSections[0].amount > 0 &&
      visaSections.slice(1).every((section) => section.amount === 0),
  }
}

const DATE_TEXT = /^\d{2}\/\d{2}\/\d{4}$/

function findTerminalDate(items: readonly PdfTextItem[]): string | null {
  return items.find((item) => DATE_TEXT.test(item.text.trim()))?.text.trim() ?? null
}
