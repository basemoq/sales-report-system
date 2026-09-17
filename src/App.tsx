import { useState } from 'react'
import {
  applyManualCards,
  fillDailyTemplate,
  reassignVisaToMastercard,
  type ReportIdentity,
} from './core/dailyReport'
import type { CardTotals } from './core/sources/mada'
import { parseNumber } from './core/text'
import type { DailyReportBuild } from './core/pipeline'
import { getTemplateBytes } from './core/activeTemplate'
import type { SavedReportData } from './core/savedReport'
import {
  getReport,
  recordIngestedFiles,
  ReportExistsError,
  saveReport,
} from './db/store'
import { Collapsible } from './ui/Collapsible'
import { EmployeesPanel } from './ui/EmployeesPanel'
import { FiguresPanel } from './ui/FiguresPanel'
import { IdentityPanel } from './ui/IdentityPanel'
import { SavedReportsPanel } from './ui/SavedReportsPanel'
import { Stepper } from './ui/Stepper'
import { SummaryStrip } from './ui/SummaryStrip'
import { ScanPanel } from './ui/ScanPanel'
import { Icon } from './ui/Icon'
import { UploadPanel } from './ui/UploadPanel'
import { reportFileName } from './ui/format'
import './App.css'

/** Names offered in the header pickers; anything else is typed under «أخرى». */
const SHOWROOMS = ['الشرائع', 'العوالي']
const SUPERVISORS = ['باسم العولقي', 'نزار فلمبان']

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
  /**
   * Card figures typed in when the receipt would not give them up, held as
   * typed: a half-written number is a valid thing to be holding while someone
   * is still typing it.
   */
  const [enteredCards, setEnteredCards] = useState<
    Partial<Record<keyof CardTotals, string>>
  >({})
  /** A code read off a picked photograph, kept apart from the day's figures. */
  const [scannedCode, setScannedCode] = useState<
    { code: string; payload: string | null } | null
  >(null)
  const [identity, setIdentity] = useState<ReportIdentity>({ showroom: '', supervisor: '' })
  const [savedCount, setSavedCount] = useState(0)

  function onBuilt(built: DailyReportBuild) {
    setReport(built)
    setSave({ kind: 'idle' })
    setFill({ kind: 'idle' })
    setVisaIsMastercard(false)
    setEnteredCards({})
  }

  // Everything downstream — the displayed figures, the saved report and the
  // filled template — reads the same corrected figures.
  // What a person typed stands in for what was read; moving Visa into the
  // MasterCard column then moves whichever of the two is there.
  const figures =
    report === null
      ? null
      : (() => {
          const entered: Partial<Record<keyof CardTotals, number>> = {}
          for (const [card, text] of Object.entries(enteredCards) as [
            keyof CardTotals,
            string,
          ][]) {
            const amount = parseNumber(text)
            if (amount !== null) entered[card] = amount
          }
          const corrected = applyManualCards(report.figures, entered)
          return visaIsMastercard ? reassignVisaToMastercard(corrected) : corrected
        })()

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

      {/* A read-out of where the day has reached; it gates nothing. */}
      <Stepper
        identity={identity.showroom.trim() !== '' && identity.supervisor.trim() !== ''}
        files={report !== null}
        checked={report !== null && figures !== null}
      />

      <IdentityPanel
        identity={identity}
        onChange={setIdentity}
        showrooms={SHOWROOMS}
        supervisors={SUPERVISORS}
      />

      <UploadPanel onBuilt={onBuilt} onCode={setScannedCode} />

      {/* The three figures the day is judged by, before and after the reading. */}
      <SummaryStrip figures={figures} />

      {report && figures && (
        <FiguresPanel
          figures={figures}
          reportDate={report.reportDate}
          refundDeducted={report.refundDeducted}
          supersededExcluded={report.supersededExcluded}
          visaMayBeMastercard={report.visaMayBeMastercard}
          treatVisaAsMastercard={visaIsMastercard}
          enteredCards={enteredCards}
          onEnterCard={(card, value) =>
            setEnteredCards((current) => ({ ...current, [card]: value }))
          }
          receiptImages={report.receiptImages}
          onTreatVisaAsMastercard={setVisaIsMastercard}
        />
      )}

      {/* Every report in one place, one card each. */}
      <section className="panel reports">
        <h2 className="no-print">
          <Icon name="archive" />
          التقارير
        </h2>

        {report === null || figures === null ? (
          <div className="empty-reports">
            <Icon name="document" />
            <p>ستظهر التقارير بعد اكتمال الفحص</p>
            <p className="muted">ارفع الملفات لتبدأ المعالجة</p>
          </div>
        ) : (
          <div className="report-cards no-print">
            <article className="report-card">
              <span className="tile-icon">
                <Icon name="chart" />
              </span>
              <div className="report-body">
                <h3>التقرير اليومي</h3>
                <p className="muted">قالب المعرض معبّأ بأرقام اليوم — مبيعات ومدفوعات وإيداع.</p>
                <p className="report-meta">
                  <span>{report.reportDate}</span>
                  <span>XLSX</span>
                  <span>{report.sources.length} مصدر</span>
                </p>
              </div>
              {save.kind === 'confirm-replace' ? (
                <button type="button" onClick={() => persist(true)}>
                  تأكيد الاستبدال
                </button>
              ) : (
                <button type="button" className="ghost" onClick={() => persist(false)}>
                  حفظ التقرير
                </button>
              )}
            </article>

            {save.kind === 'confirm-replace' && (
              <div className="note warn">
                <Icon name="warning" />
                <p>
                  يوجد تقرير محفوظ لهذا المعرض بتاريخ {report.reportDate}
                  {save.existingCreatedAt && ` (حُفظ في ${save.existingCreatedAt.slice(0, 10)})`}
                  . الاستبدال نهائي ولا يمكن التراجع عنه.{' '}
                  <button
                    type="button"
                    className="link"
                    onClick={() => setSave({ kind: 'idle' })}
                  >
                    إلغاء
                  </button>
                </p>
              </div>
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
        )}

        {report && (
          <Collapsible title="تقرير الموظفين" icon="users" count={report.employees.length}>
            <EmployeesPanel employees={report.employees} reportDate={report.reportDate} />
          </Collapsible>
        )}

        <Collapsible title="التقارير المحفوظة" icon="archive">
          <SavedReportsPanel refreshToken={savedCount} onDownload={download} />
        </Collapsible>

        {/*
          * The one action the day ends with. It is the only button that fills
          * and downloads the template, so nothing repeats it above.
          */}
        {report && figures && (
          <button type="button" className="primary-wide no-print" onClick={fillTemplate}>
            <Icon name="download" />
            تنزيل التقرير النهائي
          </button>
        )}
      </section>

      {/*
        * A tool rather than a step, so it waits until it is asked for — unless
        * an uploaded photograph already had a code on it, in which case what it
        * found is on show.
        */}
      <div className="no-print">
        <Collapsible
          title="قراءة باركود الإيصال"
          icon="scan"
          count={scannedCode === null ? undefined : 1}
          open={scannedCode !== null}
        >
          <ScanPanel transactions={report?.transactions ?? []} found={scannedCode} />
        </Collapsible>
      </div>

      {/* Kept out of .no-print so it carries onto the employee report PDF. */}
      <footer className="credit">© 2026 basem.alawalgy — جميع الحقوق محفوظة</footer>
    </div>
  )
}
