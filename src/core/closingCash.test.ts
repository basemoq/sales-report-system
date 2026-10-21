import { describe, expect, it } from 'vitest'
import { checkCash, readReply, requestClosingCash } from './closingCash'
import type { EmployeeSummary } from './model'

const employee = (userId: string, cash?: number, span = 0): EmployeeSummary => ({
  userId,
  fullName: null,
  shopId: 'WFW430',
  total: 1000,
  transactions: 3,
  byPaymentMethod:
    cash === undefined
      ? { 'Bank Transfer': 1000 }
      : { Cash: cash, 'SPAN Offline': span, 'Bank Transfer': 1000 - cash - span },
  days: [],
})

describe('checkCash', () => {
  const closing = { byUser: { 'BASEM.ALAWALGY': { cash: 400, span: 200, closings: 1 } }, unmatched: [] }

  it('matches the login whatever its case, and sets cash and SPAN against CACO together', () => {
    expect(checkCash(employee('Basem.Alawalgy', 470, 200), closing)).toEqual({
      cacoCash: 470,
      cacoSpan: 200,
      cash: 400,
      span: 200,
      difference: -70,
    })
  })

  it('lets a SPAN over the terminal make up cash under it, as the closing itself does', () => {
    expect(checkCash(employee('Basem.Alawalgy', 450, 150), closing).difference).toBe(0)
  })

  it('reads a surplus as a positive difference', () => {
    expect(checkCash(employee('Basem.Alawalgy', 350, 200), closing).difference).toBe(50)
  })

  it('counts no closing as nothing recorded', () => {
    expect(checkCash(employee('Ali.Test', 120.5, 30), closing)).toEqual({
      cacoCash: 120.5,
      cacoSpan: 30,
      cash: null,
      span: null,
      difference: -150.5,
    })
  })

  it('treats an employee with no cash or SPAN in CACO as zero', () => {
    expect(checkCash(employee('Basem.Alawalgy'), closing)).toMatchObject({ cacoCash: 0, cacoSpan: 0, difference: 600 })
  })

  it('counts a closing sent without its SPAN as cash alone', () => {
    const cashOnly = { byUser: { 'BASEM.ALAWALGY': { cash: 400, span: null, closings: 1 } }, unmatched: [] }
    expect(checkCash(employee('Basem.Alawalgy', 400), cashOnly)).toMatchObject({ span: null, difference: 0 })
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
        byUser: {
          'basem.alawalgy': { cash: '400.5', span: '120', closings: 2 },
          'ali.test': { cash: 10 },
          bad: { cash: 'x' },
        },
        unmatched: ['خالد', 7],
      },
      'a',
    )
    expect(reply).toEqual({
      byUser: {
        'BASEM.ALAWALGY': { cash: 400.5, span: 120, closings: 2 },
        'ALI.TEST': { cash: 10, span: null, closings: 0 },
      },
      unmatched: ['خالد'],
    })
  })
})

describe('requestClosingCash', () => {
  it('resolves nothing standalone, without a parent to ask', async () => {
    expect(await requestClosingCash({ shopId: 'WFW430', from: '2026-10-18', to: '2026-10-18' })).toBeNull()
  })
})
