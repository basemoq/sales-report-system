import { useEffect, useState } from 'react'
import {
  CASH_METHOD,
  SPAN_METHOD,
  checkCash,
  requestClosingCash,
  type CashCheck,
  type ClosingCash,
} from '../core/closingCash'
import type { EmployeeSummary } from '../core/model'
import { DayDetails } from './DayDetails'
import { formatCount, formatMoney } from './format'
import { Icon } from './Icon'

interface Props {
  employees: readonly EmployeeSummary[]
  reportDate: string
  /** A saved report shown below the day's own has a panel of its own. */
  id?: string
}

/**
 * Prints the employee table alone, on one page. The page is otherwise printed
 * whole — summary, systems and saved reports — so the mode is set on the root
 * for the print and cleared once the dialog closes.
 */
function printEmployees(panel: HTMLElement | null) {
  const root = document.documentElement
  root.dataset.print = 'employees'
  // A saved report can be open beside the day's: only the one pressed is printed.
  panel?.setAttribute('data-print-target', '')
  window.addEventListener(
    'afterprint',
    () => {
      delete root.dataset.print
      panel?.removeAttribute('data-print-target')
    },
    { once: true },
  )
  window.print()
}

/** Shortage red, surplus amber, a match green — the same reading as the shift closing. */
function differenceTone(difference: number): string {
  if (Math.abs(difference) < 0.005) return 'cash-ok'
  return difference < 0 ? 'cash-short' : 'cash-over'
}

/** CACO's own columns lead with the two the shift closing is checked against, named as such. */
const METHOD_LABELS: Record<string, string> = {
  [CASH_METHOD]: 'كاش الكاكو',
  [SPAN_METHOD]: 'اسبان الكاكو',
}

function ClosingHeads() {
  return (
    <>
      <th className="closing-col">كاش الإغلاق</th>
      <th className="closing-col">اسبان الإغلاق</th>
      <th>الفرق</th>
    </>
  )
}

function ClosingCells({ userId, check }: { userId: string; check: CashCheck }) {
  return (
    <>
      <td className="num closing-col" data-closing-cash={userId}>
        {check.cash === null ? 'لا إغلاق' : formatMoney(check.cash)}
      </td>
      <td className="num closing-col" data-closing-span={userId}>
        {check.cash === null ? '—' : check.span === null ? '—' : formatMoney(check.span)}
      </td>
      <td className={`num ${differenceTone(check.difference)}`} data-cash-diff={userId}>
        {formatMoney(check.difference)}
      </td>
    </>
  )
}

function ClosingTotals({ checks }: { checks: readonly CashCheck[] }) {
  const sum = (pick: (check: CashCheck) => number | null) =>
    checks.reduce((total, check) => total + (pick(check) ?? 0), 0)
  const difference = sum((check) => check.difference)
  return (
    <>
      <th className="num closing-col">{formatMoney(sum((check) => check.cash))}</th>
      <th className="num closing-col">{formatMoney(sum((check) => check.span))}</th>
      <th className={`num ${differenceTone(difference)}`}>{formatMoney(difference)}</th>
    </>
  )
}

