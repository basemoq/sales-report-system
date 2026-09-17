import type { DailyFigures } from '../core/dailyReport'
import { formatMoney } from './format'
import { Icon, type IconName } from './Icon'

/**
 * The three figures the day is judged by, at the top of the page.
 *
 * Every one of them is read straight off `DailyFigures` as it already stands —
 * nothing is worked out here. «المدفوعات» is the card columns added up, which
 * is the same sum the deposit is already derived from; the columns themselves
 * are still shown, and still editable, further down.
 */
export function SummaryStrip({ figures }: { figures: DailyFigures | null }) {
  const cards =
    figures === null ? null : figures.cards.mada + figures.cards.visa + figures.cards.mastercard

  const tiles: { label: string; value: number | null; icon: IconName }[] = [
    { label: 'إجمالي المبيعات', value: figures?.totalSales ?? null, icon: 'card' },
    { label: 'المدفوعات', value: cards, icon: 'coins' },
    { label: 'الإيداع النقدي', value: figures?.cashDeposit ?? null, icon: 'wallet' },
  ]

  return (
    <section className="panel summary">
      <h2>
        <Icon name="chart" />
        ملخص التقرير
      </h2>
      <div className="summary-tiles">
        {tiles.map((tile) => (
          <div className="summary-tile" key={tile.label}>
            <span className="tile-icon">
              <Icon name={tile.icon} />
            </span>
            <span className="summary-label">{tile.label}</span>
            <span className="summary-value">
              {tile.value === null ? '—' : formatMoney(tile.value)}
            </span>
            <span className="summary-unit">
              {tile.value === null ? 'يظهر بعد المعالجة' : 'ريال'}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
