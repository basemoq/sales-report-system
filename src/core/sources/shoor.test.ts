import { describe, expect, it } from 'vitest'
import type { CellValue } from '../workbook'
import {
  ingestShoorFiles,
  LocationConflictError,
  MissingLocationError,
  readLocationIdentity,
  resolveLocations,
  summarizeDays,
  type ShoorFile,
} from './shoor'

/** A shoor export: an identity banner, then the daily table. */
function shoorFile(
  fileName: string,
  identity: { shopId?: string; location?: string },
  rows: CellValue[][] = [
    ['2025-03-01', 1000, 'أحمد', 5],
    ['2025-03-02', 1500, 'أحمد', 7],
  ],
): ShoorFile {
  const banner: CellValue[][] = []
  if (identity.shopId !== undefined) banner.push(['Shop ID:', identity.shopId])
  if (identity.location !== undefined) banner.push(['الموقع:', identity.location])
  banner.push([null, null])

  return {
    fileName,
    sheets: [
      {
        name: 'Sheet1',
        rows: [...banner, ['التاريخ', 'المبلغ', 'الموظف', 'عدد العمليات'], ...rows],
      },
    ],
  }
}

describe('readLocationIdentity', () => {
  it('reads the shop id and location from the banner', () => {
    const identity = readLocationIdentity(shoorFile('a.xlsx', { shopId: '101', location: 'الرياض' }))
    expect(identity).toEqual({ shopId: '101', locationName: 'الرياض' })
  })

  it('reads a label written without a colon', () => {
    const file: ShoorFile = {
      fileName: 'a.xlsx',
      sheets: [
        {
          name: 'S',
          rows: [
            ['رقم الفرع', '101'],
            ['اسم الموقع', 'جدة'],
            ['التاريخ', 'المبلغ'],
            ['2025-03-01', 10],
          ],
        },
      ],
    }
    expect(readLocationIdentity(file)).toEqual({ shopId: '101', locationName: 'جدة' })
  })

  it('reads a value placed before the label, as RTL sheets lay it out', () => {
    const file: ShoorFile = {
      fileName: 'a.xlsx',
      sheets: [
        {
          name: 'S',
          rows: [
            ['101', 'Shop ID:'],
            ['الدمام', 'الموقع:'],
            ['التاريخ', 'المبلغ'],
          ],
        },
      ],
    }
    expect(readLocationIdentity(file)).toEqual({ shopId: '101', locationName: 'الدمام' })
  })

  it('refuses a file that does not say which shop it covers', () => {
    expect(() => readLocationIdentity(shoorFile('a.xlsx', { location: 'الرياض' }))).toThrow(
      MissingLocationError,
    )
  })

  it('refuses a file with a shop id but no location name', () => {
    expect(() => readLocationIdentity(shoorFile('a.xlsx', { shopId: '101' }))).toThrow(
      /اسم الموقع/,
    )
  })
})

describe('resolveLocations', () => {
  const entry = (fileName: string, shopId: string, locationName: string) => ({
    fileName,
    identity: { shopId, locationName },
  })

  it('maps each shop id to its name', () => {
    const map = resolveLocations([
      entry('a.xlsx', '101', 'الرياض'),
      entry('b.xlsx', '102', 'جدة'),
    ])
    expect(map).toEqual(
      new Map([
        ['101', 'الرياض'],
        ['102', 'جدة'],
      ]),
    )
  })

  it('accepts the same shop repeated across files', () => {
    const map = resolveLocations([
      entry('mar.xlsx', '101', 'الرياض'),
      entry('apr.xlsx', '101', 'الرياض'),
    ])
    expect(map).toEqual(new Map([['101', 'الرياض']]))
  })

  it('treats a spelling variant of the same name as the same location', () => {
    expect(() =>
      resolveLocations([entry('a.xlsx', '101', 'فرع الرياض'), entry('b.xlsx', '101', 'فرع  الريـاض')]),
    ).not.toThrow()
  })

  it('halts when one shop id carries two different names', () => {
    expect(() =>
      resolveLocations([entry('a.xlsx', '101', 'الرياض'), entry('b.xlsx', '101', 'جدة')]),
    ).toThrow(LocationConflictError)
  })

  it('halts when one location name is claimed by two shop ids', () => {
    expect(() =>
      resolveLocations([entry('a.xlsx', '101', 'الرياض'), entry('b.xlsx', '202', 'الرياض')]),
    ).toThrow(LocationConflictError)
  })

  it('names both files and both values in the conflict message', () => {
    try {
      resolveLocations([entry('march.xlsx', '101', 'الرياض'), entry('april.xlsx', '101', 'جدة')])
      expect.unreachable('expected a conflict')
    } catch (error) {
      const message = (error as LocationConflictError).message
      expect(message).toContain('march.xlsx')
      expect(message).toContain('april.xlsx')
      expect(message).toContain('الرياض')
      expect(message).toContain('جدة')
    }
  })
})

