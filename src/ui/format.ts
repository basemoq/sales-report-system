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
 * The name the filled template is saved under. One name for the whole app, so
 * a report downloaded from the day's build and the same report downloaded again
 * from the saved list arrive as the same file.
 */
export const REPORT_FILE_NAME = 'تقرير المبيعات المعارض.xlsx'
