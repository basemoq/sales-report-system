import type { TabsReport } from './sources/tabs'

/**
 * A TABS export carries the warehouse it was pulled for (`Warehouse:` on the
 * detail pages). When the CACO exports name a different shop, the TABS file
 * belongs to another branch — usually the operator's TABS user pulled the
 * wrong warehouse — and its money is not this shop's. It is left out of the
 * figures and the operator is told why, instead of being added in silently.
 *
 * Nothing is decided when either side is missing: a TABS file with no
 * warehouse, or a day with no CACO export, has nothing to compare against.
 */
export interface TabsShopCheck {
  /** The TABS figures may be counted for this shop. */
  ok: boolean
  /** Why they were not, in the operator's language. */
  error?: string
}

const norm = (code: string | null | undefined): string =>
  (code ?? '').trim().toUpperCase()

export function checkTabsShop(
  tabs: Pick<TabsReport, 'warehouse'> | undefined,
  shopId: string | null | undefined,
): TabsShopCheck {
  const warehouse = norm(tabs?.warehouse)
  const shop = norm(shopId)
  if (tabs === undefined || warehouse === '' || shop === '' || warehouse === shop) return { ok: true }
  return {
    ok: false,
    error:
      `خطأ في ملف TABS: المستودع (Warehouse) فيه ${warehouse}، والتقرير لفرع ${shop} حسب CACO. ` +
      `اليوزر غير مطابق لمستودع الفرع، فلم تُحسب أرقام TABS في التقرير. ` +
      `اسحب تقرير TABS على مستودع ${shop} وارفعه من جديد.`,
  }
}
