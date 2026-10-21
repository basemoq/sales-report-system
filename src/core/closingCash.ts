import type { EmployeeSummary } from './model'

/**
 * The cash each employee recorded when closing their shift, as the control
 * center holds it. The report has no server of its own: inside the control
 * center it asks the frame's parent, which answers for the branches it has
 * switched on; standalone there is no parent and the columns never appear.
 */
export interface ClosingCash {
  /** Keyed by the login (the CACO user id), upper-cased. */
  byUser: Record<string, { cash: number; closings: number }>
  /** Closings in the range that could not be tied to a login, by the name typed. */
  unmatched: string[]
}

/** The payment method CACO records cash under. */
export const CASH_METHOD = 'Cash'

const REQUEST = 'sales-report:closing-cash?'
const REPLY = 'sales-report:closing-cash'

export interface CashCheck {
  /** Cash in CACO for the employee. */
  caco: number
  /** Cash recorded at closing; `null` when no closing was recorded. */
  recorded: number | null
  /** Recorded − CACO: below zero is a shortage. No closing counts as nothing recorded. */
  difference: number
}

const round2 = (value: number) => Math.round(value * 100) / 100

export function checkCash(employee: EmployeeSummary, closing: ClosingCash): CashCheck {
  const caco = employee.byPaymentMethod[CASH_METHOD] ?? 0
  const entry = closing.byUser[employee.userId.trim().toUpperCase()]
  const recorded = entry ? round2(entry.cash) : null
  return { caco, recorded, difference: round2((recorded ?? 0) - caco) }
}

/** The reply as sent, or `null` when it is not one: a malformed answer shows no columns. */
export function readReply(data: unknown, id: string): ClosingCash | null | undefined {
  if (!data || typeof data !== 'object') return undefined
  const message = data as Record<string, unknown>
  if (message.type !== REPLY || message.id !== id) return undefined
  if (!message.byUser || typeof message.byUser !== 'object') return null
  const byUser: ClosingCash['byUser'] = {}
  for (const [user, value] of Object.entries(message.byUser as Record<string, unknown>)) {
    const entry = value as { cash?: unknown; closings?: unknown } | null
    const cash = Number(entry?.cash)
    if (!Number.isFinite(cash)) continue
    byUser[user.trim().toUpperCase()] = { cash, closings: Math.max(0, Number(entry?.closings) || 0) }
  }
  const unmatched = Array.isArray(message.unmatched)
    ? message.unmatched.filter((name): name is string => typeof name === 'string').slice(0, 20)
    : []
  return { byUser, unmatched }
}

/**
 * Asks the control center for the closings of `shopId` between two dates
 * (`YYYY-MM-DD`, inclusive). Resolves `null` standalone, for a branch the
 * control center has not switched on, or when no answer comes.
 */
export function requestClosingCash(
  query: { shopId: string | null; from: string; to: string },
  timeoutMs = 10000,
): Promise<ClosingCash | null> {
  if (typeof window === 'undefined' || window.parent === window || !query.shopId) {
    return Promise.resolve(null)
  }
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return new Promise((resolve) => {
    const done = (value: ClosingCash | null) => {
      window.removeEventListener('message', onMessage)
      clearTimeout(timer)
      resolve(value)
    }
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin) return
      const reply = readReply(event.data, id)
      if (reply !== undefined) done(reply)
    }
    const timer = setTimeout(() => done(null), timeoutMs)
    window.addEventListener('message', onMessage)
    try {
      window.parent.postMessage({ type: REQUEST, id, ...query }, window.location.origin)
    } catch {
      done(null)
    }
  })
}
