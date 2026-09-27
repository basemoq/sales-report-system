import { useEffect, useRef, useState } from 'react'
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
import {
  fillStockTemplate,
  getStockTemplateBytes,
  parseCount,
  readStockLayout,
  type StockLayout,
} from './core/stockReport'
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
import { Icon } from './ui/Icon'
import { UploadPanel } from './ui/UploadPanel'
import { StockPanel } from './ui/StockPanel'
import { reportFileName, stockFileName } from './ui/format'
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
  | { kind: 'done'; written: number; counted: number; warnings: string[] }
  | { kind: 'error'; message: string }

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** The day's count survives a reload of the page, per shop and day. */
const stockDraftKey = (shopId: string | null, isoDate: string) =>
  `stock-draft:${shopId ?? '-'}:${isoDate}`

interface StockDraft {
  values: Record<string, string>
  comments: string
}

function readStockDraft(key: string): StockDraft {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? (JSON.parse(raw) as Partial<StockDraft>) : null
    return {
      values: parsed && typeof parsed.values === 'object' && parsed.values ? parsed.values : {},
      comments: typeof parsed?.comments === 'string' ? parsed.comments : '',
    }
  } catch {
    return { values: {}, comments: '' }
  }
}

function writeStockDraft(key: string, draft: StockDraft) {
  try {
    localStorage.setItem(key, JSON.stringify(draft))
  } catch {
    // A private window or full storage: the count still downloads, it just
    // does not outlive the page.
  }
}

function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let binary = ''
  for (let offset = 0; offset < view.length; offset += 0x8000) {
    binary += String.fromCharCode(...view.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

/**
 * Inside the control center the page is framed, and the frame is what sends the
 * two files to the branch mailbox. Standalone there is no parent and nothing is
 * posted; the message never leaves the site's own origin.
 */
function handToHost(message: {
  reportDate: string
  shopId: string | null
  showroom: string
  supervisor: string
  files: { name: string; bytes: ArrayBuffer }[]
}) {
  if (window.parent === window) return
  try {
    window.parent.postMessage(
      {
        type: 'sales-report:final',
        reportDate: message.reportDate,
        shopId: message.shopId,
        showroom: message.showroom,
        supervisor: message.supervisor,
        files: message.files.map((file) => ({
          name: file.name,
          type: XLSX_TYPE,
          base64: toBase64(file.bytes),
        })),
      },
      window.location.origin,
    )
  } catch {
    // A parent on another origin cannot be told; the downloads stand on their own.
  }
}

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
  const [identity, setIdentity] = useState<ReportIdentity>({ showroom: '', supervisor: '' })
  const [stockLayout, setStockLayout] = useState<StockLayout | null>(null)
  const [stockError, setStockError] = useState<string | null>(null)
  /** What was typed, tagged with the shop and day it was typed for. */
  const [stockEdit, setStockEdit] = useState<{ key: string; draft: StockDraft } | null>(null)

  useEffect(() => {
    let live = true
    getStockTemplateBytes()
      .then(readStockLayout)
      .then((layout) => live && setStockLayout(layout))
      .catch((cause: Error) => live && setStockError(cause.message))
    return () => {
      live = false
    }
  }, [])

  const stockKey = report ? stockDraftKey(report.shopId, report.reportDate) : null
  // A new day's files bring that day's count back, or an empty one.
  const stock: StockDraft =
    stockKey === null
      ? { values: {}, comments: '' }
      : stockEdit && stockEdit.key === stockKey
        ? stockEdit.draft
        : readStockDraft(stockKey)

  function updateStock(next: StockDraft) {
    if (stockKey === null) return
    setStockEdit({ key: stockKey, draft: next })
    writeStockDraft(stockKey, next)
  }
  const [savedCount, setSavedCount] = useState(0)

  /**
   * The header names are asked for once the files are read, not before.
   *
   * Nobody fills a form in to say who they are and then goes looking for the
   * files; the day's work starts with the files. So the page is left alone
   * until they are read, and then it goes back up to the two boxes that are
   * still empty rather than letting the report be written without them.
   */
  const identityBox = useRef<HTMLDivElement>(null)
  const pressing =
    report !== null && (identity.showroom.trim() === '' || identity.supervisor.trim() === '')

  useEffect(() => {
    if (!pressing) return
    identityBox.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [pressing])

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
      // The count is checked before anything downloads: a half-typed number is
      // fixed in a second, a wrong one in the region's sheet is not.
      const counts: Record<string, number | null> = {}
      const invalid: string[] = []
      for (const device of stockLayout?.devices ?? []) {
        const parsed = parseCount(stock.values[device.header] ?? '')
        if (parsed === 'invalid') invalid.push(device.label)
        else counts[device.header] = parsed
      }
      if (invalid.length > 0) {
        setFill({
          kind: 'error',
          message: `عدد غير صحيح في جرد الأجهزة: ${invalid.join('، ')} — أرقام صحيحة فقط.`,
        })
        return
      }

      const result = await fillDailyTemplate(await getTemplateBytes(), figures, {
        ...identity,
        shopId: report.shopId,
      })
      const salesName = reportFileName(report.reportDate)
      const files = [{ name: salesName, bytes: result.bytes }]
      const warnings = [...result.warnings]
      let counted = 0

      if (stockLayout) {
        const filled = await fillStockTemplate(await getStockTemplateBytes(), {
          shopId: report.shopId,
          counts,
          comments: stock.comments,
        })
        counted = filled.counted
        files.push({ name: stockFileName(report.shopId, report.reportDate), bytes: filled.bytes })
        if (counted === 0) warnings.push('جرد الأجهزة فارغ — نُزّل ملفه بلا أعداد.')
      } else {
        warnings.push(`لم يُنزَّل جرد الأجهزة: ${stockError ?? 'قالب الجرد غير جاهز بعد.'}`)
      }

      download(result.bytes, salesName)
      // A second download in the same click is held back a moment: some
      // browsers drop one that starts while the first is still being handed over.
      for (const file of files.slice(1)) {
        await new Promise((resolve) => setTimeout(resolve, 700))
        download(file.bytes, file.name)
      }
      handToHost({
        reportDate: report.reportDate,
        shopId: report.shopId,
        showroom: identity.showroom,
        supervisor: identity.supervisor,
        files,
      })
      setFill({
        kind: 'done',
        written: result.written.length,
        counted,
        warnings,
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

      <div ref={identityBox}>
        <IdentityPanel
          identity={identity}
          onChange={setIdentity}
          showrooms={SHOWROOMS}
          supervisors={SUPERVISORS}
          pressing={pressing}
        />
      </div>

      <UploadPanel onBuilt={onBuilt} transactions={report?.transactions ?? []} />

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

      {report && figures && (
        <StockPanel
          layout={stockLayout}
          error={stockError}
          values={stock.values}
          comments={stock.comments}
          onValue={(header, value) =>
            updateStock({ ...stock, values: { ...stock.values, [header]: value } })
          }
          onComments={(comments) => updateStock({ ...stock, comments })}
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
                  <p>
                    تم تنزيل القالب بعد تعبئة {fill.written} خانة
                    {stockLayout && `، وجرد الأجهزة (${fill.counted} جهاز)`}.
                  </p>
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

      {/* Kept out of .no-print so it carries onto the employee report PDF. */}
      <footer className="credit">© 2026 basem.alawalgy — جميع الحقوق محفوظة</footer>
    </div>
  )
}
