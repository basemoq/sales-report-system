/** Excel's day 0 under the 1900 date system, which counts 1900 as a leap year. */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30)
const MS_PER_DAY = 86_400_000

/** Serial 60 is Excel's phantom 1900-02-29; anything below it is off by one day. */
const EXCEL_LEAP_BUG_SERIAL = 60

const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/
/** Day-first: the ordering used by the source reports (31/12/2025). */
const DAY_FIRST = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/

function utcDate(year: number, month: number, day: number): Date | null {
  const d = new Date(Date.UTC(year, month - 1, day))
  const valid =
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  return valid ? d : null
}

/**
 * Normalizes a date as it may appear in a source sheet — a real Date, an Excel
 * serial number, or text — to a UTC-midnight Date. Returns null when the cell
 * does not hold a date, so callers can report the row rather than guess.
 */
export function parseDateCell(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : utcDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate())
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return excelSerialToDate(value)
  }

  if (typeof value === 'string') {
    const text = value.trim()
    if (text === '') return null

    const iso = ISO_DATE.exec(text)
    if (iso) return utcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))

    const dayFirst = DAY_FIRST.exec(text)
    if (dayFirst) return utcDate(Number(dayFirst[3]), Number(dayFirst[2]), Number(dayFirst[1]))

    // A serial that survived export as text.
    if (/^\d+(\.\d+)?$/.test(text)) return excelSerialToDate(Number(text))
  }

  return null
}

export function excelSerialToDate(serial: number): Date | null {
  if (serial < 1 || serial > 2_958_465) return null
  const whole = Math.floor(serial)
  const days = whole < EXCEL_LEAP_BUG_SERIAL ? whole + 1 : whole
  return new Date(EXCEL_EPOCH_UTC + days * MS_PER_DAY)
}

/** `YYYY-MM-DD`. */
export function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** `YYYY-MM` — the key reports are grouped under. */
export function periodKey(date: Date): string {
  return date.toISOString().slice(0, 7)
}

/**
 * A report is identified by the latest date its data covers, so re-uploading an
 * extended export of the same period resolves to the same report only when it
 * ends on the same day.
 */
export function reportIdFromDates(dates: readonly Date[]): string | null {
  if (dates.length === 0) return null
  const latest = dates.reduce((max, d) => (d.getTime() > max.getTime() ? d : max))
  return toISODate(latest)
}

/** Every day from `start` to `end` inclusive, for per-day detail rows. */
export function eachDayInclusive(start: Date, end: Date): Date[] {
  const days: Date[] = []
  for (let t = start.getTime(); t <= end.getTime(); t += MS_PER_DAY) {
    days.push(new Date(t))
  }
  return days
}
