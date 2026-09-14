import type { DailyFigures } from '../core/dailyReport'
import { formatMoney } from './format'

interface Props {
  figures: DailyFigures
  reportId: string
}

export function FiguresPanel({ figures, reportId }: Props) {
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
      <h2>تقرير مبيعات المعارض اليومي — {reportId}</h2>

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

      <h3>التحصيل</h3>
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
      <p className="muted">
        الإيداع النقدي يحسبه القالب نفسه: إجمالى المبيعات ناقص ما حُصِّل بالبطاقات.
      </p>
    </section>
  )
}
