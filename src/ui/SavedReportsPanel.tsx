import { useCallback, useEffect, useState } from 'react'
import { getTemplateBytes } from '../core/activeTemplate'
import { fillDailyTemplate } from '../core/dailyReport'
import { reviveSavedReport } from '../core/savedReport'
import { deleteReport, listReports, type StoredReport } from '../db/store'
import { EmployeesPanel } from './EmployeesPanel'
import { FiguresPanel } from './FiguresPanel'
import { formatMoney, reportFileName } from './format'
import { Icon } from './Icon'
import { SummaryStrip } from './SummaryStrip'

const noop = () => {}

interface Props {
  /** Bumped by the parent after a save, so the list refreshes. */
  refreshToken: number
  onDownload: (bytes: ArrayBuffer, fileName: string) => void
}

export function SavedReportsPanel({ refreshToken, onDownload }: Props) {
  const [reports, setReports] = useState<StoredReport[]>([])
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  /** The saved report opened below the list, as it was when it was saved. */
  const [viewing, setViewing] = useState<string | null>(null)

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
    if (viewing === id) setViewing(null)
    await refresh()
  }

  function view(id: string) {
    setViewing(viewing === id ? null : id)
    if (viewing !== id) {
      requestAnimationFrame(() =>
        document.getElementById('saved-report-view')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      )
    }
  }

  const opened = reports.find((report) => report.id === viewing)
  const shown = opened ? reviveSavedReport(opened.data) : null

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
    <>
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

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>اليوم</th>
                <th>المعرض</th>
                <th>الفرع</th>
                <th>إجمالى المبيعات</th>
                <th>الإيداع النقدي</th>
                <th>حُفظ في</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => {
                const saved = reviveSavedReport(report.data)
                return (
                  <tr key={report.id}>
                    <td>{saved?.reportDate || report.id}</td>
                    <td>{saved?.identity.showroom || '—'}</td>
                    <td>{saved?.shopId || '—'}</td>
                    <td className="num">
                      {saved ? formatMoney(saved.figures.totalSales) : '—'}
                    </td>
                    {/* Reports saved before the deposit was kept show a dash, not a zero. */}
                    <td className="num">
                      {typeof saved?.figures.cashDeposit === 'number'
                        ? formatMoney(saved.figures.cashDeposit)
                        : '—'}
                    </td>
                    <td>{report.createdAt.slice(0, 10)}</td>
                    <td>
                      <div className="row-actions">
                        {saved && (
                          <button
                            type="button"
                            className="link"
                            onClick={() => view(report.id)}
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
                          <button
                            type="button"
                            className="link"
                            onClick={() => setConfirming(report.id)}
                          >
                            حذف
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="muted">
          حذف تقرير يسمح برفع ملفاته من جديد؛ بدون ذلك تُرفض كملفات سبق إدخالها.
        </p>
      </section>

      {/*
        * The saved day opened again: its figures and its employees as they were
        * saved. Outside the list's panel, which never prints, so the employee
        * table can still be printed on its own.
        */}
      {shown && opened && (
        <div className="saved-view" id="saved-report-view">
          <div className="panel saved-view-head no-print">
            <h2>
              <Icon name="document" />
              تقرير محفوظ — {shown.reportDate}
              {shown.identity.showroom && <> · {shown.identity.showroom}</>}
              {shown.shopId && <> · {shown.shopId}</>}
            </h2>
            <p className="muted">
              كما حُفظ في {opened.createdAt.slice(0, 10)}
              {shown.identity.supervisor && <> · المشرف: {shown.identity.supervisor}</>}. للعرض فقط: صور
              الإيصالات وتعديل أرقام البطاقات في رفع الملفات من جديد.
            </p>
            <button type="button" onClick={() => setViewing(null)}>
              إغلاق العرض
            </button>
          </div>
          <SummaryStrip figures={shown.figures} />
          <FiguresPanel
            figures={shown.figures}
            reportDate={shown.reportDate}
            refundDeducted={0}
            supersededExcluded={0}
            visaMayBeMastercard={false}
            treatVisaAsMastercard={false}
            onTreatVisaAsMastercard={noop}
            enteredCards={{}}
            onEnterCard={noop}
            receiptImages={[]}
            readOnly
          />
          <EmployeesPanel
            employees={shown.employees}
            reportDate={shown.reportDate}
            id="saved-employee-report"
          />
        </div>
      )}
    </>
  )
}
