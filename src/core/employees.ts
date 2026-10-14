import { isNewActivation } from './activations'
import { summarizeDays, type EmployeeSummary } from './model'
import type { CacoTransaction } from './sources/caco'
import { matchKey } from './text'

const round2 = (value: number) => Math.round(value * 100) / 100

/**
 * Groups the detailed export's transactions by the user who recorded them.
 * Logins are folded case- and spelling-insensitively so one person does not
 * split into two rows, and the first spelling seen is the one displayed.
 */
export function summarizeEmployees(
  transactions: readonly CacoTransaction[],
): EmployeeSummary[] {
  const groups = new Map<string, CacoTransaction[]>()

  for (const transaction of transactions) {
    const key = matchKey(transaction.userId)
    const group = groups.get(key)
    if (group) group.push(transaction)
    else groups.set(key, [transaction])
  }

  return [...groups.values()]
    .map((own) => {
      const byPaymentMethod: Record<string, number> = {}
      for (const transaction of own) {
        byPaymentMethod[transaction.paymentMethod] = round2(
          (byPaymentMethod[transaction.paymentMethod] ?? 0) + transaction.amount,
        )
      }

      return {
        userId: own[0].userId,
        fullName: own[0].userFullName,
        shopId: own[0].shopId,
        total: round2(own.reduce((sum, t) => sum + t.amount, 0)),
        transactions: own.length,
        activations: own.filter(isNewActivation).length,
        byPaymentMethod,
        days: summarizeDays(own),
      }
    })
    .sort((a, b) => b.total - a.total || a.userId.localeCompare(b.userId))
}
