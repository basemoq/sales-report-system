import { describe, expect, it } from 'vitest'
import { groupByMonthAndWeek } from './savedGroups'

const group = (days: (string | null)[]) => groupByMonthAndWeek(days, (day) => day)

describe('groupByMonthAndWeek', () => {
  it('files days under their month, newest month first, with its Arabic name', () => {
    const { months } = group(['2026-11-15', '2026-10-31', '2026-11-02'])
    expect(months.map((month) => [month.label, month.count])).toEqual([
      ['نوفمبر 2026', 2],
      ['أكتوبر 2026', 1],
    ])
  })

  it('splits a month into weeks of seven days, newest week first', () => {
    const { months } = group(['2026-11-15', '2026-11-12', '2026-11-10', '2026-11-01'])
    expect(months[0].weeks.map((week) => [week.week, week.from, week.to, week.items])).toEqual([
      [3, 15, 21, ['2026-11-15']],
      [2, 8, 14, ['2026-11-12', '2026-11-10']],
      [1, 1, 7, ['2026-11-01']],
    ])
  })

  it('keeps days 29 onwards as a fifth week ending with the month', () => {
    expect(group(['2026-11-30']).months[0].weeks[0]).toMatchObject({ week: 5, from: 29, to: 30 })
    expect(group(['2026-10-31']).months[0].weeks[0]).toMatchObject({ week: 5, from: 29, to: 31 })
  })

  it('sets aside what has no readable day rather than dropping it', () => {
    const { months, undated } = group(['WFW430|x', null, '2026-11-15'])
    expect(months).toHaveLength(1)
    expect(undated).toEqual(['WFW430|x', null])
  })
})
