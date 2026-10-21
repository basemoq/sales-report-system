import { describe, expect, it } from 'vitest'
import { checkCash, readReply, requestClosingCash } from './closingCash'
import type { EmployeeSummary } from './model'

const employee = (userId: string, cash?: number): EmployeeSummary => ({
  userId,
  fullName: null,
  shopId: 'WFW430',
  total: 1000,
  transactions: 3,
  byPaymentMethod: cash === undefined ? { 'SPAN Offline': 1000 } : { Cash: cash, 'SPAN Offline': 1000 - cash },
  days: [],
})

describe('checkCash', () => {
  const closing = { byUser: { 'BASEM.ALAWALGY': { cash: 400, closings: 1 } }, unmatched: [] }

  it('matches the login whatever its case', () => {
    expect(checkCash(employee('Basem.Alawalgy', 470), closing)).toEqual({ caco: 470, recorded: 400, difference: -70 })
  })

  it('reads a surplus as a positive difference', () => {
    expect(checkCash(employee('Basem.Alawalgy', 350), closing).difference).toBe(50)
  })

  it('counts no closing as nothing recorded', () => {
    expect(checkCash(employee('Ali.Test', 120.5), closing)).toEqual({ caco: 120.5, recorded: null, difference: -120.5 })
  })

  it('treats an employee with no cash in CACO as zero', () => {
    expect(checkCash(employee('Basem.Alawalgy'), closing)).toEqual({ caco: 0, recorded: 400, difference: 400 })
  })
})

describe('readReply', () => {
  it('ignores other messages and other requests', () => {
    expect(readReply(null, 'a')).toBeUndefined()
    expect(readReply({ type: 'sales-report:final' }, 'a')).toBeUndefined()
    expect(readReply({ type: 'sales-report:closing-cash', id: 'b', byUser: {} }, 'a')).toBeUndefined()
  })

  it('reads a branch that is not switched on as no columns', () => {
    expect(readReply({ type: 'sales-report:closing-cash', id: 'a', byUser: null }, 'a')).toBeNull()
  })

  it('keeps numbers only and upper-cases the logins', () => {
    const reply = readReply(
      {
        type: 'sales-report:closing-cash',
        id: 'a',
        byUser: { 'basem.alawalgy': { cash: '400.5', closings: 2 }, bad: { cash: 'x' } },
        unmatched: ['خالد', 7],
      },
      'a',
    )
    expect(reply).toEqual({ byUser: { 'BASEM.ALAWALGY': { cash: 400.5, closings: 2 } }, unmatched: ['خالد'] })
  })
})

describe('requestClosingCash', () => {
  it('resolves nothing standalone, without a parent to ask', async () => {
    expect(await requestClosingCash({ shopId: 'WFW430', from: '2026-10-18', to: '2026-10-18' })).toBeNull()
  })
})
