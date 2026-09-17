import { describe, expect, it } from 'vitest'
import { mergeWords, type Word } from './ocr'

/**
 * Coordinates taken from a real scanned mada receipt, so the gaps are the ones
 * the engine actually returns: 6–11px inside a label against 130–151px between
 * two columns of the table.
 */
const word = (text: string, x0: number, x1: number): Word => ({
  text,
  x0,
  x1,
  bottom: 676,
  height: 15,
})

describe('mergeWords', () => {
  it('rejoins a label the engine broke into words', () => {
    const runs = mergeWords([word('mada', 776, 839), word('HOST', 850, 913)])

    // `mada` alone reads as a scheme of its own; `mada HOST` is the subsection
    // it heads, which is what the parser must see.
    expect(runs.map((run) => run.text)).toEqual(['mada HOST'])
  })

  it('puts back a decimal point the scan lost', () => {
    const runs = mergeWords([word('3987', 1155, 1194), word('81', 1202, 1219)])

    expect(runs.map((run) => run.text)).toEqual(['3987.81'])
  })

  it('leaves a count and an amount in separate columns alone', () => {
    const runs = mergeWords([
      word('TOTAL', 773, 829),
      word('DB', 835, 857),
      word('16', 987, 1004),
      word('3987', 1155, 1194),
      word('81', 1202, 1219),
    ])

    expect(runs.map((run) => run.text)).toEqual(['TOTAL DB', '16', '3987.81'])
  })

  it('joins two close numbers with a space when the second is not a pair of digits', () => {
    // Only two digits after a small gap is a decimal point; anything else is
    // two things that happen to sit near each other.
    const runs = mergeWords([word('0.041', 947, 993), word('2501', 1004, 1042)])

    expect(runs.map((run) => run.text)).toEqual(['0.041 2501'])
  })
})
