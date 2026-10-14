import { describe, expect, it } from 'vitest'
import { isNewActivation } from './activations'
import type { CacoTransaction } from './sources/caco'

const tx = (overrides: Partial<CacoTransaction> = {}): CacoTransaction => ({
  userId: 'Basem.Alawalgy',
  userFullName: null,
  manager: null,
  shopId: 'WFW430',
  date: new Date(Date.UTC(2026, 9, 13)),
  time: null,
  receiptNo: 'ZN_1',
  msisdn: null,
  account: null,
  amount: 100,
  paymentMethod: 'Cash',
  orderType: 'Setup Fee',
  salesOrderNumber: '1',
  status: 'Processed',
  ...overrides,
})

describe('isNewActivation', () => {
  it.each([
    'New Mobile Line - Postpaid 250',
    'New Mobile Line 5G Home',
    'Setup Fee Prepaid',
    'Prepaid Visitor SIM',
    'Setup Fee',
    '"Setup Fee" "RS Setup Fee"',
  ])('counts %s', (orderType) => {
    expect(isNewActivation(tx({ orderType }))).toBe(true)
  })

  it.each([
    'Invoice Payment',
    'Sales Order Payment',
    'Top Up',
    'EVD Voucher',
    'Device Installment',
    'IPHONE 17 PRO MAX',
    'MultiSim Setup Fee',
    'Refund',
  ])('does not count %s', (orderType) => {
    expect(isNewActivation(tx({ orderType }))).toBe(false)
  })

  it('does not count a superseded or cancelled line', () => {
    expect(isNewActivation(tx({ status: 'Superseded' }))).toBe(false)
    expect(isNewActivation(tx({ status: 'Cancelled' }))).toBe(false)
  })

  it('does not count a zero or negative amount', () => {
    expect(isNewActivation(tx({ amount: 0 }))).toBe(false)
    expect(isNewActivation(tx({ amount: -20 }))).toBe(false)
  })

  it('does not count a line with no order type', () => {
    expect(isNewActivation(tx({ orderType: null }))).toBe(false)
  })
})
