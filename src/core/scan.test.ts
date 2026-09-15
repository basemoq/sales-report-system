import { describe, expect, it } from 'vitest'
import {
  decodeCodePayload,
  findByCode,
  findByMoment,
  parseReceiptPayload,
  timeToMinutes,
} from './scan'
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

describe('parseReceiptPayload', () => {
  /** The real payload, unpacked from a receipt scanned on 14 Sep. */
  const REAL = '2332054800406708^20260914235001'

  it('reads the reference and the moment out of a receipt payload', () => {
    expect(parseReceiptPayload(REAL)).toEqual({
      reference: '2332054800406708',
      day: '2026-09-14',
      minutes: 23 * 60 + 50,
    })
  })

  it('reads them whichever way round the receipt prints them', () => {
    expect(parseReceiptPayload('20260914235001^2332054800406708')).toEqual(
      parseReceiptPayload(REAL),
    )
  })

  it('still gives the reference when there is no timestamp', () => {
    expect(parseReceiptPayload('2332054800406708')).toEqual({
      reference: '2332054800406708',
      day: null,
      minutes: null,
    })
  })

  it('gives nothing for a payload of another shape', () => {
    expect(parseReceiptPayload('hello there')).toEqual({
      reference: null,
      day: null,
      minutes: null,
    })
  })
})

describe('timeToMinutes', () => {
  it('reads the clock the export prints', () => {
    expect(timeToMinutes('5:38 PM')).toBe(17 * 60 + 38)
    expect(timeToMinutes('12:05 AM')).toBe(5)
    expect(timeToMinutes('12:05 PM')).toBe(12 * 60 + 5)
    expect(timeToMinutes('23:50')).toBe(23 * 60 + 50)
    expect(timeToMinutes('11:50:01 PM')).toBe(23 * 60 + 50)
  })

  it('gives nothing for a missing or unreadable time', () => {
    expect(timeToMinutes(null)).toBeNull()
    expect(timeToMinutes('later')).toBeNull()
  })
})

describe('findByMoment', () => {
  const day = new Date(Date.UTC(2026, 8, 14))
  const code = parseReceiptPayload('2332054800406708^20260914235001')

  it('finds the sale rung up at the moment the code stamps', () => {
    const wanted = tx({ date: day, time: '11:50 PM' })

    expect(findByMoment(code, [tx({ date: day, time: '5:38 PM' }), wanted])).toEqual([wanted])
  })

  it('allows the minute or two between the sale and the card receipt', () => {
    expect(findByMoment(code, [tx({ date: day, time: '11:52 PM' })])).toHaveLength(1)
    expect(findByMoment(code, [tx({ date: day, time: '11:56 PM' })])).toEqual([])
  })

  it('does not reach into another day at the same clock time', () => {
    expect(findByMoment(code, [tx({ date: new Date(Date.UTC(2026, 8, 13)), time: '11:50 PM' })]))
      .toEqual([])
  })

  it('gives nothing when the code carries no moment', () => {
    expect(findByMoment(parseReceiptPayload('123456'), [tx({ date: day, time: '11:50 PM' })]))
      .toEqual([])
  })
})
