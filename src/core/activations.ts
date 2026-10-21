import type { CacoTransaction } from './sources/caco'

/**
 * Whether one CACO line is a new activation — a line or SIM that did not exist
 * before the sale. The rule is the owner's (29 September 2026), the same one
 * the control center's CACO estimate counts by, so the two never disagree:
 *
 * - «New Mobile Line …»            a new postpaid line (5G Home included)
 * - «Setup Fee Prepaid»            a new prepaid SIM
 * - «… Visitor …»                  a visitor line
 * - «Setup Fee + RS Setup Fee»     a new postpaid line on the RS 250 offer
 * - «Setup Fee» on its own         a postpaid line ported in from another operator
 *
 * Not counted: MultiSim (an extra SIM on an existing line), payments, top-ups,
 * renewals, SIM swaps, devices, refunds, and anything superseded, cancelled or
 * suspended.
 */
export function isNewActivation(transaction: CacoTransaction): boolean {
  if (/superseded|cancel|suspend/i.test(transaction.status ?? '')) return false
  if (!(transaction.amount > 0)) return false

  const raw = transaction.orderType ?? ''
  const flat = raw.replace(/[‎‏]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (flat === '' || flat === 'refund') return false
  if (/multi\s*sim/i.test(raw)) return false

  if (/new\s*mobile\s*line/i.test(raw)) return true
  if (/setup\s*fee\s*prepaid/i.test(raw)) return true
  if (/visitor/i.test(raw)) return true

  const bare = flat.replace(/"/g, '')
  return bare === 'setup fee' || bare === 'setup fee rs setup fee'
}
