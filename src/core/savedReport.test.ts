import { describe, expect, it } from 'vitest'
import { reviveSavedReport } from './savedReport'

const figures = {
  date: new Date(Date.UTC(2026, 8, 13)),
  tabs: { billPayment: 723.3, ordering: 0, cashCollection: 0 },
  bss: { billPayment: 2289.98, ordering: 1411.16, cashSales: 423 },
  cards: { mada: 1190.2, visa: 590.59, mastercard: 0 },
  totalSales: 4847.44,
  cashDeposit: 3066.65,
}

const saved = {
  figures,
  employees: [],
  identity: { showroom: 'الشرائع', supervisor: 'باسم العولقي' },
  shopId: 'WFW430',
  reportDate: '2026-09-13',
}

describe('reviveSavedReport', () => {
  it('reads back a report saved with everything needed to refill the template', () => {
    const revived = reviveSavedReport(saved)

    expect(revived?.identity).toEqual({ showroom: 'الشرائع', supervisor: 'باسم العولقي' })
    expect(revived?.shopId).toBe('WFW430')
    expect(revived?.figures.totalSales).toBe(4847.44)
  })

  it('turns a date that came back as text into a Date', () => {
    const revived = reviveSavedReport({
      ...saved,
      figures: { ...figures, date: '2026-09-13T00:00:00.000Z' },
    })

    expect(revived?.figures.date).toBeInstanceOf(Date)
    expect(revived?.figures.date?.toISOString().slice(0, 10)).toBe('2026-09-13')
  })

  it('keeps a null date null', () => {
    const revived = reviveSavedReport({ ...saved, figures: { ...figures, date: null } })
    expect(revived?.figures.date).toBeNull()
  })

  it('fills in the identity a report saved by an earlier build has no room for', () => {
    const revived = reviveSavedReport({ figures, employees: [] })

    expect(revived?.identity).toEqual({ showroom: '', supervisor: '' })
    expect(revived?.shopId).toBeNull()
  })

  it('recovers the day of a report saved before it was kept apart from the id', () => {
    const revived = reviveSavedReport({ figures, employees: [] })
    expect(revived?.reportDate).toBe('2026-09-13')
  })

  it('keeps the stored day when it is there', () => {
    expect(reviveSavedReport(saved)?.reportDate).toBe('2026-09-13')
  })

  it('refuses data that carries no figures to refill from', () => {
    expect(reviveSavedReport({ employees: [] })).toBeNull()
    expect(reviveSavedReport(null)).toBeNull()
    expect(reviveSavedReport('nonsense')).toBeNull()
  })
})
