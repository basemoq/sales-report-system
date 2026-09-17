import { describe, expect, it } from 'vitest'
import { stripsOf } from './image'

/**
 * A column profile as `inkProfile` produces one: true where that column of the
 * photograph carries dark pixels. The canvas work around it is browser-only,
 * but every decision about where to cut is made here.
 */
const profile = (width: number, ink: [number, number][]): boolean[] =>
  Array.from({ length: width }, (_, x) => ink.some(([from, to]) => x >= from && x < to))

describe('stripsOf', () => {
  it('finds one strip per piece of paper', () => {
    const strips = stripsOf(
      profile(800, [
        [60, 300],
        [500, 740],
      ]),
    )

    expect(strips).toEqual([
      { start: 60, end: 300 },
      { start: 500, end: 740 },
    ])
  })

  it('closes up the gap between two columns of one receipt', () => {
    // A receipt's labels and its amounts are further apart than two words, and
    // cutting between them would separate every figure from the row it is on.
    expect(
      stripsOf(
        profile(800, [
          [200, 340],
          [360, 600],
        ]),
      ),
    ).toEqual([{ start: 200, end: 600 }])
  })

  it('drops what is too narrow to be a receipt', () => {
    // The desk, a cable, the edge of the page underneath. One word off the
    // paper used to be taken for the page margin, and then no section head
    // stood at it: every figure came back zero.
    expect(
      stripsOf(
        profile(800, [
          [10, 24],
          [200, 600],
        ]),
      ),
    ).toEqual([{ start: 200, end: 600 }])
  })

  it('finds nothing in a photograph with no paper in it', () => {
    expect(stripsOf(profile(800, []))).toEqual([])
  })
})
