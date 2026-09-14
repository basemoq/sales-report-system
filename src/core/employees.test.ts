import { describe, expect, it } from 'vitest'
import { summarizeEmployees } from './employees'
import type { CacoTransaction } from './sources/caco'

const tx = (overrides: Partial<CacoTransaction> = {}): CacoTransaction => ({
  userId: 'Basem.Alawalgy',
  userFullName: 'Basem.Alawalgy',
  manager: 'Hussain.Khorma',
  shopId: 'WFW430',
  date: new Date(Date.UTC(2026, 8, 13)),
  time: '5:38 PM',
  receiptNo: 'ZN_1',
  amount: 100,
  paymentMethod: 'Cash',
  orderType: 'Setup Fee',
  salesOrderNumber: '1',
  status: 'Processed',
  ...overrides,
})

describe('summarizeEmployees', () => {
  it('totals each user and counts their transactions', () => {
    const summaries = summarizeEmployees([tx({ amount: 40.25 }), tx({ amount: 10 })])

    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({
      userId: 'Basem.Alawalgy',
      shopId: 'WFW430',
      total: 50.25,
      transactions: 2,
    })
  })

  it('splits each user total across the payment methods used', () => {
    const summaries = summarizeEmployees([
      tx({ amount: 40.25, paymentMethod: 'SPAN Offline' }),
      tx({ amount: 10, paymentMethod: 'SPAN Offline' }),
      tx({ amount: 470, paymentMethod: 'Cash' }),
    ])

    expect(summaries[0].byPaymentMethod).toEqual({ 'SPAN Offline': 50.25, Cash: 470 })
  })

  it('details the days a user recorded transactions on', () => {
    const summaries = summarizeEmployees([
      tx({ amount: 100, date: new Date(Date.UTC(2026, 8, 13)) }),
      tx({ amount: 250, date: new Date(Date.UTC(2026, 8, 14)) }),
      tx({ amount: 50, date: new Date(Date.UTC(2026, 8, 13)) }),
    ])

    expect(summaries[0].days).toEqual([
      { date: '2026-09-13', amount: 150, transactions: 2 },
      { date: '2026-09-14', amount: 250, transactions: 1 },
    ])
  })

  it('keeps one login as one row despite a difference in case', () => {
    const summaries = summarizeEmployees([
      tx({ userId: 'Basem.Alawalgy' }),
      tx({ userId: 'basem.alawalgy' }),
    ])

    expect(summaries).toHaveLength(1)
    expect(summaries[0].userId).toBe('Basem.Alawalgy')
    expect(summaries[0].total).toBe(200)
  })

  it('ranks by total, highest first', () => {
    const summaries = summarizeEmployees([
      tx({ userId: 'a', amount: 50 }),
      tx({ userId: 'b', amount: 500 }),
      tx({ userId: 'c', amount: 200 }),
    ])

    expect(summaries.map((s) => s.userId)).toEqual(['b', 'c', 'a'])
  })

  it('rounds each total to halalas', () => {
    const summaries = summarizeEmployees([
      tx({ amount: 2048.39 }),
      tx({ amount: 241.59 }),
      tx({ amount: 0.01 }),
    ])

    expect(summaries[0].total).toBe(2289.99)
  })

  it('returns nothing for no transactions', () => {
    expect(summarizeEmployees([])).toEqual([])
  })
})
