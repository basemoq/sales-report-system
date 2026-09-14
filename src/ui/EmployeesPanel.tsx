import { useState } from 'react'
import type { EmployeeSummary } from '../core/model'
import { DayDetails } from './DayDetails'
import { formatCount, formatMoney } from './format'

interface Props {
  employees: readonly EmployeeSummary[]
  reportId: string
}

export function EmployeesPanel({ employees, reportId }: Props) {
  const [open, setOpen] = useState<string | null>(null)

  if (employees.length === 0) {
    return (
      <section className="panel">
        <h2>تقرير الموظفين</h2>
        <p className="muted">
          يحتاج تقرير الموظفين إلى ملف CACO المفصّل؛ لم يُرفع في هذه الدفعة.
        </p>
      </section>
    )
  }

  const total = employees.reduce((sum, employee) => sum + employee.total, 0)
  const methods = [
    ...new Set(employees.flatMap((employee) => Object.keys(employee.byPaymentMethod))),
  ].sort()

  return (
    <section className="panel" id="employee-report">
      <div className="panel-head">
        <h2>تقرير الموظفين — {reportId}</h2>
        <button type="button" className="no-print" onClick={() => window.print()}>
          تنزيل PDF
        </button>
      </div>
      <p className="muted no-print">
        يفتح نافذة الطباعة؛ اختر «حفظ بصيغة PDF». تُستخدم طباعة المتصفح لأنها الطريقة الوحيدة
        التي تُخرج النص العربي موصولًا وقابلًا للبحث داخل الملف.
      </p>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>الموظف</th>
              <th>الإجمالي</th>
              <th>عدد العمليات</th>
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
              <th colSpan={methods.length + 2}></th>
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
