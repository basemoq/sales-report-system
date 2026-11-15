/**
 * Saved reports laid out by month, then by week of the month, so a long list
 * opens to the few days someone is looking for instead of one tall table.
 *
 * A week here is a fixed stretch of the month's days — 1–7, 8–14, 15–21,
 * 22–28, and what is left — because that is how a day's date is found by eye;
 * calendar weeks straddle months and would file one week under two headings.
 */
export interface WeekGroup<T> {
  /** 1-based week of the month. */
  week: number
  /** First and last day of the month the week covers. */
  from: number
  to: number
  items: T[]
}

export interface MonthGroup<T> {
  /** `YYYY-MM`. */
  key: string
  label: string
  count: number
  weeks: WeekGroup<T>[]
}

const MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
]

const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()

/**
 * Groups items by the `YYYY-MM-DD` day `dayOf` gives, newest month and newest
 * week first; the order of items inside a week is the order they came in.
 * Items with no readable day are returned apart, never dropped.
 */
export function groupByMonthAndWeek<T>(
  items: readonly T[],
  dayOf: (item: T) => string | null | undefined,
): { months: MonthGroup<T>[]; undated: T[] } {
  const months = new Map<string, MonthGroup<T>>()
  const undated: T[] = []

  for (const item of items) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dayOf(item) ?? '')
    const year = match ? Number(match[1]) : 0
    const month = match ? Number(match[2]) : 0
    const day = match ? Number(match[3]) : 0
    if (!match || month < 1 || month > 12 || day < 1 || day > 31) {
      undated.push(item)
      continue
    }

    const key = `${match[1]}-${match[2]}`
    let group = months.get(key)
    if (!group) {
      group = { key, label: `${MONTHS[month - 1]} ${year}`, count: 0, weeks: [] }
      months.set(key, group)
    }
    const week = Math.min(5, Math.ceil(day / 7))
    let slot = group.weeks.find((entry) => entry.week === week)
    if (!slot) {
      const from = (week - 1) * 7 + 1
      slot = { week, from, to: week === 5 ? daysIn(year, month) : from + 6, items: [] }
      group.weeks.push(slot)
    }
    slot.items.push(item)
    group.count += 1
  }

  const sorted = [...months.values()].sort((a, b) => b.key.localeCompare(a.key))
  for (const group of sorted) group.weeks.sort((a, b) => b.week - a.week)
  return { months: sorted, undated }
}
