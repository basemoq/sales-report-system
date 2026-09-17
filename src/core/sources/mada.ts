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
  /**
   * Sections where the receipt's own two printings of the same figure do not
   * agree. On an exported receipt this never happens; on a scanned one it means
   * OCR misread a digit, and the figure needs a person's eyes before it is
   * reported as money.
   */
  disagreements: { scheme: string; totals: number; debit: number }[]
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

/**
 * Card schemes a mada terminal settles, as printed at the section head.
 *
 * `SPAN` is here because that is what the domestic section is headed on the
 * receipts that name the network rather than the brand — الشبكة السعودية, with
 * `mada HOST` as its subsection and `THANK YOU FOR USING mada` at the foot.
 */
const SCHEME_LABELS = [
  'mada',
  'SPAN',
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
/**
 * The debit line above the section's own total. With nothing credited back it
 * is the same figure, printed a second time — which is what makes a misread
 * digit on a scanned receipt catchable.
 */
const TOTAL_DEBIT = labelKey('TOTAL DB')
const TOTAL_CREDIT = labelKey('TOTAL CR')
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
  const disagreements: MadaReconciliation['disagreements'] = []
  let current: SchemeTotals | null = null
  let captured = false
  let debit: number | null = null
  let credit = 0

  for (const item of ordered) {
    const key = labelKey(item.text)
    const atMargin = item.x <= leftMargin + LEFT_MARGIN_TOLERANCE

    if (atMargin && SCHEME_KEYS.has(key) && !SUBSECTION_KEYS.has(key)) {
      current = { scheme: item.text.trim(), count: 0, amount: 0 }
      captured = false
      debit = null
      credit = 0
      schemes.push(current)
      continue
    }

    if (current === null || captured) continue

    if (key === NO_TRANSACTIONS) {
      captured = true
      continue
    }

    if (key === TOTAL_DEBIT) {
      const [, amount] = numbersOnBaseline(ordered, item)
      debit = amount ?? null
      continue
    }

    if (key === TOTAL_CREDIT) {
      const [, amount] = numbersOnBaseline(ordered, item)
      credit = amount ?? 0
      continue
    }

    if (key === TOTALS) {
      const [count, amount] = numbersOnBaseline(ordered, item)
      current.count = count ?? 0
      // A row printing only one figure is the amount, not a count.
      current.amount = amount ?? count ?? 0
      captured = true

      // Debit less credit is the section total, printed twice. A gap between
      // them is a misread digit, not an accounting difference.
      if (debit !== null && Math.abs(debit - credit - current.amount) > 0.005) {
        disagreements.push({
          scheme: current.scheme,
          totals: current.amount,
          debit: debit - credit,
        })
      }
    }
  }

  const cards: CardTotals = { mada: 0, visa: 0, mastercard: 0 }
  const unmapped: SchemeTotals[] = []

  for (const scheme of schemes) {
    const key = labelKey(scheme.scheme)
    if (key === 'mada' || key === 'span') cards.mada += scheme.amount
    else if (key === 'mc' || key === 'mastercard') cards.mastercard += scheme.amount
    else if (key !== 'visa' && scheme.amount !== 0) unmapped.push(scheme)
  }

  // The receipt prints two sections headed for Visa. The first is the terminal's
  // MasterCard slot, which it mislabels; the last is the real Visa.
  const visaSections = schemes.filter((scheme) => labelKey(scheme.scheme) === 'visa')
  const [firstVisa, ...laterVisa] = visaSections
  const laterVisaTotal = laterVisa.reduce((sum, section) => sum + section.amount, 0)

  const bothSettled = visaSections.length > 1 && firstVisa.amount > 0 && laterVisaTotal > 0

  if (bothSettled) {
    cards.mastercard += firstVisa.amount
    cards.visa += laterVisaTotal
  } else {
    cards.visa += visaSections.reduce((sum, section) => sum + section.amount, 0)
  }

  return {
    terminalDate: parseDateCell(findTerminalDate(ordered)),
    schemes,
    cards,
    unmapped,
    disagreements,
    totalsMatched: ordered.some((item) => labelKey(item.text) === TOTALS_MATCHED),
    // Only the first slot settled: it could be either card, and nothing on the
    // receipt says which.
    visaMayBeMastercard:
      visaSections.length > 1 && firstVisa.amount > 0 && laterVisaTotal === 0,
  }
}

const DATE_TEXT = /^\d{2}\/\d{2}\/\d{4}$/

function findTerminalDate(items: readonly PdfTextItem[]): string | null {
  return items.find((item) => DATE_TEXT.test(item.text.trim()))?.text.trim() ?? null
}
