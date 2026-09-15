/**
 * Reads a mada reconciliation receipt out of the HTML SurePay serves for a
 * terminal's QR link.
 *
 * The page is a printed receipt turned into a web page: the same labels the
 * paper receipt carries, each with a count and an amount beside it, in Arabic
 * and English. Nothing here depends on the order of the rows or on line
 * numbers — every figure is found by its own label, so a page that grows a row
 * or reorders its sections still reads correctly.
 */

export interface ReceiptRow {
  /** Transactions counted under the label. */
  count: number | null
  /** Riyals. */
  amount: number | null
}

export interface MadaReceipt {
  merchant: string | null
  reference: string | null
  /** `YYYY-MM-DD`, as printed — the receipt carries no time zone. */
  date: string | null
  /** `HH:MM:SS`, as printed. */
  time: string | null
  /** Null when the receipt says neither matched nor unmatched. */
  totalsMatched: boolean | null
  rows: Record<string, ReceiptRow>
  /** Labels that were looked for and not found, so the caller can tell. */
  missing: string[]
}

/** The labels the receipt prints, against the names this returns them under. */
const ROW_LABELS: { key: string; label: string }[] = [
  { key: 'totalDb', label: 'TOTAL DB' },
  { key: 'totalCr', label: 'TOTAL CR' },
  { key: 'naqd', label: 'NAQD' },
  { key: 'cadv', label: 'C/ADV' },
  { key: 'auth', label: 'AUTH' },
]

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  nbsp: ' ',
}

/**
 * The page as plain lines. Every element that lays out a row — a table row, a
 * cell, a div, a break — ends a line, so a label and its figures stay together
 * on one line however the page nests them.
 */
export function textLines(html: string): string[] {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(tr|div|p|h[1-6]|li|table)\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(td|th|span)\s*>/gi, ' \t ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#?\w+);/g, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole)
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter((line) => line !== '')
}

const AMOUNT = /\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2}/g
const COUNT = /(?<![\d.,])\d{1,6}(?![\d.,])/g

const toNumber = (text: string): number => Number(text.replace(/,/g, ''))

/**
 * The count and amount printed against a label. The amount is the figure with
 * halalas and the count the bare integer, so neither depends on which side of
 * the label its column sits — the receipt is laid out right to left, and the
 * page may or may not keep that order.
 *
 * A label whose figures were split into the following lines is still read: the
 * next couple of lines are considered, and the search stops at the next label
 * so one row can never borrow another's numbers.
 */
function rowFor(lines: readonly string[], label: string): ReceiptRow | null {
  const others = ROW_LABELS.map(({ label: other }) => other).filter((other) => other !== label)
  const index = lines.findIndex((line) => hasLabel(line, label))
  if (index === -1) return null

  const row: ReceiptRow = { count: null, amount: null }

  for (let cursor = index; cursor < Math.min(index + 3, lines.length); cursor += 1) {
    if (cursor > index && others.some((other) => hasLabel(lines[cursor], other))) break

    const line = lines[cursor]
    const amounts = line.match(AMOUNT) ?? []
    // The label's own text must not be mined for digits (C/ADV, 3D, and so on).
    const rest = line.replace(new RegExp(escape(label), 'gi'), ' ')
    const counts = (rest.replace(AMOUNT, ' ').match(COUNT) ?? []).map(Number)

    // A row printed on one line gives both at once; one broken across lines
    // gives them a line at a time, so each is taken the first time it appears.
    if (row.amount === null && amounts.length > 0) row.amount = toNumber(amounts[amounts.length - 1])
    if (row.count === null && counts.length > 0) row.count = counts[0]
    if (row.amount !== null && row.count !== null) break
  }

  return row
}


const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/** `TOTAL DB` must not match inside `TOTAL DBX`, and spacing may vary. */
function hasLabel(line: string, label: string): boolean {
  const pattern = new RegExp(`(?<![A-Za-z])${escape(label).replace(/\s+/g, '\\s+')}(?![A-Za-z])`, 'i')
  return pattern.test(line)
}

const DATE = /\b(\d{2})\/(\d{2})\/(\d{4})\b/
const TIME = /\b(\d{2}):(\d{2})(?::(\d{2}))?\b/
/** The receipt's own reference: a long run of digits, unbroken. */
const REFERENCE = /(?<![\d])\d{14,20}(?![\d])/

export function parseReceiptHtml(html: string): MadaReceipt {
  const lines = textLines(html)
  const all = lines.join('\n')

  const rows: Record<string, ReceiptRow> = {}
  const missing: string[] = []
  for (const { key, label } of ROW_LABELS) {
    const row = rowFor(lines, label)
    if (row === null) missing.push(label)
    else rows[key] = row
  }

  const date = DATE.exec(all)
  const time = TIME.exec(all)
  const reference = REFERENCE.exec(all.replace(/[\s,]/g, ' '))

  const matched = /totals\s*matched|المجاميع\s*متوافقة/i.test(all)
  const notMatched = /totals\s*not\s*matched|المجاميع\s*غير\s*متوافقة/i.test(all)

  return {
    merchant: merchantOf(lines),
    reference: reference?.[0] ?? null,
    date: date ? `${date[3]}-${date[2]}-${date[1]}` : null,
    time: time ? `${time[1]}:${time[2]}:${time[3] ?? '00'}` : null,
    totalsMatched: notMatched ? false : matched ? true : null,
    rows,
    missing,
  }
}

/**
 * The shop the receipt is for: the heading above the date. Taken by position in
 * the heading block rather than by a label, because the receipt prints the name
 * with no label of its own — so it is the one field returned on a best effort.
 */
function merchantOf(lines: readonly string[]): string | null {
  const end = lines.findIndex((line) => DATE.test(line))
  const heading = (end === -1 ? lines.slice(0, 6) : lines.slice(0, end))
    .map((line) => line.trim())
    .filter(
      (line) =>
        /[A-Za-z؀-ۿ]/.test(line) &&
        !/^mada$/i.test(line) &&
        !/^مدى$/.test(line) &&
        !/^\d+$/.test(line),
    )

  return heading.length === 0 ? null : heading.join(' ').replace(/\s+/g, ' ').trim()
}
