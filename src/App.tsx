import { useState } from 'react'
import type { BuiltReport } from './core/pipeline'
import { getReport, recordIngestedFiles, ReportExistsError, saveReport } from './db/store'
import { EmployeesPanel } from './ui/EmployeesPanel'
import { LocationsPanel } from './ui/LocationsPanel'
import { TemplatePanel } from './ui/TemplatePanel'
import { UploadPanel } from './ui/UploadPanel'
import './App.css'

type SaveState =
  | { kind: 'idle' }
  | { kind: 'confirm-replace'; existingCreatedAt: string }
  | { kind: 'saved' }
  | { kind: 'error'; message: string }

export default function App() {
  const [report, setReport] = useState<BuiltReport | null>(null)
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })

  function onBuilt(built: BuiltReport) {
    setReport(built)
    setSave({ kind: 'idle' })
  }

  async function persist(overwrite: boolean) {
    if (report === null) return
    try {
      await saveReport(
        {
          id: report.reportId,
          periodKey: report.periodKey,
          createdAt: new Date().toISOString(),
          data: { locations: report.locations, employees: report.employees },
        },
        { overwrite },
      )
      await recordIngestedFiles(
        report.ingested.map((file) => ({
          ...file,
          ingestedAt: new Date().toISOString(),
          reportId: report.reportId,
        })),
      )
      setSave({ kind: 'saved' })
    } catch (cause) {
      if (cause instanceof ReportExistsError) {
        const existing = await getReport(cause.reportId)
        setSave({
          kind: 'confirm-replace',
          existingCreatedAt: existing?.createdAt ?? '',
        })
        return
      }
      setSave({ kind: 'error', message: (cause as Error).message })
    }
  }

  return (
    <div className="app">
      <header className="no-print">
        <h1>نظام تقارير المبيعات</h1>
      </header>

      <TemplatePanel />
      <UploadPanel onBuilt={onBuilt} />

      {report && (
        <>
          <section className="panel summary">
            <h2>التقرير {report.reportId}</h2>
            <p className="muted">
              الفترة {report.periodKey} — {report.locations.length} موقع،{' '}
              {report.records.length} صف مقروء.
            </p>

            <div className="actions no-print">
              {save.kind === 'confirm-replace' ? (
                <>
                  <p className="warn">
                    يوجد تقرير محفوظ بالمعرّف {report.reportId}
                    {save.existingCreatedAt && ` (حُفظ في ${save.existingCreatedAt.slice(0, 10)})`}.
                    الاستبدال نهائي ولا يمكن التراجع عنه.
                  </p>
                  <button type="button" onClick={() => persist(true)}>
                    تأكيد الاستبدال
                  </button>
                  <button type="button" className="link" onClick={() => setSave({ kind: 'idle' })}>
                    إلغاء
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => persist(false)}>
                  حفظ التقرير
                </button>
              )}

              {save.kind === 'saved' && <p className="ok">تم حفظ التقرير.</p>}
              {save.kind === 'error' && <p className="error">{save.message}</p>}
            </div>
          </section>

          <LocationsPanel locations={report.locations} />
          <EmployeesPanel employees={report.employees} reportId={report.reportId} />
        </>
      )}
    </div>
  )
}
