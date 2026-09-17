import { describe, expect, it } from 'vitest'
import { toISODate } from '../dates'
import type { PdfTextItem } from '../pdf'
import { MadaFormatError, parseMadaReconciliation } from './mada'

const MARGIN = 183

const at = (y: number, text: string, x = MARGIN, page = 1): PdfTextItem => ({
  page,
  y,
  x,
  text,
})

/** The receipt head, which every reconciliation slip carries. */
const head = (): PdfTextItem[] => [
  at(711, 'WINDTEL Telecom', 215),
  at(686, '13/09/2026'),
  at(686, '23:50:01', 389),
  at(658, 'Reconciliation'),
  at(648, 'TotalsMatched'),
]

/** Each scheme prints its figure twice, for the host and for the terminal. */
function scheme(topY: number, name: string, count: number, amount: string): PdfTextItem[] {
  return [
    at(topY, name),
    at(topY - 10, 'mada Host'),
    at(topY - 100, 'TOTALS'),
    at(topY - 100, String(count), 308),
    at(topY - 100, amount, 386),
    at(topY - 120, 'POS TERMINAL'),
    at(topY - 200, 'TOTALS'),
    at(topY - 200, String(count), 308),
    at(topY - 200, amount, 386),
  ]
}

const emptyScheme = (topY: number, name: string): PdfTextItem[] => [
  at(topY, name),
  at(topY - 20, '<NO TRANSACTIONS>'),
]

describe('parseMadaReconciliation', () => {
  it('reads each scheme total once, not twice', () => {
    const report = parseMadaReconciliation([...head(), ...scheme(629, 'mada', 9, '1190.20')])

    expect(report.schemes).toEqual([{ scheme: 'mada', count: 9, amount: 1190.2 }])
    expect(report.cards.mada).toBeCloseTo(1190.2, 2)
  })

  it('maps mada, visa and mastercard onto the template columns', () => {
    const report = parseMadaReconciliation([
      ...head(),
      ...scheme(900, 'mada', 9, '1190.20'),
      ...scheme(600, 'visa', 3, '590.59'),
      ...scheme(300, 'MC', 2, '137.26'),
    ])

    expect(report.cards).toEqual({ mada: 1190.2, visa: 590.59, mastercard: 137.26 })
    expect(report.unmapped).toEqual([])
  })

  it('reads a scheme marked as having no transactions as zero', () => {
    const report = parseMadaReconciliation([
      ...head(),
      ...scheme(900, 'mada', 9, '1190.20'),
      ...emptyScheme(500, 'VISA'),
      ...emptyScheme(400, 'JB'),
    ])

    expect(report.schemes.map((s) => [s.scheme, s.amount])).toEqual([
      ['mada', 1190.2],
      ['VISA', 0],
      ['JB', 0],
    ])
    expect(report.cards.visa).toBe(0)
  })

  it('splits two settled Visa sections: the first is the MasterCard slot', () => {
    const report = parseMadaReconciliation([
      ...head(),
      ...scheme(900, 'visa', 3, '590.59'),
      ...scheme(500, 'VISA', 1, '100.00'),
    ])

    expect(report.cards.mastercard).toBeCloseTo(590.59, 2)
    expect(report.cards.visa).toBeCloseTo(100, 2)
  })

  it('adds a split first slot to a MasterCard section the receipt also printed', () => {
    const report = parseMadaReconciliation([
      ...head(),
      ...scheme(900, 'visa', 3, '590.59'),
      ...scheme(600, 'VISA', 1, '100.00'),
      ...scheme(300, 'MC', 1, '37.26'),
    ])

    expect(report.cards.mastercard).toBeCloseTo(627.85, 2)
    expect(report.cards.visa).toBeCloseTo(100, 2)
  })

  it('surfaces a scheme with money on it that no column covers', () => {
    const report = parseMadaReconciliation([
      ...head(),
      ...scheme(900, 'mada', 9, '1190.20'),
      ...scheme(500, 'AMEX', 1, '250.00'),
    ])

    expect(report.unmapped).toEqual([{ scheme: 'AMEX', count: 1, amount: 250 }])
  })

  it('does not surface an unmapped scheme that settled nothing', () => {
    const report = parseMadaReconciliation([...head(), ...emptyScheme(500, 'JB')])
    expect(report.unmapped).toEqual([])
  })

  it('does not treat the mada Host subsection heading as a scheme', () => {
    const report = parseMadaReconciliation([...head(), ...scheme(629, 'mada', 9, '1190.20')])
    expect(report.schemes).toHaveLength(1)
  })

  it('reads the terminal date', () => {
    const report = parseMadaReconciliation([...head(), ...scheme(629, 'mada', 9, '1190.20')])
    expect(toISODate(report.terminalDate!)).toBe('2026-09-13')
  })

  it('reports whether the receipt said its totals matched', () => {
    const matched = parseMadaReconciliation([...head(), ...scheme(629, 'mada', 1, '10.00')])
    expect(matched.totalsMatched).toBe(true)

    const unmatched = parseMadaReconciliation([
      ...head().filter((item) => item.text !== 'TotalsMatched'),
      ...scheme(629, 'mada', 1, '10.00'),
    ])
    expect(unmatched.totalsMatched).toBe(false)
  })

  describe('the terminal printing MasterCard under a visa heading', () => {
    it('flags money on the first visa section when the last one settled nothing', () => {
      const report = parseMadaReconciliation([
        ...head(),
        ...scheme(900, 'mada', 9, '1190.20'),
        ...scheme(600, 'visa', 3, '590.59'),
        ...emptyScheme(300, 'JB'),
        ...emptyScheme(250, 'VISA'),
      ])

      expect(report.visaMayBeMastercard).toBe(true)
      // The amount still lands in Visa; only a person can say it is MasterCard.
      expect(report.cards.visa).toBeCloseTo(590.59, 2)
      expect(report.cards.mastercard).toBe(0)
    })

    it('does not flag a receipt whose only visa section carries the money', () => {
      const report = parseMadaReconciliation([
        ...head(),
        ...scheme(900, 'mada', 9, '1190.20'),
        ...scheme(600, 'visa', 3, '590.59'),
      ])

      expect(report.visaMayBeMastercard).toBe(false)
    })

    it('does not flag a receipt where both visa sections carry money', () => {
      // Both settled, so the split is unambiguous and needs no decision.
      const report = parseMadaReconciliation([
        ...head(),
        ...scheme(900, 'visa', 3, '590.59'),
        ...scheme(500, 'VISA', 1, '100.00'),
      ])

      expect(report.visaMayBeMastercard).toBe(false)
      expect(report.cards).toEqual({ mada: 0, visa: 100, mastercard: 590.59 })
    })

    it('puts the money in Visa when only the last section settled', () => {
      const report = parseMadaReconciliation([
        ...head(),
        ...emptyScheme(900, 'visa'),
        ...scheme(500, 'VISA', 1, '100.00'),
      ])

      expect(report.visaMayBeMastercard).toBe(false)
      expect(report.cards.visa).toBe(100)
      expect(report.cards.mastercard).toBe(0)
    })

    it('does not flag a receipt with no visa money at all', () => {
      const report = parseMadaReconciliation([
        ...head(),
        ...scheme(900, 'mada', 9, '1190.20'),
        ...emptyScheme(500, 'visa'),
        ...emptyScheme(400, 'VISA'),
      ])

      expect(report.visaMayBeMastercard).toBe(false)
    })
  })

  it('refuses a PDF that is not a reconciliation receipt', () => {
    expect(() => parseMadaReconciliation([at(700, 'Consolidated Report')])).toThrow(
      MadaFormatError,
    )
  })
})

