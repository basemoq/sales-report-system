import { parseDateCell } from '../dates'
import { labelKey, linesOf, valueRightOf, type PdfTextItem } from '../pdf'
import { parseNumber } from '../text'

export class TabsFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TabsFormatError'
  }
}

/** The three TABS figures the daily template carries. */
export interface TabsTotals {
  billPayment: number
  ordering: number
  cashCollection: number
}

export interface TabsReport {
  totals: TabsTotals
  /** `Warehouse:` on the detail pages — the shop the report covers. */
  warehouse: string | null
  /** The `Date/Time:` the report was generated. */
  generatedOn: Date | null
  /** Sections found in the file, for showing what was actually read. */
  sectionsFound: string[]
}

type SectionKey = keyof TabsTotals

const SECTION_TITLES: { key: SectionKey; title: string }[] = [
  { key: 'billPayment', title: 'Bill Payment Report' },
  // The export's own spelling of "Ordering".
  { key: 'ordering', title: 'Ordring Report' },
  { key: 'ordering', title: 'Ordering Report' },
  { key: 'cashCollection', title: 'Cashiers Collection-Cash Report' },
]

const TITLE_KEYS = new Map(SECTION_TITLES.map(({ key, title }) => [labelKey(title), key]))

const GRAND_TOTAL = labelKey('Grand Total')
const REPORT_MARKER = labelKey('Consolidated Report')

const isAmount = (text: string) => /^\s*[\d,]*\.?\d+\s*$/.test(text) && parseNumber(text) !== null

/**
 * Reads the consolidated TABS export. Each section's figure is the `Grand Total`
 * drawn beside its label; a section whose box was left empty contributed nothing
 * that day and counts as zero, which is how the daily template records it.
 *
 * A section can span several pages — the grand total sits on its last one — so
 * pages are attributed to the most recent section title seen.
 */
export function parseTabsReport(items: readonly PdfTextItem[]): TabsReport {
  // The banner is drawn as separate runs, so it is matched on the joined line.
  if (!linesOf(items).some((line) => labelKey(line).includes(REPORT_MARKER))) {
    throw new TabsFormatError('هذا الملف ليس تقرير TABS المجمّع (Consolidated Report).')
  }

  const pages = [...new Set(items.map((item) => item.page))].sort((a, b) => a - b)
  const totals: TabsTotals = { billPayment: 0, ordering: 0, cashCollection: 0 }
  const sectionsFound: string[] = []
  const seen = new Set<SectionKey>()
  let current: SectionKey | null = null

  for (const page of pages) {
    const onPage = items.filter((item) => item.page === page)

    for (const item of onPage) {
      const key = TITLE_KEYS.get(labelKey(item.text))
      if (key !== undefined) {
        current = key
        if (!seen.has(key)) {
          seen.add(key)
          sectionsFound.push(item.text)
        }
      }
    }

    if (current === null) continue

    const label = onPage.find((item) => labelKey(item.text) === GRAND_TOTAL)
    if (label === undefined) continue

    const value = valueRightOf(items, label, isAmount)
    totals[current] = value === null ? 0 : (parseNumber(value.text) ?? 0)
  }

  return {
    totals,
    warehouse: findLabelledValue(items, 'Warehouse:'),
    generatedOn: parseDateCell(findLabelledValue(items, 'Date/Time:')),
    sectionsFound,
  }
}

/** A banner value drawn to the right of its label, as plain text. */
function findLabelledValue(items: readonly PdfTextItem[], label: string): string | null {
  const key = labelKey(label)
  const found = items.find((item) => labelKey(item.text) === key)
  if (found === undefined) return null
  return valueRightOf(items, found, (text) => text.trim() !== '')?.text.trim() ?? null
}
