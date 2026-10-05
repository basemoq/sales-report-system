import { parseDateCell } from '../dates'
import { labelKey, linesOf, onSameLine, type PdfTextItem } from '../pdf'
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
   * Sections whose heading was found but whose figure never was — the print is
   * too poor to read, or the strip it sits on was cut off. The section settled
   * something and this report does not say how much, which is a hole a person
   * has to close; it is not the same as a section that settled nothing.
   */
  unread: string[]
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
/**
 * `<NO TRANSACTIONS>` as a scan gives it back: the angle brackets are the first
 * thing OCR loses, and the words after them are often clipped too. Nothing else
 * on a receipt opens this way, so the opening is enough to recognise it by.
 */
const isNoTransactions = (key: string): boolean =>
  key.startsWith('<no') || key.includes('notransaction')
const RECONCILIATION = labelKey('Reconciliation')
/**
 * The receipt's own verdict on itself. A scan often loses the `TOTALS` and
 * leaves `MATCHED` standing alone, so the word on its own is taken as the
 * verdict — except where the line says the totals did *not* match, which is the
 * one reading that must never be turned into a pass.
 */
const saysTotalsMatched = (key: string): boolean =>
  key.includes('matched') && !key.includes('notmatched')

/** `mada Host` and `POS TERMINAL` head subsections, not schemes. */
const SUBSECTION_KEYS = new Set(
  ['mada Host', 'POS TERMINAL', 'POS TERMINAL DETAILS'].map(labelKey),
)

/** Column the scheme name is printed in; deeper text is table content. */
const LEFT_MARGIN_TOLERANCE = 6

/**
 * How far up and down the page a line is compared against when deciding whether
 * it stands at the margin.
 *
 * There is no one margin on a photographed receipt. A slip laid on a counter is
 * never quite square to the lens, so its left edge drifts across the page —
 * measured on a real photo, 37 points from top to bottom, against a tolerance
 * of six. An absolute margin either misses the sections at one end of the slip
 * or lets the table rows at the other end through. What holds either way is
 * that nothing is printed to the left of a section head, so a line is judged
 * against its own neighbourhood instead of against the page.
 */
const LOCAL_MARGIN_WINDOW = 120

/**
 * One line further left is a speck of the desk, the cable, or the page
 * underneath — a photograph carries all three. Two are the margin.
 */
const LINES_LEFT_OF_MARGIN = 2

/** Lines with nothing printed to their left: where a section head can stand. */
function atMargin(items: readonly PdfTextItem[]): Set<PdfTextItem> {
  const found = new Set<PdfTextItem>()

  for (const item of items) {
    let toTheLeft = 0
    for (const other of items) {
      if (
        other.page === item.page &&
        Math.abs(other.y - item.y) <= LOCAL_MARGIN_WINDOW &&
        other.x < item.x - LEFT_MARGIN_TOLERANCE
      ) {
        toTheLeft += 1
        if (toTheLeft >= LINES_LEFT_OF_MARGIN) break
      }
    }
    if (toTheLeft < LINES_LEFT_OF_MARGIN) found.add(item)
  }

  return found
}


/**
 * What a browser prints around a page it saves as PDF: the address of the page
 * in one bottom corner, the time it was printed in the other, and «page 1 of 2»
 * beneath. A receipt opened from the bank's link and printed from the browser
 * carries that on every page — and the address, printed far to the left of the
 * receipt, stood next to the section head nearest the foot of the page, so that
 * head no longer looked like it was at the margin and its section went unread
 * (a Visa settlement of 288.00 came back as zero).
 *
 * The address is the anchor: nothing on a receipt itself is a URL. Its line and
 * everything between it and the page edge are dropped — the footer when the
 * address sits below the receipt, the header when it sits above.
 */
const PRINTED_ADDRESS = /^https?:\/\//i

function withoutBrowserMargins(items: readonly PdfTextItem[]): PdfTextItem[] {
  const cuts = new Map<number, { below: number; above: number }>()
  for (const item of items) {
    if (!PRINTED_ADDRESS.test(item.text.trim())) continue
    const rest = items.filter((other) => other.page === item.page && !onSameLine(other, item))
    const higher = rest.filter((other) => other.y > item.y).length
    const lower = rest.length - higher
    const cut = cuts.get(item.page) ?? { below: -Infinity, above: Infinity }
    // Most of the page above the address: it is the footer. Most below: the header.
    if (higher >= lower) cut.below = Math.max(cut.below, item.y)
    else cut.above = Math.min(cut.above, item.y)
    cuts.set(item.page, cut)
  }
  if (cuts.size === 0) return [...items]
  return items.filter((item) => {
    const cut = cuts.get(item.page)
    if (!cut) return true
    const sameLine = (y: number) => Math.abs(item.y - y) <= 2
    if (Number.isFinite(cut.below) && (item.y < cut.below || sameLine(cut.below))) return false
    if (Number.isFinite(cut.above) && (item.y > cut.above || sameLine(cut.above))) return false
    return true
  })
}

/** Reading order for a receipt: down each page, then left to right. */
function inReadingOrder(items: readonly PdfTextItem[]): PdfTextItem[] {
  return [...items].sort(
    (a, b) => a.page - b.page || b.y - a.y || a.x - b.x,
  )
}