describe('summarizeDays', () => {
  it('totals each day and counts its transactions', () => {
    const days = summarizeDays([
      {
        date: new Date(Date.UTC(2025, 2, 1)),
        shopId: '101',
        locationName: 'الرياض',
        employee: null,
        amount: 100,
        transactions: 2,
        sourceFile: 'a',
      },
      {
        date: new Date(Date.UTC(2025, 2, 1)),
        shopId: '101',
        locationName: 'الرياض',
        employee: null,
        amount: 50,
        transactions: 1,
        sourceFile: 'a',
      },
    ])

    expect(days).toEqual([{ date: '2025-03-01', amount: 150, transactions: 3 }])
  })
})

describe('ingestShoorFiles', () => {
  it('produces a day-by-day summary per location', () => {
    const result = ingestShoorFiles([
      shoorFile('riyadh.xlsx', { shopId: '101', location: 'الرياض' }),
      shoorFile('jeddah.xlsx', { shopId: '102', location: 'جدة' }, [
        ['2025-03-01', 800, 'سالم', 4],
      ]),
    ])

    expect(result.locations).toHaveLength(2)
    const riyadh = result.locations.find((l) => l.shopId === '101')!
    expect(riyadh.total).toBe(2500)
    expect(riyadh.transactions).toBe(12)
    expect(riyadh.days).toEqual([
      { date: '2025-03-01', amount: 1000, transactions: 5 },
      { date: '2025-03-02', amount: 1500, transactions: 7 },
    ])
  })

  it('merges two files covering the same shop into one location', () => {
    const result = ingestShoorFiles([
      shoorFile('week1.xlsx', { shopId: '101', location: 'الرياض' }, [['2025-03-01', 100, 'أ', 1]]),
      shoorFile('week2.xlsx', { shopId: '101', location: 'الرياض' }, [['2025-03-08', 200, 'أ', 1]]),
    ])

    expect(result.locations).toHaveLength(1)
    expect(result.locations[0].total).toBe(300)
    expect(result.locations[0].days.map((d) => d.date)).toEqual(['2025-03-01', '2025-03-08'])
  })

  it('produces nothing at all when the batch has a location conflict', () => {
    expect(() =>
      ingestShoorFiles([
        shoorFile('a.xlsx', { shopId: '101', location: 'الرياض' }),
        shoorFile('b.xlsx', { shopId: '101', location: 'جدة' }),
      ]),
    ).toThrow(LocationConflictError)
  })

  it('skips a totals band that has an amount but no date, and reports it', () => {
    const result = ingestShoorFiles([
      shoorFile('a.xlsx', { shopId: '101', location: 'الرياض' }, [
        ['2025-03-01', 100, 'أ', 1],
        ['الإجمالي', 100, null, null],
      ]),
    ])

    expect(result.locations[0].total).toBe(100)
    expect(result.problems).toEqual([
      { fileName: 'a.xlsx', rowNumber: 6, reason: 'تاريخ غير صالح' },
    ])
  })

  it('reports a row whose amount cannot be read and keeps the rest', () => {
    const result = ingestShoorFiles([
      shoorFile('a.xlsx', { shopId: '101', location: 'الرياض' }, [
        ['2025-03-01', 100, 'أ', 1],
        ['2025-03-02', 'غير متاح', 'أ', 1],
      ]),
    ])

    expect(result.locations[0].total).toBe(100)
    expect(result.problems[0].reason).toBe('مبلغ غير صالح')
  })

  it('counts a row as one transaction when the source reports no count', () => {
    const file: ShoorFile = {
      fileName: 'a.xlsx',
      sheets: [
        {
          name: 'S',
          rows: [
            ['Shop ID:', '101'],
            ['الموقع:', 'الرياض'],
            ['التاريخ', 'المبلغ'],
            ['2025-03-01', 100],
            ['2025-03-01', 200],
          ],
        },
      ],
    }
    expect(ingestShoorFiles([file]).locations[0].days).toEqual([
      { date: '2025-03-01', amount: 300, transactions: 2 },
    ])
  })

  it('records which file each row came from', () => {
    const result = ingestShoorFiles([
      shoorFile('riyadh.xlsx', { shopId: '101', location: 'الرياض' }, [['2025-03-01', 100, 'أ', 1]]),
    ])
    expect(result.records[0].sourceFile).toBe('riyadh.xlsx')
  })
})
