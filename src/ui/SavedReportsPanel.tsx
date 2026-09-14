import { useCallback, useEffect, useState } from 'react'
import { getActiveTemplate } from '../core/activeTemplate'
import { fillDailyTemplate } from '../core/dailyReport'
import { reviveSavedReport } from '../core/savedReport'
import { deleteReport, listReports, type StoredReport } from '../db/store'
import { formatMoney } from './format'

interface Props {
  /** Bumped by the parent after a save, so the list refreshes. */
  refreshToken: number
  onDownload: (bytes: ArrayBuffer, fileName: string) => void
}

export function SavedReportsPanel({ refreshToken, onDownload }: Props) {
  const [reports, setReports] = useState<StoredReport[]>([])
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const stored = await listReports()
    setReports(stored.sort((a, b) => b.id.localeCompare(a.id)))
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

      const template = await getActiveTemplate()
      const result = await fillDailyTemplate(template.bytes, saved.figures, {
        ...saved.identity,
        shopId: saved.shopId,
      })
      onDownload(result.bytes, `daily-sales-${saved.shopId ?? 'report'}-${report.id}.xlsx`)
    } catch (cause) {
      setError((cause as Error).message)
    }
  }

  async function remove(id: string) {
    await deleteReport(id)
    setConfirming(null)
    await refresh()
  }

  if (reports.length === 0) {
    return (
      <section className="panel no-print">
        <h2>التقارير المحفوظة</h2>
        <p className="muted">لا توجد تقارير محفوظة بعد.</p>
        {error && <p className="error">{error}</p>}
      </section>
    )
  }

  return (
    <section className="panel no-print">
      <h2>التقارير المحفوظة</h2>
      {error && <p className="error">{error}</p>}

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>اليوم</th>
              <th>المعرض</th>
              <th>إجمالى المبيعات</th>
              <th>حُفظ في</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {reports.map((report) => {
              const saved = reviveSavedReport(report.data)
              return (
                <tr key={report.id}>
                  <td>{report.id}</td>
                  <td>{saved?.identity.showroom || '—'}</td>
                  <td className="num">
                    {saved ? formatMoney(saved.figures.totalSales) : '—'}
                  </td>
                  <td>{report.createdAt.slice(0, 10)}</td>
                  <td>
                    <div className="row-actions">
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
  )
}
