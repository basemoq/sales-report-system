import type { DailyFigures, ReportIdentity } from './dailyReport'
import type { EmployeeSummary } from './model'

/** What a saved report keeps, enough to rebuild its filled template later. */
export interface SavedReportData {
  figures: DailyFigures
  employees: EmployeeSummary[]
  identity: ReportIdentity
  shopId: string | null
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
  return {
    figures: {
      ...saved.figures,
      date: date === null || date === undefined ? null : new Date(date),
    },
    employees: saved.employees ?? [],
    identity: saved.identity ?? { showroom: '', supervisor: '' },
    shopId: saved.shopId ?? null,
  }
}
