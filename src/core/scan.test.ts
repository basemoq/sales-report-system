import { describe, expect, it } from 'vitest'
import { decodeCodePayload, findByCode } from './scan'
import type { CacoTransaction } from './sources/caco'

const tx = (overrides: Partial<CacoTransaction> = {}): CacoTransaction => ({
  userId: 'Basem.Alawalgy',
  userFullName: 'Basem.Alawalgy',
  manager: 'Hussain.Khorma',
  shopId: 'WFW430',
  date: new Date(Date.UTC(2026, 8, 13)),
  time: '5:38 PM',
  receiptNo: 'ZN_fde6cc55',
  msisdn: '966541703895',
  account: '1001053035',
  amount: 50,
  paymentMethod: 'Cash',
  orderType: 'Setup Fee',
  salesOrderNumber: '1054040706',
  status: 'Processed',
  ...overrides,
})

describe('findByCode', () => {
  it('finds the row whose receipt number the code carries', () => {
    const wanted = tx({ receiptNo: 'ZN_9911' })

    expect(findByCode('ZN_9911', [tx(), wanted])).toEqual([wanted])
  })

  it('reads the number out of a code that wraps it in a URL', () => {
    const wanted = tx({ salesOrderNumber: '1054040706' })

    expect(findByCode('https://zain.com/r?order=1054040706&t=9', [wanted])).toEqual([wanted])
  })

  it('finds every row of one receipt, since a receipt can carry several lines', () => {
    const rows = [tx({ amount: 50 }), tx({ amount: 20 }), tx({ receiptNo: 'ZN_other' })]

    expect(findByCode('ZN_fde6cc55', rows)).toHaveLength(2)
  })

  it('matches the line the sale was against', () => {
    expect(findByCode('966541703895', [tx()])).toHaveLength(1)
  })

  it('ignores leading zeros on either side', () => {
    expect(findByCode('0001054040706', [tx()])).toHaveLength(1)
  })

  it('does not match on a short run that happens to appear', () => {
    expect(findByCode('12', [tx({ receiptNo: '12' })])).toHaveLength(1)
    expect(findByCode('99', [tx()])).toEqual([])
  })

  it('returns nothing for an empty or unrelated code', () => {
    expect(findByCode('   ', [tx()])).toEqual([])
    expect(findByCode('https://example.com/', [tx()])).toEqual([])
  })
})

describe('decodeCodePayload', () => {
  /** Built the way the receipt code is: gzip, base64, inside a link. */
  const pack = async (text: string) => {
    const { gzipSync } = await import('fflate')
    const bytes = gzipSync(new TextEncoder().encode(text))
    return btoa(String.fromCharCode(...bytes))
  }

  it('unpacks the receipt a SurePay link carries in its r parameter', async () => {
    const packed = await pack('{"receipt":"ZN_fde6cc55","amount":50}')

    await expect(
      decodeCodePayload(`https://d.surepay.sa/r?r=${encodeURIComponent(packed)}`),
    ).resolves.toContain('ZN_fde6cc55')
  })

  it('unpacks a bare payload that is not wrapped in a link', async () => {
    await expect(decodeCodePayload(await pack('hello'))).resolves.toBe('hello')
  })

  it('leaves a plain code alone', async () => {
    await expect(decodeCodePayload('ZN_fde6cc55')).resolves.toBeNull()
    await expect(decodeCodePayload('https://example.com/r?r=abc')).resolves.toBeNull()
  })

  it('does not fail on a payload that only looks packed', async () => {
    await expect(decodeCodePayload('H4sInot-really-base64')).resolves.toBeNull()
  })

  it('finds the row named inside the packed payload', async () => {
    const packed = await pack('{"order":"1054040706"}')
    const code = `https://d.surepay.sa/r?r=${encodeURIComponent(packed)}`
    const payload = await decodeCodePayload(code)

    expect(findByCode([code, payload].join('\n'), [tx()])).toHaveLength(1)
  })
})
