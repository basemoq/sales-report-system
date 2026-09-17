import { useState } from 'react'
import {
  fillDailyTemplate,
  reassignVisaToMastercard,
  type ReportIdentity,
} from './core/dailyReport'
import type { DailyReportBuild } from './core/pipeline'
import { getTemplateBytes } from './core/activeTemplate'
import type { SavedReportData } from './core/savedReport'
import {
  getReport,
  recordIngestedFiles,
  ReportExistsError,
  saveReport,
} from './db/store'
import { EmployeesPanel } from './ui/EmployeesPanel'
import { FiguresPanel } from './ui/FiguresPanel'
import { IdentityPanel } from './ui/IdentityPanel'
import { SavedReportsPanel } from './ui/SavedReportsPanel'
import { ScanPanel } from './ui/ScanPanel'
import { Icon } from './ui/Icon'
import { UploadPanel } from './ui/UploadPanel'
import { reportFileName } from './ui/format'
import './App.css'

/** Names offered in the header pickers; anything else is typed under «أخرى». */
const SHOWROOMS = ['الشرائع']
const SUPERVISORS = ['باسم العولقي']

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
  const [visaIsMastercard, setVisaIsMastercard] = useState(false)
  const [identity, setIdentity] = useState<ReportIdentity>({ showroom: '', supervisor: '' })
  const [savedCount, setSavedCount] = useState(0)

  function onBuilt(built: DailyReportBuild) {
    setReport(built)
    setSave({ kind: 'idle' })
    setFill({ kind: 'idle' })
    setVisaIsMastercard(false)
  }

  // Everything downstream — the displayed figures, the saved report and the
  // filled template — reads the same corrected figures.
  const figures =
    report === null
      ? null
      : visaIsMastercard
        ? reassignVisaToMastercard(report.figures)
        : report.figures

  async function persist(overwrite: boolean) {
    if (report === null || figures === null) return
    try {
      await saveReport(
        {
          id: report.reportId,
          periodKey: report.periodKey,
          createdAt: new Date().toISOString(),
          data: {
            figures,
            employees: report.employees,
            identity,
            shopId: report.shopId,
            reportDate: report.reportDate,
          } satisfies SavedReportData,
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
      setSavedCount((count) => count + 1)
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
    if (report === null || figures === null) return
    try {
      const result = await fillDailyTemplate(await getTemplateBytes(), figures, {
        ...identity,
        shopId: report.shopId,
      })
      download(result.bytes, reportFileName(report.reportDate))
      setFill({
        kind: 'done',
        written: result.written.length,
        warnings: result.warnings,
      })
    } catch (cause) {
      setFill({ kind: 'error', message: (cause as Error).message })
    }
  }

  return (
    <div className="app">
      <header className="masthead no-print">
        <Icon name="report" />
        <div>
          <h1>نظام تقارير المبيعات</h1>
          <p className="tagline">تقرير مبيعات المعارض اليومي</p>
        </div>
      </header>

      <IdentityPanel
        identity={identity}
        onChange={setIdentity}
        showrooms={SHOWROOMS}
        supervisors={SUPERVISORS}
      />
      <UploadPanel onBuilt={onBuilt} />
      <ScanPanel transactions={report?.transactions ?? []} />

      {report && figures && (
        <>
          <FiguresPanel
            figures={figures}
            reportDate={report.reportDate}
            refundDeducted={report.refundDeducted}
            supersededExcluded={report.supersededExcluded}
            visaMayBeMastercard={report.visaMayBeMastercard}
            treatVisaAsMastercard={visaIsMastercard}
            onTreatVisaAsMastercard={setVisaIsMastercard}
          />

          <section className="panel no-print">
            <h2>
              <Icon name="download" />
              الإخراج
            </h2>
            <div className="actions">
              <button type="button" onClick={fillTemplate}>
                تعبئة القالب وتنزيله
              </button>

              {save.kind === 'confirm-replace' ? (
                <>
                  <div className="note warn">
                    <Icon name="warning" />
                    <p>
                      يوجد تقرير محفوظ لهذا المعرض بتاريخ {report.reportDate}
                      {save.existingCreatedAt &&
                        ` (حُفظ في ${save.existingCreatedAt.slice(0, 10)})`}
                      . الاستبدال نهائي ولا يمكن التراجع عنه.
                    </p>
                  </div>
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

              {save.kind === 'saved' && (
                <div className="note ok">
                  <Icon name="success" />
                  <p>تم حفظ التقرير.</p>
                </div>
              )}
              {save.kind === 'error' && (
                <div className="note error">
                  <Icon name="error" />
                  <p>{save.message}</p>
                </div>
              )}

              {fill.kind === 'done' && (
                <>
                  <div className="note ok">
                    <Icon name="success" />
                    <p>تم تنزيل القالب بعد تعبئة {fill.written} خانة.</p>
                  </div>
                  {fill.warnings.map((warning) => (
                    <div key={warning} className="note warn">
                      <Icon name="warning" />
                      <p>{warning}</p>
                    </div>
                  ))}
                </>
              )}
              {fill.kind === 'error' && (
                <div className="note error">
                  <Icon name="error" />
                  <p>{fill.message}</p>
                </div>
              )}
            </div>
          </section>

          <EmployeesPanel employees={report.employees} reportDate={report.reportDate} />
        </>
      )}

      <SavedReportsPanel refreshToken={savedCount} onDownload={download} />

      {/* Kept out of .no-print so it carries onto the employee report PDF. */}
      <footer className="credit">© 2026 basem.alawalgy — جميع الحقوق محفوظة</footer>
    </div>
  )
}
