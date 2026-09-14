import { describe, expect, it } from 'vitest'
import { summarizeEmployees } from './employees'
import type { SalesRecord } from './model'

const record = (overrides: Partial<SalesRecord> = {}): SalesRecord => ({
  date: new Date(Date.UTC(2025, 2, 1)),
  shopId: '101',
  locationName: 'الرياض',
  employee: 'أحمد',
  amount: 100,
  transactions: 1,
  sourceFile: 'a.xlsx',
  ...overrides,
})

describe('summarizeEmployees', () => {
  it('totals each employee and details their days', () => {
    const summaries = summarizeEmployees([
      record({ amount: 100 }),
      record({ amount: 250, date: new Date(Date.UTC(2025, 2, 2)) }),
    ])

    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({ employee: 'أحمد', total: 350, transactions: 2 })
    expect(summaries[0].days).toEqual([
      { date: '2025-03-01', amount: 100, transactions: 1 },
      { date: '2025-03-02', amount: 250, transactions: 1 },
    ])
  })

  it('keeps one person as one row across spelling variants', () => {
    const summaries = summarizeEmployees([
      record({ employee: 'أحمد' }),
      record({ employee: 'احمد' }),
      record({ employee: 'أحـمد' }),
    ])

    expect(summaries).toHaveLength(1)
    expect(summaries[0].total).toBe(300)
    expect(summaries[0].employee).toBe('أحمد')
  })

  it('reports an employee once per branch they worked', () => {
    const summaries = summarizeEmployees([
      record({ shopId: '101', locationName: 'الرياض', amount: 100 }),
      record({ shopId: '102', locationName: 'جدة', amount: 400 }),
    ])

    expect(summaries.map((s) => [s.shopId, s.total])).toEqual([
      ['102', 400],
      ['101', 100],
    ])
  })

  it('ranks by total, highest first', () => {
    const summaries = summarizeEmployees([
      record({ employee: 'سالم', amount: 50 }),
      record({ employee: 'أحمد', amount: 500 }),
      record({ employee: 'خالد', amount: 200 }),
    ])

    expect(summaries.map((s) => s.employee)).toEqual(['أحمد', 'خالد', 'سالم'])
  })

  it('sums the transaction counts a row stands for', () => {
    const summaries = summarizeEmployees([
      record({ transactions: 5 }),
      record({ transactions: 3 }),
    ])
    expect(summaries[0].transactions).toBe(8)
  })

  it('leaves out rows with no employee named', () => {
    expect(summarizeEmployees([record({ employee: null })])).toEqual([])
  })

  it('returns nothing for no records', () => {
    expect(summarizeEmployees([])).toEqual([])
  })
})
