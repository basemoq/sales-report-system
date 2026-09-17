import { useEffect, useMemo } from 'react'
import type { DailyFigures } from '../core/dailyReport'
import type { UploadedFile } from '../core/pipeline'
import { Collapsible } from './Collapsible'
import type { CardTotals } from '../core/sources/mada'
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
  /**
   * Card figures the operator typed in, as typed: a half-written number is a
   * valid thing to be holding while someone is still typing it.
   */
  enteredCards: Partial<Record<keyof CardTotals, string>>
  onEnterCard: (card: keyof CardTotals, value: string) => void
  /** The day's photographs, to read a figure off when the scan could not. */
  receiptImages: readonly UploadedFile[]
}

/**
 * The photographs as something a browser can show. They are held in memory as
 * bytes, so each needs a URL of its own, and each URL has to be handed back or
 * the page keeps the whole receipt alive after it is gone.
 */
function useImageUrls(images: readonly UploadedFile[]): { name: string; url: string }[] {
  const urls = useMemo(
    () =>
      images.map((image) => ({
        name: image.fileName,
        url: URL.createObjectURL(new Blob([image.bytes])),
      })),
    [images],
  )

  useEffect(() => () => urls.forEach((image) => URL.revokeObjectURL(image.url)), [urls])

  return urls
}

const CARD_LABELS: Record<keyof CardTotals, string> = {
  mada: 'شبكة - مدي',
  visa: 'فيزا',
  mastercard: 'ماستر كارد',
}

const CARD_COLUMNS = Object.entries(CARD_LABELS) as [keyof CardTotals, string][]

export function FiguresPanel({
  figures,
  reportDate,
  refundDeducted,
  supersededExcluded,
  visaMayBeMastercard,
  treatVisaAsMastercard,
  onTreatVisaAsMastercard,
  enteredCards,
  onEnterCard,
  receiptImages,
}: Props) {
  const photos = useImageUrls(receiptImages)

  // A box left empty is not an entry of zero; it is the reading again.
  const entered = new Set(
    CARD_COLUMNS.map(([card]) => card).filter((card) => (enteredCards[card] ?? '') !== ''),
  )

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
        التحقق من الأرقام — {reportDate}
      </h2>

      {/*
        * The six system rows, folded away by default: the three figures that
        * matter are in the summary at the top of the page, and this is the
        * working behind them. It still prints, so the report on paper is
        * unchanged.
        */}
      <Collapsible title="تفاصيل الأنظمة" icon="report" count={systemRows.length}>
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

      </Collapsible>

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
              {CARD_COLUMNS.map(([card, label]) => (
                <td className="num" key={card}>
                  {/*
                    * Typed over when the receipt would not give the figure up.
                    * Printed as a plain number, since a box to type in means
                    * nothing on paper.
                    */}
                  <input
                    className={entered.has(card) ? 'cell-input is-entered no-print' : 'cell-input no-print'}
                    type="text"
                    inputMode="decimal"
                    aria-label={label}
                    value={enteredCards[card] ?? formatMoney(figures.cards[card])}
                    onChange={(event) => onEnterCard(card, event.target.value)}
                  />
                  <span className="print-only">{formatMoney(figures.cards[card])}</span>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted">
        الإيداع النقدي يحسبه القالب نفسه: إجمالى المبيعات ناقص ما حُصِّل بالبطاقات.
      </p>

      {entered.size > 0 ? (
        <div className="notice no-print">
          <p className="warn">
            {[...entered]
              .map((card) => CARD_LABELS[card])
              .join('، ')}{' '}
            — أُدخلت يدويًا ولم تُقرأ من الإيصال. تُحتسب في التقرير وفي القالب كما كتبتها.
          </p>
          <button type="button" onClick={() => entered.forEach((card) => onEnterCard(card, ''))}>
            استرجاع المقروء من الإيصال
          </button>
        </div>
      ) : (
        <p className="muted no-print">
          خانات البطاقات قابلة للتعديل: إذا لم يُقرأ مبلغ من الإيصال المصوّر، اكتبه هنا.
        </p>
      )}

      {/*
        * The paper is not always still on the counter when a figure turns out
        * to be missing, so the photograph stays where the figure is typed.
        */}
      {photos.length > 0 && (
        <div className="receipt-photos no-print">
          <p className="muted">الإيصالات المصوّرة — اضغط الصورة لتكبيرها وقراءة المبلغ منها:</p>
          <div className="receipt-strip">
            {photos.map((photo) => (
              <a key={photo.url} href={photo.url} target="_blank" rel="noreferrer">
                <img src={photo.url} alt={photo.name} />
              </a>
            ))}
          </div>
        </div>
      )}

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
