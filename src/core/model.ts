export interface SalesRecord {
  /** UTC midnight of the day the sale belongs to. */
  date: Date
  shopId: string
  locationName: string
  employee: string | null
  amount: number
  /** Checks the row stands for; 1 unless the source reports a count. */
  transactions: number
  sourceFile: string
}

export interface DayDetail {
  /** `YYYY-MM-DD`. */
  date: string
  amount: number
  transactions: number
}

export interface LocationSummary {
  shopId: string
  locationName: string
  total: number
  transactions: number
  /** Every day the location has records for, ascending. */
  days: DayDetail[]
}

export interface EmployeeSummary {
  employee: string
  shopId: string
  locationName: string
  total: number
  transactions: number
  days: DayDetail[]
}
