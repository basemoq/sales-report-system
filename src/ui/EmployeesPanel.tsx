import { useState } from 'react'
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

export function EmployeesPanel({ employees, reportDate }: Props) {
  const [open, setOpen] = useState<string | null>(null)

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
  const shopId = employees.find((employee) => employee.shopId)?.shopId ?? null
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
      </p>

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
              <th className="no-print"></th>
            </tr>
          </thead>
          <tbody>
            {employees.map((employee) => (
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