function numbersOnBaseline(items: readonly PdfTextItem[], row: PdfTextItem): number[] {
  return items
    .filter((item) => onSameLine(item, row) && item.x > row.x)
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
  const ordered = inReadingOrder(withoutBrowserMargins(items))

  if (!ordered.some((item) => labelKey(item.text) === RECONCILIATION)) {
    throw new MadaFormatError('هذا الملف ليس إيصال موازنة مدى (Reconciliation).')
  }

  // The scheme name sits at the receipt's left margin; table rows start there
  // too, so the margin is read off the text rather than assumed.
  const margin = atMargin(ordered)

  const schemes: SchemeTotals[] = []
  const uncaptured = new Set<SchemeTotals>()
  const disagreements: MadaReconciliation['disagreements'] = []
  let current: SchemeTotals | null = null
  let captured = false
  let debit: number | null = null
  let credit = 0

  for (const item of ordered) {
    const key = labelKey(item.text)
    // `mada HOST` heads the table inside a section. When a scan loses the
    // `HOST`, a bare `mada` is left sitting under the section head — and read
    // as a scheme of its own it takes the section's figures with it, leaving
    // the real section looking unread. A `mada` directly under a head that has
    // produced nothing yet is that subsection, not a new section.
    const isSubsectionMada = key === 'mada' && current !== null && !captured

    if (
      margin.has(item) &&
      SCHEME_KEYS.has(key) &&
      !SUBSECTION_KEYS.has(key) &&
      !isSubsectionMada
    ) {
      current = { scheme: item.text.trim(), count: 0, amount: 0 }
      uncaptured.add(current)
      captured = false
      debit = null
      credit = 0
      schemes.push(current)
      continue
    }

    if (current === null || captured) continue

    if (isNoTransactions(key)) {
      uncaptured.delete(current)
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
      uncaptured.delete(current)
      captured = true

      // Debit less credit is the section total, printed twice. A gap between
      // them is a misread digit, not an accounting difference.
      const fromDebit = debit === null ? null : debit - credit
      if (fromDebit !== null && Math.abs(fromDebit - current.amount) > 0.005) {
        if (Math.abs(Math.round(fromDebit * 100) - current.amount) < 0.5) {
          // The total came back a hundred times the debit: a decimal point the
          // scan dropped, and the receipt's own other printing says where it
          // belongs. Nothing is being chosen between two readings here — one of
          // them is not a money figure at all.
          current.amount = fromDebit
        } else {
          disagreements.push({
            scheme: current.scheme,
            totals: current.amount,
            debit: fromDebit,
          })
        }
      }
    }
  }

  const unread = [...uncaptured].map((scheme) => scheme.scheme)

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
    unread,
    disagreements,
    // Read off the whole line: a scan hands back `TOTALS` and `MATCHED` as two
    // words often enough that looking for them joined was a warning on every
    // photographed receipt.
    totalsMatched: linesOf(ordered).some((line) => saysTotalsMatched(labelKey(line))),
    // Only the first slot settled: it could be either card, and nothing on the
    // receipt says which.
    visaMayBeMastercard:
      visaSections.length > 1 && firstVisa.amount > 0 && laterVisaTotal === 0,
  }
}

/**
 * Several settlement slips read as one.
 *
 * A terminal is balanced at the end of every day, so a report covering more
 * than one day comes with more than one slip — and a showroom with two
 * terminals brings two for the same day. What the day owes on cards is all of
 * them added up; taking one and dropping the rest is money missing from the
 * deposit.
 *
 * Everything that needs a person's eye is kept from every slip: an unread
 * section, a figure printed two ways, a scheme with no column. The date is the
 * latest of them, since that is the day the batch closes on.
 */
export function mergeReconciliations(
  receipts: readonly MadaReconciliation[],
): MadaReconciliation | undefined {
  if (receipts.length === 0) return undefined
  if (receipts.length === 1) return receipts[0]

  const latest = receipts
    .map((receipt) => receipt.terminalDate)
    .filter((date): date is Date => date !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0]

  return {
    terminalDate: latest ?? null,
    schemes: receipts.flatMap((receipt) => receipt.schemes),
    cards: {
      mada: round2(receipts.reduce((sum, receipt) => sum + receipt.cards.mada, 0)),
      visa: round2(receipts.reduce((sum, receipt) => sum + receipt.cards.visa, 0)),
      mastercard: round2(receipts.reduce((sum, receipt) => sum + receipt.cards.mastercard, 0)),
    },
    unmapped: receipts.flatMap((receipt) => receipt.unmapped),
    unread: receipts.flatMap((receipt) => receipt.unread),
    disagreements: receipts.flatMap((receipt) => receipt.disagreements),
    // One slip that did not balance is enough to say the day did not.
    totalsMatched: receipts.every((receipt) => receipt.totalsMatched),
    visaMayBeMastercard: receipts.some((receipt) => receipt.visaMayBeMastercard),
  }
}

/** Money is carried to halalas; summing raw floats leaves artefacts. */
const round2 = (value: number): number => Math.round(value * 100) / 100

const DATE_TEXT = /^\d{2}\/\d{2}\/\d{4}$/

function findTerminalDate(items: readonly PdfTextItem[]): string | null {
  return items.find((item) => DATE_TEXT.test(item.text.trim()))?.text.trim() ?? null
}
