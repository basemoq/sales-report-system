import type { StockLayout } from '../core/stockReport'
import { parseCount } from '../core/stockReport'
import { Icon } from './Icon'

/**
 * The day's device count, typed in from the shelf. One box per device the
 * region's stock sheet lists, and a note. It is downloaded — and, inside the
 * control center, sent to the branch mailbox — with the sales report, by the
 * same button, so there is no second thing to remember at the end of the day.
 */
export function StockPanel({
  layout,
  error,
  values,
  comments,
  onValue,
  onComments,
}: {
  layout: StockLayout | null
  error: string | null
  values: Record<string, string>
  comments: string
  onValue: (header: string, value: string) => void
  onComments: (value: string) => void
}) {
  const counted = layout
    ? layout.devices.filter((device) => parseCount(values[device.header] ?? '') !== null).length
    : 0

  return (
    <section className="panel stock-panel no-print">
      <div className="panel-head">
        <h2>
          <Icon name="store" />
          جرد الأجهزة
        </h2>
        {layout && (
          <span className="badge">
            {counted} من {layout.devices.length}
          </span>
        )}
      </div>
      <p className="muted">
        عدد كل جهاز في المعرض الآن. يُنزَّل ملفًّا ثانيًا مع تقرير المبيعات بزر «تنزيل التقرير
        النهائي». الخانة الفارغة = لم يُعدّ، و0 = لا يوجد.
      </p>

      {error && (
        <div className="note error">
          <Icon name="error" />
          <p>{error}</p>
        </div>
      )}

      {layout && (
        <>
          <div className="stock-grid">
            {layout.devices.map((device) => {
              const text = values[device.header] ?? ''
              const invalid = parseCount(text) === 'invalid'
              return (
                <label key={device.header} className={invalid ? 'stock-cell is-invalid' : 'stock-cell'}>
                  <span>
                    <bdi>{device.label}</bdi>
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={text}
                    aria-invalid={invalid}
                    onChange={(event) => onValue(device.header, event.target.value)}
                  />
                </label>
              )
            })}
          </div>
          {layout.commentsColumn !== null && (
            <label className="stock-comments">
              <span>ملاحظات</span>
              <input
                type="text"
                value={comments}
                maxLength={300}
                onChange={(event) => onComments(event.target.value)}
              />
            </label>
          )}
        </>
      )}
    </section>
  )
}
