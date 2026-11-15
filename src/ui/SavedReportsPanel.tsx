import { useCallback, useEffect, useState } from 'react'
import { getTemplateBytes } from '../core/activeTemplate'
import { fillDailyTemplate } from '../core/dailyReport'
import { reviveSavedReport } from '../core/savedReport'
import { groupByMonthAndWeek } from '../core/savedGroups'
import { Collapsible } from './Collapsible'
import { deleteReport, listReports, type StoredReport } from '../db/store'
import { formatMoney, reportFileName } from './format'
import { Icon } from './Icon'

interface Props {
  /** Bumped by the parent after a save, so the list refreshes. */
  refreshToken: number
  onDownload: (bytes: ArrayBuffer, fileName: string) => void
  /**
   * The report opened for viewing. The parent shows it at the page's own width,
   * outside this folded list, where it reads like the day's own report.
   */
  viewing: string | null
  onView: (report: StoredReport | null) => void
}

export function SavedReportsPanel({ refreshToken, onDownload, viewing, onView }: Props) {
  const [reports, setReports] = useState<StoredReport[]>([])
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const stored = await listReports()
    // Newest day first; the id now leads with the shop, so it cannot order this.
    const dayOf = (report: StoredReport) => reviveSavedReport(report.data)?.reportDate ?? report.id
    setReports(
      stored.sort((a, b) => dayOf(b).localeCompare(dayOf(a)) || a.id.localeCompare(b.id)),
    )
  }, [])

  useEffect(() => {
    refresh().catch((cause: Error) => setError(cause.message))
  }, [refresh, refreshToken])

  async function redownload(report: StoredReport) {
    setError(null)
    try {
      const saved = reviveSavedReport(report.data)
      if (saved === null) {
        setError(`التقرير ${report.id} محفوظ بصيغة قديمة لا يمكن إعادة تعبئتها.`)
        return
      }

      const result = await fillDailyTemplate(await getTemplateBytes(), saved.figures, {
        ...saved.identity,
        shopId: saved.shopId,
      })
      onDownload(result.bytes, reportFileName(saved.reportDate))
    } catch (cause) {
      setError((cause as Error).message)
    }
  }

  async function remove(id: string) {
    await deleteReport(id)
    setConfirming(null)
    if (viewing === id) onView(null)
    await refresh()
  }

  function view(report: StoredReport) {
    const opening = viewing !== report.id
    onView(opening ? report : null)
    if (opening) {
      requestAnimationFrame(() =>
        document
          .getElementById('saved-report-view')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      )
    }
  }

  const { months, undated } = groupByMonthAndWeek(
    reports,
    (report) => reviveSavedReport(report.data)?.reportDate,
  )
  const isViewed = (report: StoredReport) => report.id === viewing

  /*
   * One compact card per report, not a table row: on a phone the table ran off
   * the side, and «عرض» and «حذف» sat past the scroll. Day and branch, the two
   * figures, then the actions — all inside the screen's width. The showroom
   * name is left out: it is the same on every row of a branch's own list.
   */
  const rows = (list: readonly StoredReport[]) => (
    <ul className="saved-list" data-saved-week>
      {list.map((report) => {
        const saved = reviveSavedReport(report.data)
        return (
          <li key={report.id} className={viewing === report.id ? 'saved-item is-viewed' : 'saved-item'}>
            <div className="saved-head">
              <strong>{saved?.reportDate || report.id}</strong>
              <span className="muted">{saved?.shopId || '—'}</span>
            </div>
            <dl className="saved-figures">
              <div>
                <dt>إجمالى المبيعات</dt>
                <dd className="num">{saved ? formatMoney(saved.figures.totalSales) : '—'}</dd>
              </div>
              <div>
                <dt>الإيداع النقدي</dt>
                {/* Reports saved before the deposit was kept show a dash, not a zero. */}
                <dd className="num">
                  {typeof saved?.figures.cashDeposit === 'number'
                    ? formatMoney(saved.figures.cashDeposit)
                    : '—'}
                </dd>
              </div>
            </dl>
            <div className="row-actions saved-actions">
              {saved && (
                <button
                  type="button"
                  className="link"
                  onClick={() => view(report)}
                  aria-expanded={viewing === report.id}
                  data-saved-view={report.id}
                >
                  {viewing === report.id ? 'إخفاء' : 'عرض'}
                </button>
              )}
              <button type="button" className="link" onClick={() => redownload(report)}>
                تنزيل القالب
              </button>
              {confirming === report.id ? (
                <>
                  <button type="button" className="link danger" onClick={() => remove(report.id)}>
                    تأكيد الحذف
                  </button>
                  <button type="button" className="link" onClick={() => setConfirming(null)}>
                    إلغاء
                  </button>
                </>
              ) : (
                <button type="button" className="link" onClick={() => setConfirming(report.id)}>
                  حذف
                </button>
              )}
              <span className="muted saved-at">حُفظ {report.createdAt.slice(0, 10)}</span>
            </div>
          </li>
        )
      })}
    </ul>
  )

  if (reports.length === 0) {
    return (
      <section className="panel no-print">
        <h2>
          <Icon name="archive" />
          التقارير المحفوظة
        </h2>
        <div className="empty">
          <Icon name="document" />
          <p>لا توجد تقارير محفوظة بعد.</p>
        </div>
        {error && (
          <div className="note error">
            <Icon name="error" />
            <p>{error}</p>
          </div>
        )}
      </section>
    )
  }

  return (
    <section className="panel no-print">
      <h2>
        <Icon name="archive" />
        التقارير المحفوظة
      </h2>
      {error && (
        <div className="note error">
          <Icon name="error" />
          <p>{error}</p>
        </div>
      )}

      {/*
        * By month, then by week of the month: the newest month and its newest
        * week open, the rest folded — and whatever holds the report being
        * viewed stays open, so «إخفاء» is never hidden behind a fold.
        */}
      {months.map((month, monthIndex) => (
        <Collapsible
          key={month.key}
          title={month.label}
          icon="archive"
          count={month.count}
          open={monthIndex === 0 || month.weeks.some((week) => week.items.some(isViewed))}
        >
          {month.weeks.map((week, weekIndex) => (
            <Collapsible
              key={week.week}
              title={`الأسبوع ${week.week} · من ${week.from} إلى ${week.to}`}
              count={week.items.length}
              open={(monthIndex === 0 && weekIndex === 0) || week.items.some(isViewed)}
            >
              {rows(week.items)}
            </Collapsible>
          ))}
        </Collapsible>
      ))}
      {undated.length > 0 && (
        <Collapsible title="بلا تاريخ" count={undated.length}>
          {rows(undated)}
        </Collapsible>
      )}
      <p className="muted">
        حذف تقرير يسمح برفع ملفاته من جديد؛ بدون ذلك تُرفض كملفات سبق إدخالها.
      </p>
    </section>
  )
}
