/**
 * Latin digits with grouping, which is how these reports are read and checked
 * against the source exports.
 */
const money = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const count = new Intl.NumberFormat('en-US')

export function formatMoney(value: number): string {
  return money.format(value)
}

export function formatCount(value: number): string {
  return count.format(value)
}

const WEEKDAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

/** `2025-03-01 (السبت)` — the weekday matters when checking a daily report. */
export function formatDayLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return isoDate
  return `${isoDate} (${WEEKDAYS[date.getUTCDay()]})`
}

/**
 * The name the filled template is saved under. One place for the whole app, so
 * a report downloaded from the day's build and the same report downloaded again
 * from the saved list arrive as the same file — and the day is part of it, or a
 * month of reports would pile up as «… (1)», «… (2)» in the downloads folder.
 *
 * The name is Latin on purpose. A blob download carries its name in the anchor's
 * `download` attribute, and Chrome drops an Arabic one entirely: the file
 * arrived as «download», with no extension, so it would not open on a
 * double-click. The date keeps it readable and keeps each day apart.
 */
export function reportFileName(isoDate: string): string {
  return `sales-report-${isoDate}.xlsx`
}

/** The stock sheet's file name: Latin for the same reason, and shop + day. */
export function stockFileName(shopId: string | null, isoDate: string): string {
  return `stock-${shopId ? `${shopId}-` : ''}${isoDate}.xlsx`
}
