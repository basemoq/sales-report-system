import type { DailyFigures, ReportIdentity } from './dailyReport'
import type { EmployeeSummary } from './model'

/** What a saved report keeps, enough to rebuild its filled template later. */
export interface SavedReportData {
  figures: DailyFigures
  employees: EmployeeSummary[]
  identity: ReportIdentity
  shopId: string | null
  /** `YYYY-MM-DD`; the stored id also carries the shop, so it is kept apart. */
  reportDate: string
}

/**
 * Dates arrive from IndexedDB as Date objects, but a report saved by an older
 * build, or one round-tripped through JSON, carries a string instead.
 */
export function reviveSavedReport(data: unknown): SavedReportData | null {
  if (typeof data !== 'object' || data === null) return null
  const saved = data as Partial<SavedReportData>
  if (saved.figures === undefined) return null

  const date = saved.figures.date
  const revivedDate = date === null || date === undefined ? null : new Date(date)

  return {
    figures: { ...saved.figures, date: revivedDate },
    employees: saved.employees ?? [],
    identity: saved.identity ?? { showroom: '', supervisor: '' },
    shopId: saved.shopId ?? null,
    // Reports saved before the day was kept apart from the id still carry it
    // on their figures.
    reportDate: saved.reportDate ?? revivedDate?.toISOString().slice(0, 10) ?? '',
  }
}
