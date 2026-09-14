import { useState } from 'react'
import { checkTemplateShop, fillDailyTemplate } from './core/dailyReport'
import type { DailyReportBuild } from './core/pipeline'
import {
  getReport,
  getTemplate,
  recordIngestedFiles,
  ReportExistsError,
  saveReport,
} from './db/store'
import { EmployeesPanel } from './ui/EmployeesPanel'
import { FiguresPanel } from './ui/FiguresPanel'
import { TemplatePanel } from './ui/TemplatePanel'
import { UploadPanel } from './ui/UploadPanel'
import './App.css'

type SaveState =
  | { kind: 'idle' }
  | { kind: 'confirm-replace'; existingCreatedAt: string }
  | { kind: 'saved' }
  | { kind: 'error'; message: string }

type FillState =
  | { kind: 'idle' }
  | { kind: 'done'; written: number; warnings: string[] }
  | { kind: 'error'; message: string }

function download(bytes: ArrayBuffer, fileName: string) {
  const url = URL.createObjectURL(
    new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  // The download attribute is honoured only for an anchor in the document, and
  // the object URL must outlive the click that starts the transfer.
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export default function App() {
  const [report, setReport] = useState<DailyReportBuild | null>(null)
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const [fill, setFill] = useState<FillState>({ kind: 'idle' })

  function onBuilt(built: DailyReportBuild) {
    setReport(built)
    setSave({ kind: 'idle' })
    setFill({ kind: 'idle' })
  }

  async function persist(overwrite: boolean) {
    if (report === null) return
    try {
      await saveReport(
        {
          id: report.reportId,
          periodKey: report.periodKey,
          createdAt: new Date().toISOString(),
          data: { figures: report.figures, employees: report.employees },
        },
        { overwrite },
      )
      await recordIngestedFiles(
        report.sources.map((source) => ({
          hash: source.hash,
          fileName: source.fileName,
          ingestedAt: new Date().toISOString(),
          reportId: report.reportId,
        })),
      )
      setSave({ kind: 'saved' })
    } catch (cause) {
      if (cause instanceof ReportExistsError) {
        const existing = await getReport(cause.reportId)
        setSave({ kind: 'confirm-replace', existingCreatedAt: existing?.createdAt ?? '' })
        return
      }
      setSave({ kind: 'error', message: (cause as Error).message })
    }
  }

  async function fillTemplate() {
    if (report === null) return
    try {
      const template = await getTemplate('default')
      if (template === undefined) {
        setFill({
          kind: 'error',
          message: 'لا يوجد قالب محفوظ. ارفع القالب أولًا من قسم «القالب».',
        })
        return
      }

      const warnings: string[] = []
      if (report.shopId !== null) {
        const check = await checkTemplateShop(template.bytes, report.shopId)
        if (!check.ok) {
          warnings.push(
            `القالب يخص الفرع «${check.templateShop}» بينما الملفات تخص «${report.shopId}».`,
          )
        }
      }

      const result = await fillDailyTemplate(template.bytes, report.figures)
      // ASCII: a non-Latin download name is dropped by some browsers and by
      // Windows shares, leaving an extension-less "download" the user cannot open.
      download(result.bytes, `daily-sales-${report.shopId ?? 'report'}-${report.reportId}.xlsx`)
      setFill({
        kind: 'done',
        written: result.written.length,
        warnings: [...warnings, ...result.warnings],
      })
    } catch (cause) {
      setFill({ kind: 'error', message: (cause as Error).message })
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
          <FiguresPanel figures={report.figures} reportId={report.reportId} />

          <section className="panel no-print">
            <h2>الإخراج</h2>
            <div className="actions">
              <button type="button" onClick={fillTemplate}>
                تعبئة القالب وتنزيله
              </button>

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

              {fill.kind === 'done' && (
                <>
                  <p className="ok">تم تنزيل القالب بعد تعبئة {fill.written} خانة.</p>
                  {fill.warnings.map((warning) => (
                    <p key={warning} className="warn">
                      {warning}
                    </p>
                  ))}
                </>
              )}
              {fill.kind === 'error' && <p className="error">{fill.message}</p>}
            </div>
          </section>

          <EmployeesPanel employees={report.employees} reportId={report.reportId} />
        </>
      )}
    </div>
  )
}
