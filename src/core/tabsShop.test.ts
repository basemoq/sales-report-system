import { describe, expect, it } from 'vitest'
import { checkTabsShop } from './tabsShop'

describe('checkTabsShop', () => {
  it('lets a TABS file through when its warehouse is the shop', () => {
    expect(checkTabsShop({ warehouse: 'WFW430' }, 'WFW430')).toEqual({ ok: true })
  })

  it('ignores case and stray spaces', () => {
    expect(checkTabsShop({ warehouse: ' wfw430 ' }, 'WFW430').ok).toBe(true)
  })

  it('refuses a TABS file pulled for another warehouse, and says which', () => {
    const check = checkTabsShop({ warehouse: 'WFW499' }, 'WFW430')
    expect(check.ok).toBe(false)
    expect(check.error).toContain('WFW499')
    expect(check.error).toContain('WFW430')
    expect(check.error).toContain('لم تُحسب')
  })

  it('decides nothing when there is nothing to compare', () => {
    expect(checkTabsShop(undefined, 'WFW430').ok).toBe(true)
    expect(checkTabsShop({ warehouse: null }, 'WFW430').ok).toBe(true)
    expect(checkTabsShop({ warehouse: 'WFW499' }, null).ok).toBe(true)
  })
})
