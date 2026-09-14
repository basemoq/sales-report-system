import type { DayDetail } from '../core/model'
import { formatCount, formatDayLabel, formatMoney } from './format'

export function DayDetails({ days }: { days: readonly DayDetail[] }) {
  if (days.length === 0) return <p className="muted">لا توجد أيام مسجّلة.</p>

  return (
    <table className="day-table">
      <thead>
        <tr>
          <th>اليوم</th>
          <th>المبيعات</th>
          <th>عدد العمليات</th>
        </tr>
      </thead>
      <tbody>
        {days.map((day) => (
          <tr key={day.date}>
            <td>{formatDayLabel(day.date)}</td>
            <td className="num">{formatMoney(day.amount)}</td>
            <td className="num">{formatCount(day.transactions)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
