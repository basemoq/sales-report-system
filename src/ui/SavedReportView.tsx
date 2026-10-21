import { reviveSavedReport } from '../core/savedReport'
import type { StoredReport } from '../db/store'
import { EmployeesPanel } from './EmployeesPanel'
import { FiguresPanel } from './FiguresPanel'
import { Icon } from './Icon'
import { SummaryStrip } from './SummaryStrip'

const noop = () => {}

/**
 * A saved day opened again: its figures and its employees as they were saved.
 * Shown at the page's own width, like the day being worked on, and outside the
 * list's panel, which never prints, so its employee table prints on its own.
 */
export function SavedReportView({
  report,
  onClose,
}: {
  report: StoredReport
  onClose: () => void
}) {
  const shown = reviveSavedReport(report.data)
  if (shown === null) return null

  return (
    <div className="saved-view" id="saved-report-view">
      <section className="panel saved-view-head no-print">
        <h2>
          <Icon name="document" />
          تقرير محفوظ — {shown.reportDate}
          {shown.identity.showroom && <> · {shown.identity.showroom}</>}
          {shown.shopId && <> · {shown.shopId}</>}
        </h2>
        <p className="muted">
          كما حُفظ في {report.createdAt.slice(0, 10)}
          {shown.identity.supervisor && <> · المشرف: {shown.identity.supervisor}</>}. للعرض فقط: صور
          الإيصالات وتعديل أرقام البطاقات في رفع الملفات من جديد.
        </p>
        <button type="button" onClick={onClose}>
          إغلاق العرض
        </button>
      </section>
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
  )
}