describe('a receipt read off a scan', () => {
  it('finds the section heads on a slip photographed at an angle', () => {
    // A slip laid on a counter tilts, and its left edge drifts down the page —
    // measured at 37 points on a real photo against a margin tolerance of six.
    const skew = (items: PdfTextItem[]): PdfTextItem[] =>
      items.map((item) => ({ ...item, x: item.x + (item.y - 300) * 0.02 }))

    const report = parseMadaReconciliation(
      skew([...head(), ...scheme(629, 'SPAN', 16, '3987.81')]),
    )

    expect(report.cards.mada).toBe(3987.81)
  })

  it('ignores a speck of the desk sitting further left than the receipt', () => {
    const report = parseMadaReconciliation([
      ...head(),
      ...scheme(629, 'SPAN', 16, '3987.81'),
      // One word off the paper used to be taken for the page margin, and then
      // no section head stood at it: every figure came back zero.
      at(500, '.', -60),
    ])

    expect(report.cards.mada).toBe(3987.81)
  })

  it('puts back a decimal point the scan dropped from a total', () => {
    const items = [
      ...head(),
      ...scheme(629, 'SPAN', 9, '124590'),
      at(560, 'TOTAL DB'),
      at(560, '9', 308),
      at(560, '1245.90', 386),
    ]

    const report = parseMadaReconciliation(items)
    // A hundred times the debit is not a second opinion on the amount; it is
    // the same figure with its point missing.
    expect(report.cards.mada).toBe(1245.9)
    expect(report.disagreements).toEqual([])
  })

  it('names a section whose heading was read but whose figure was not', () => {
    const report = parseMadaReconciliation([
      ...head(),
      ...scheme(900, 'SPAN', 9, '1245.90'),
      // The strip was cut off below the heading, or the print was too faint.
      at(400, 'VISA'),
    ])

    // Not the same as a section that settled nothing, and not reported as zero.
    expect(report.unread).toEqual(['VISA'])
    expect(report.cards.visa).toBe(0)
  })

  it('reads the receipt\'s verdict when the scan left only half of it', () => {
    const items = [...head(), ...scheme(629, 'SPAN', 9, '1245.90')].map((item) =>
      item.text === 'TotalsMatched' ? { ...item, text: 'MATCHED' } : item,
    )

    expect(parseMadaReconciliation(items).totalsMatched).toBe(true)
  })

  it('never reads a failed reconciliation as a passed one', () => {
    const items = [...head(), ...scheme(629, 'SPAN', 9, '1245.90')].map((item) =>
      item.text === 'TotalsMatched' ? { ...item, text: 'TOTALS NOT MATCHED' } : item,
    )

    expect(parseMadaReconciliation(items).totalsMatched).toBe(false)
  })


  it('reads the domestic section when it is headed SPAN rather than mada', () => {
    // الشبكة السعودية: the network's own name, printed instead of the brand,
    // with `mada HOST` as its subsection.
    const report = parseMadaReconciliation([...head(), ...scheme(629, 'SPAN', 16, '3987.81')])

    expect(report.cards.mada).toBe(3987.81)
  })

  it('reports the section whose two printings of one figure disagree', () => {
    // A misread digit: the debit line and the total line cannot differ when
    // nothing was credited back.
    const items = [
      ...head(),
      ...scheme(629, 'SPAN', 16, '3987.31'),
      // The debit line sits between the scheme head and its total.
      at(560, 'TOTAL DB'),
      at(560, '16', 308),
      at(560, '3987.81', 386),
    ]

    const report = parseMadaReconciliation(items)
    expect(report.disagreements).toEqual([
      { scheme: 'SPAN', totals: 3987.31, debit: 3987.81 },
    ])
  })
})
