import { useEffect, useState } from 'react'
import { checkCash, requestClosingCash, type ClosingCash } from '../core/closingCash'
import type { EmployeeSummary } from '../core/model'
import { DayDetails } from './DayDetails'
import { formatCount, formatMoney } from './format'
import { Icon } from './Icon'

interface Props {
  employees: readonly EmployeeSummary[]
  reportDate: string
}

/**
 * Prints the employee table alone, on one page. The page is otherwise printed
 * whole — summary, systems and saved reports — so the mode is set on the root
 * for the print and cleared once the dialog closes.
 */
function printEmployees() {
  const root = document.documentElement
  root.dataset.print = 'employees'
  window.addEventListener('afterprint', () => delete root.dataset.print, { once: true })
  window.print()
}

/** Shortage red, surplus amber, a match green — the same reading as the shift closing. */
function differenceTone(difference: number): string {
  if (Math.abs(difference) < 0.005) return 'cash-ok'
  return difference < 0 ? 'cash-short' : 'cash-over'
}

export function EmployeesPanel({ employees, reportDate }: Props) {
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
  const recordedTotal = checks ? checks.reduce((sum, check) => sum + (check.recorded ?? 0), 0) : 0
  const differenceTotal = checks ? checks.reduce((sum, check) => sum + check.difference, 0) : 0
  const shortages = checks ? checks.filter((check) => check.difference <= -0.005).length : 0
  const methods = [
    ...new Set(employees.flatMap((employee) => Object.keys(employee.byPaymentMethod))),
  ].sort()

  return (
    <section className="panel" id="employee-report">
      <div className="panel-head">
        <h2>
          <Icon name="users" />
          تقرير الموظفين — {reportDate}
          {shopId && <span className="print-only"> · {shopId}</span>}
        </h2>
        <button type="button" className="no-print" onClick={printEmployees}>
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
                ? `عجز كاش عند ${formatCount(shortages)} · الفرق ${formatMoney(differenceTotal)} ريال`
                : 'الكاش مطابق لإغلاق الشفت'}
            </span>
          </>
        )}
      </p>
      {cash && (
        <p className="muted closing-cash-note">
          «كاش الإغلاق» ما سجّله الموظف في إغلاق الشفت بالموقع، و«الفرق» = كاش الإغلاق − Cash في
          CACO: السالب عجز، والموجب فائض. لا إغلاق = لم يُسجّل شيء.
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
                <th key={method}>{method}</th>
              ))}
              {checks && (
                <>
                  <th>كاش الإغلاق</th>
                  <th>الفرق</th>
                </>
              )}
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
                {checks && (
                  <>
                    <td className="num" data-closing-cash={employee.userId}>
                      {checks[index].recorded === null ? 'لا إغلاق' : formatMoney(checks[index].recorded)}
                    </td>
                    <td
                      className={`num ${differenceTone(checks[index].difference)}`}
                      data-cash-diff={employee.userId}
                    >
                      {formatMoney(checks[index].difference)}
                    </td>
                  </>
                )}
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
              {checks && (
                <>
                  <th className="num">{formatMoney(recordedTotal)}</th>
                  <th className={`num ${differenceTone(differenceTotal)}`}>{formatMoney(differenceTotal)}</th>
                </>
              )}
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
