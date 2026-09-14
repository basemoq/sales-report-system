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

  it('adds both Visa sections into the one Visa column', () => {
    const report = parseMadaReconciliation([
      ...head(),
      ...scheme(900, 'visa', 3, '590.59'),
      ...scheme(500, 'VISA', 1, '100.00'),
    ])

    expect(report.cards.visa).toBeCloseTo(690.59, 2)
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

  it('refuses a PDF that is not a reconciliation receipt', () => {
    expect(() => parseMadaReconciliation([at(700, 'Consolidated Report')])).toThrow(
      MadaFormatError,
    )
  })
})
