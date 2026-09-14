export interface DayDetail {
  /** `YYYY-MM-DD`. */
  date: string
  amount: number
  transactions: number
}

export interface EmployeeSummary {
  /** The login the transaction was recorded under. */
  userId: string
  fullName: string | null
  shopId: string | null
  total: number
  transactions: number
  /** Amount settled per payment method, as the export names them. */
  byPaymentMethod: Record<string, number>
  days: DayDetail[]
}

/** Day-by-day totals, ascending, one transaction per entry. */
export function summarizeDays(
  entries: readonly { date: Date; amount: number }[],
): DayDetail[] {
  const byDay = new Map<string, DayDetail>()

  for (const entry of entries) {
    const key = entry.date.toISOString().slice(0, 10)
    const day = byDay.get(key)
    if (day) {
      day.amount += entry.amount
      day.transactions += 1
    } else {
      byDay.set(key, { date: key, amount: entry.amount, transactions: 1 })
    }
  }

  return [...byDay.values()]
    .map((day) => ({ ...day, amount: Math.round(day.amount * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date))
}
