import type { DailyFigures } from '../core/dailyReport'
import { formatMoney } from './format'
import { Icon } from './Icon'

interface Props {
  figures: DailyFigures
  reportDate: string
  /** Refunds already taken off the figures above; 0 when the day had none. */
  refundDeducted: number
  /** Cancelled orders already taken off the figures above; 0 when there were none. */
  supersededExcluded: number
  /** The mada receipt shows the shape that can mean Visa is really MasterCard. */
  visaMayBeMastercard: boolean
  treatVisaAsMastercard: boolean
  onTreatVisaAsMastercard: (value: boolean) => void
}

export function FiguresPanel({
  figures,
  reportDate,
  refundDeducted,
  supersededExcluded,
  visaMayBeMastercard,
  treatVisaAsMastercard,
  onTreatVisaAsMastercard,
}: Props) {
  const systemRows: [string, string, number][] = [
    ['TABS', 'Total Bill Payment', figures.tabs.billPayment],
    ['TABS', 'Total Ordering', figures.tabs.ordering],
    ['TABS', 'Total Cash Collection', figures.tabs.cashCollection],
    ['BSS', 'Total Bill Payment', figures.bss.billPayment],
    ['BSS', 'Total Ordering', figures.bss.ordering],
    ['BSS', 'Total Cash Sales', figures.bss.cashSales],
  ]

  return (
    <section className="panel" id="figures">
      <h2>
        <Icon name="report" />
        تقرير مبيعات المعارض اليومي — {reportDate}
      </h2>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>النظام</th>
              <th>التصنيف</th>
              <th>اجمالى المبلغ</th>
            </tr>
          </thead>
          <tbody>
            {systemRows.map(([system, category, amount]) => (
              <tr key={`${system}-${category}`}>
                <td>{system}</td>
                <td>{category}</td>
                <td className="num">{formatMoney(amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={2}>إجمالى المبيعات</th>
              <th className="num">{formatMoney(figures.totalSales)}</th>
            </tr>
          </tfoot>
        </table>
      </div>

      {refundDeducted > 0 && (
        <p className="muted">
          يوجد عملية Refund — تم خصم {formatMoney(refundDeducted)} من التقرير.
        </p>
      )}

      {supersededExcluded > 0 && (
        <p className="muted">
          يوجد عملية ملغاة (Superseded) بلا مرتجع — تم استبعاد{' '}
          {formatMoney(supersededExcluded)} من التقرير. التفاصيل في التنبيهات.
        </p>
      )}

      {figures.offDrawerSales > 0 && (
        <p className="muted">
          {formatMoney(figures.offDrawerSales)} حُصِّلت بوسيلة لا تدخل الصندوق ولا إيصال مدى،
          فلم تُحتسب ضمن الإيداع النقدي.
        </p>
      )}

      <h3>التحصيل</h3>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>ايداع نقدي</th>
              <th>شبكة - مدي</th>
              <th>فيزا</th>
              <th>ماستر كارد</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="num">{formatMoney(figures.cashDeposit)}</td>
              <td className="num">{formatMoney(figures.cards.mada)}</td>
              <td className="num">{formatMoney(figures.cards.visa)}</td>
              <td className="num">{formatMoney(figures.cards.mastercard)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted">
        الإيداع النقدي يحسبه القالب نفسه: إجمالى المبيعات ناقص ما حُصِّل بالبطاقات.
      </p>

      {visaMayBeMastercard && (
        <div className="notice no-print">
          <p className="warn">
            إيصال مدى يحمل مبلغًا في قسم <code>visa</code> الأول بينما قسم <code>VISA</code> في
            آخر الإيصال يقول «لا يوجد عمليات». هذا هو شكل الخطأ المعروف في الطابعة، حيث يُطبع
            تحصيل ماستركارد تحت اسم فيزا. الشكلان متطابقان على الورق فلا يمكن التمييز بينهما
            آليًا.
          </p>
          <label>
            <input
              type="checkbox"
              checked={treatVisaAsMastercard}
              onChange={(event) => onTreatVisaAsMastercard(event.target.checked)}
            />{' '}
            احتسب المبلغ ماستركارد بدل فيزا
          </label>
        </div>
      )}
    </section>
  )
}
