import { useState } from 'react'
import type { LocationSummary } from '../core/model'
import { DayDetails } from './DayDetails'
import { formatCount, formatMoney } from './format'

export function LocationsPanel({ locations }: { locations: readonly LocationSummary[] }) {
  const [open, setOpen] = useState<string | null>(null)

  const grandTotal = locations.reduce((sum, location) => sum + location.total, 0)

  return (
    <section className="panel">
      <h2>المواقع</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>رقم الفرع</th>
            <th>الموقع</th>
            <th>المبيعات</th>
            <th>عدد العمليات</th>
            <th>الأيام</th>
            <th className="no-print"></th>
          </tr>
        </thead>
        <tbody>
          {locations.map((location) => (
            <tr key={location.shopId}>
              <td>{location.shopId}</td>
              <td>{location.locationName}</td>
              <td className="num">{formatMoney(location.total)}</td>
              <td className="num">{formatCount(location.transactions)}</td>
              <td className="num">{formatCount(location.days.length)}</td>
              <td className="no-print">
                <button
                  type="button"
                  className="link"
                  onClick={() => setOpen(open === location.shopId ? null : location.shopId)}
                  aria-expanded={open === location.shopId}
                >
                  {open === location.shopId ? 'إخفاء التفاصيل' : 'تفاصيل يوم بيوم'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={2}>الإجمالي</th>
            <th className="num">{formatMoney(grandTotal)}</th>
            <th colSpan={3}></th>
          </tr>
        </tfoot>
      </table>

      {locations
        .filter((location) => location.shopId === open)
        .map((location) => (
          <div key={location.shopId} className="details">
            <h3>
              تفاصيل {location.locationName} ({location.shopId})
            </h3>
            <DayDetails days={location.days} />
          </div>
        ))}
    </section>
  )
}
