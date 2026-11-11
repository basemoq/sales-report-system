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
  /**
   * How many of those transactions were new activations (see `isNewActivation`).
   * Absent on reports saved before it was counted.
   */
  activations?: number
  /** Amount settled per payment method, as the export names them. */
  byPaymentMethod: Record<string, number>
  /**
   * The employee's cancelled orders that a refund reversed — usually issued
   * centrally (`zainops`), not from the drawer. CACO nets each pair to nothing,
   * but the money the customer paid is still in this employee's drawer or on
   * the terminal, so the closing reads it as a surplus. Listed so the report
   * can say why. Absent when there were none, and on reports saved before.
   */
  refundedOrders?: { time: string | null; amount: number; method: string }[]
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