export function EmployeesPanel({ employees, reportDate, id = 'employee-report' }: Props) {
  const [open, setOpen] = useState<string | null>(null)
  const shopId = employees.find((employee) => employee.shopId)?.shopId ?? null
  const dates = employees.flatMap((employee) => employee.days.map((day) => day.date)).sort()
  const from = dates[0] ?? reportDate
  const to = dates[dates.length - 1] ?? reportDate
  const [closing, setClosing] = useState<{ key: string; cash: ClosingCash | null } | null>(null)
  const key = `${shopId}|${from}|${to}`

  // The cash recorded at shift closing, from the control center (null standalone).
  useEffect(() => {
    let live = true
    requestClosingCash({ shopId, from, to }).then((cash) => {
      if (live) setClosing({ key, cash })
    })
    return () => {
      live = false
    }
  }, [shopId, from, to, key])

  if (employees.length === 0) {
    return (
      <section className="panel">
        <h2>
          <Icon name="users" />
          تقرير الموظفين
        </h2>
        <p className="muted">
          يحتاج تقرير الموظفين إلى ملف CACO المفصّل؛ لم يُرفع في هذه الدفعة.
        </p>
      </section>
    )
  }

  const total = employees.reduce((sum, employee) => sum + employee.total, 0)
  const transactions = employees.reduce((sum, employee) => sum + employee.transactions, 0)
  // Reports saved before activations were counted carry none: show a dash, not a zero.
  const counted = employees.every((employee) => employee.activations !== undefined)
  const activations = employees.reduce((sum, employee) => sum + (employee.activations ?? 0), 0)
  const cash = closing && closing.key === key ? closing.cash : null
  const checks = cash ? employees.map((employee) => checkCash(employee, cash)) : null
  const differenceTotal = checks ? checks.reduce((sum, check) => sum + check.difference, 0) : 0
  const shortages = checks ? checks.filter((check) => check.difference <= -0.005).length : 0
  // CACO's cash and SPAN first, then any other method; the closing's own columns come after them all.
  const found = [...new Set(employees.flatMap((employee) => Object.keys(employee.byPaymentMethod)))]
  const lead = [CASH_METHOD, SPAN_METHOD].filter((method) => found.includes(method))
  const methods = [...lead, ...found.filter((method) => !lead.includes(method)).sort()]

  return (
    <section className="panel employee-report" id={id}>
      <div className="panel-head">
        <h2>
          <Icon name="users" />
          تقرير الموظفين — {reportDate}
          {shopId && <span className="print-only"> · {shopId}</span>}
        </h2>
        <button
          type="button"
          className="no-print"
          onClick={(event) => printEmployees(event.currentTarget.closest('section'))}
        >
          تنزيل PDF
        </button>
      </div>
      <p className="muted no-print">
        يفتح نافذة الطباعة؛ اختر «حفظ بصيغة PDF». تُستخدم طباعة المتصفح لأنها الطريقة الوحيدة
        التي تُخرج النص العربي موصولًا وقابلًا للبحث داخل الملف. يُطبع جدول الموظفين وحده في
        صفحة واحدة.
      </p>
      <p className="employee-brief">
        {formatCount(employees.length)} موظفين · {formatCount(transactions)} عملية
        {counted && <>، منها {formatCount(activations)} تفعيل جديد</>} · الإجمالي{' '}
        {formatMoney(total)} ريال
        {checks && (
          <>
            {' · '}
            <span className={differenceTone(differenceTotal)} data-cash-brief>
              {shortages > 0
                ? `عجز عند ${formatCount(shortages)} · الفرق ${formatMoney(differenceTotal)} ريال`
                : 'الكاش مطابق لإغلاق الشفت'}
            </span>
          </>
        )}
      </p>
      {cash && (
        <p className="muted closing-cash-note">
          «كاش الإغلاق» و«اسبان الإغلاق» ما سجّله الموظف في إغلاق الشفت بالموقع، و«الفرق» =
          (كاش الإغلاق + اسبان الإغلاق) − (كاش الكاكو + اسبان الكاكو): السالب عجز، والموجب فائض.
          لا إغلاق = لم يُسجّل شيء.
          {cash.unmatched.length > 0 && (
            <> إغلاقات لم تُطابَق بيوزر: {cash.unmatched.join('، ')}.</>
          )}
        </p>
      )}

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>الموظف</th>
              <th>الإجمالي</th>
              <th>عدد العمليات</th>
              <th>منها تفعيل جديد</th>
              {methods.map((method) => (
                <th key={method}>{METHOD_LABELS[method] ?? method}</th>
              ))}
              {checks && <ClosingHeads />}
              <th className="no-print"></th>
            </tr>
          </thead>
          <tbody>
            {employees.map((employee, index) => (
              <tr key={employee.userId}>
                <td>{employee.userId}</td>
                <td className="num">{formatMoney(employee.total)}</td>
                <td className="num">{formatCount(employee.transactions)}</td>
                <td className="num">
                  {employee.activations === undefined ? '—' : formatCount(employee.activations)}
                </td>
                {methods.map((method) => (
                  <td key={method} className="num">
                    {formatMoney(employee.byPaymentMethod[method] ?? 0)}
                  </td>
                ))}
                {checks && <ClosingCells userId={employee.userId} check={checks[index]} />}
                <td className="no-print">
                  <button
                    type="button"
                    className="link"
                    onClick={() => setOpen(open === employee.userId ? null : employee.userId)}
                    aria-expanded={open === employee.userId}
                  >
                    {open === employee.userId ? 'إخفاء التفاصيل' : 'تفاصيل يوم بيوم'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>الإجمالي</th>
              <th className="num">{formatMoney(total)}</th>
              <th className="num">{formatCount(transactions)}</th>
              <th className="num">{counted ? formatCount(activations) : '—'}</th>
              {methods.map((method) => (
                <th key={method} className="num">
                  {formatMoney(
                    employees.reduce((sum, employee) => sum + (employee.byPaymentMethod[method] ?? 0), 0),
                  )}
                </th>
              ))}
              {checks && <ClosingTotals checks={checks} />}
              <th className="no-print"></th>
            </tr>
          </tfoot>
        </table>
      </div>

      {employees
        .filter((employee) => employee.userId === open)
        .map((employee) => (
          <div key={employee.userId} className="details">
            <h3>تفاصيل {employee.userId}</h3>
            <DayDetails days={employee.days} />
          </div>
        ))}
    </section>
  )
}
