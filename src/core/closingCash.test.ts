import { describe, expect, it } from 'vitest'
import { checkCash, checkSpan, readReply, requestClosingCash } from './closingCash'
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
  const closing = { byUser: { 'BASEM.ALAWALGY': { cash: 400, span: 200, tabs: null, msap: null, difference: null, closings: 1 } }, unmatched: [] }

  it('matches the login whatever its case, and sets cash and SPAN against CACO together', () => {
    expect(checkCash(employee('Basem.Alawalgy', 470, 200), closing)).toEqual({
      cacoCash: 470,
      cacoSpan: 200,
      cash: 400,
      span: 200,
      tabs: null,
      msap: null,
      difference: -70,
    })
  })

  it('lets a SPAN over the terminal make up cash under it, as the closing itself does', () => {
    expect(checkCash(employee('Basem.Alawalgy', 450, 150), closing).difference).toBe(0)
  })

  it('reads a surplus as a positive difference', () => {
    expect(checkCash(employee('Basem.Alawalgy', 350, 200), closing).difference).toBe(50)
  })

  it('shows no difference for an employee with no closing', () => {
    expect(checkCash(employee('Ali.Test', 120.5, 30), closing)).toEqual({
      cacoCash: 120.5,
      cacoSpan: 30,
      cash: null,
      span: null,
      tabs: null,
      msap: null,
      difference: null,
    })
  })

  it('treats an employee with no cash or SPAN in CACO as zero', () => {
    expect(checkCash(employee('Basem.Alawalgy'), closing)).toMatchObject({ cacoCash: 0, cacoSpan: 0, difference: 600 })
  })

  it('counts a closing sent without its SPAN as cash alone', () => {
    const cashOnly = { byUser: { 'BASEM.ALAWALGY': { cash: 400, span: null, tabs: null, msap: null, difference: null, closings: 1 } }, unmatched: [] }
    expect(checkCash(employee('Basem.Alawalgy', 400), cashOnly)).toMatchObject({ span: null, difference: 0 })
  })

  it('takes the TABS recorded at closing off, since its cash is in the closing and not in CACO', () => {
    // 10 November 2026: 129.13 of TABS in the closing read as a 129.13 surplus.
    const withTabs = { byUser: { 'MANSOUR.ALREMY': { cash: 341.5, span: 918.72, tabs: 129.13, msap: null, difference: null, closings: 1 } }, unmatched: [] }
    expect(checkCash(employee('Mansour.Alremy', 212.37, 918.72), withTabs)).toMatchObject({
      tabs: 129.13,
      difference: 0,
    })
  })

  it('still shows a real shortage once TABS is accounted for', () => {
    const withTabs = { byUser: { 'MANSOUR.ALREMY': { cash: 300, span: 918.72, tabs: 129.13, msap: null, difference: null, closings: 1 } }, unmatched: [] }
    expect(checkCash(employee('Mansour.Alremy', 212.37, 918.72), withTabs).difference).toBe(-41.5)
  })
})

describe('the closing itself, and the mada reconciliation (11 November 2026)', () => {
  // The owner's call: the check is what the employee closed with, and the
  // day's SPAN against the mada slip — not CACO, which a cancelled or
  // centrally refunded order can throw off.
  const closings = {
    byUser: {
      'BADER.ALTHUBYANI': { cash: 1158, span: 360.26, tabs: 0, msap: 0, difference: -0.35, closings: 1 },
      'MALEK.ALSHAREEF': { cash: 725, span: 505.89, tabs: 0, msap: 75.5, difference: 0, closings: 1 },
    },
    unmatched: [],
  }

  it('takes each employee’s difference from their own closing, whatever CACO says', () => {
    expect(checkCash(employee('Malek.Alshareef', 990.87, 120.02), closings).difference).toBe(0)
    expect(checkCash(employee('Bader.Althubyani', 1408.35, 110.26), closings).difference).toBe(-0.35)
  })

  it('carries the MSAP (app) sales recorded at closing, for its own column', () => {
    expect(checkCash(employee('Malek.Alshareef', 0), closings).msap).toBe(75.5)
    expect(checkCash(employee('Ali.Test', 0), closings).msap).toBeNull()
  })

  it('proves the day’s SPAN against the reconciliation, and says by how much it is off', () => {
    const checks = [
      checkCash(employee('Malek.Alshareef', 0), closings),
      checkCash(employee('Bader.Althubyani', 0), closings),
    ]
    expect(checkSpan(checks, 866.15)).toEqual({ closingSpan: 866.15, reconciliation: 866.15, difference: 0 })
    expect(checkSpan(checks, 900).difference).toBe(-33.85)
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
          'basem.alawalgy': { cash: '400.5', span: '120', tabs: '50.25', msap: '30', difference: '-3', closings: 2 },
          'ali.test': { cash: 10 },
          bad: { cash: 'x' },
        },
        unmatched: ['خالد', 7],
      },
      'a',
    )
    expect(reply).toEqual({
      byUser: {
        'BASEM.ALAWALGY': { cash: 400.5, span: 120, tabs: 50.25, msap: 30, difference: -3, closings: 2 },
        'ALI.TEST': { cash: 10, span: null, tabs: null, msap: null, difference: null, closings: 0 },
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
