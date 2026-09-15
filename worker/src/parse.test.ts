import { describe, expect, it } from 'vitest'
import { parseReceiptHtml, textLines } from './parse'

/**
 * The receipt as the page lays it out: a heading, the stamp line, then a row
 * per transaction type carrying the Arabic label, the English label, the count
 * and the amount. Figures and names match the real 14 Sep receipt.
 */
const PAGE = `
<!doctype html><html dir="rtl"><head><title>mada</title>
<style>.x{display:none}</style><script>var a=99.99</script></head>
<body>
  <img alt="mada"><div class="brand">mada</div>
  <h1>WINDTEL Telecom Al-Sharay a District - Mohamed</h1>
  <div><span>14/09/2026</span><span>23:50:01</span></div>
  <div><span>NCBB 107222100047</span><span>2332054800406708</span></div>
  <div>4814 007852 109.0.041</div>
  <div><span>Reconciliation</span><span>&#1605;&#1608;&#1575;&#1586;&#1606;&#1577;</span></div>
  <div><span>TotalsMatched</span><span>المجاميع متوافقة</span></div>
  <table>
    <tr><th>TX TYPE</th><th>COUNT</th><th>AMOUT IN ﷼</th></tr>
    <tr><td>TOTAL DB</td><td>14</td><td>1,406.85</td></tr>
    <tr><td>TOTAL CR</td><td>0</td><td>0.00</td></tr>
    <tr><td>NAQD</td><td>0</td><td>0.00</td></tr>
    <tr><td>C/ADV</td><td>0</td><td>0.00</td></tr>
    <tr><td>AUTH</td><td>0</td><td>0.00</td></tr>
  </table>
</body></html>`

describe('parseReceiptHtml', () => {
  it('reads the totals row by its label', () => {
    expect(parseReceiptHtml(PAGE).rows.totalDb).toEqual({ count: 14, amount: 1406.85 })
  })

  it('reads every row the receipt prints', () => {
    const { rows, missing } = parseReceiptHtml(PAGE)

    expect(rows.totalCr).toEqual({ count: 0, amount: 0 })
    expect(rows.naqd).toEqual({ count: 0, amount: 0 })
    expect(rows.cadv).toEqual({ count: 0, amount: 0 })
    expect(rows.auth).toEqual({ count: 0, amount: 0 })
    expect(missing).toEqual([])
  })

  it('reads the stamp, the reference and the shop', () => {
    const receipt = parseReceiptHtml(PAGE)

    expect(receipt.date).toBe('2026-09-14')
    expect(receipt.time).toBe('23:50:01')
    expect(receipt.reference).toBe('2332054800406708')
    expect(receipt.merchant).toContain('WINDTEL Telecom')
    expect(receipt.totalsMatched).toBe(true)
  })

  it('reports a receipt whose totals did not match', () => {
    expect(parseReceiptHtml(PAGE.replace('TotalsMatched', 'TotalsNotMatched')).totalsMatched).toBe(
      false,
    )
  })

  /* The point of matching on labels: the page may move its rows around. */
  it('does not depend on the order of the rows', () => {
    const reordered = PAGE.replace(
      '<tr><td>TOTAL DB</td><td>14</td><td>1,406.85</td></tr>\n    <tr><td>TOTAL CR</td><td>0</td><td>0.00</td></tr>',
      '<tr><td>TOTAL CR</td><td>0</td><td>0.00</td></tr>\n    <tr><td>TOTAL DB</td><td>14</td><td>1,406.85</td></tr>',
    )

    expect(parseReceiptHtml(reordered).rows.totalDb).toEqual({ count: 14, amount: 1406.85 })
  })

  it('reads a row whose columns are printed right to left', () => {
    const rtl = PAGE.replace(
      '<tr><td>TOTAL DB</td><td>14</td><td>1,406.85</td></tr>',
      '<tr><td>1,406.85</td><td>14</td><td>TOTAL DB</td></tr>',
    )

    expect(parseReceiptHtml(rtl).rows.totalDb).toEqual({ count: 14, amount: 1406.85 })
  })

  it('reads a row split across its own lines', () => {
    const split = PAGE.replace(
      '<tr><td>TOTAL DB</td><td>14</td><td>1,406.85</td></tr>',
      '<div>TOTAL DB</div><div>14</div><div>1,406.85</div>',
    )
    const row = parseReceiptHtml(split).rows.totalDb

    expect(row.count).toBe(14)
    expect(row.amount).toBe(1406.85)
  })

  it('never takes a neighbouring row’s figures', () => {
    const empty = PAGE.replace('<tr><td>NAQD</td><td>0</td><td>0.00</td></tr>', '<tr><td>NAQD</td></tr>')

    expect(parseReceiptHtml(empty).rows.naqd).toEqual({ count: null, amount: null })
  })

  it('does not mistake a longer label for one of its own', () => {
    const other = PAGE.replace('<td>TOTAL DB</td>', '<td>TOTAL DBX</td>')

    expect(parseReceiptHtml(other).missing).toContain('TOTAL DB')
  })

  it('ignores scripts and styles rather than reading numbers out of them', () => {
    expect(textLines(PAGE).join(' ')).not.toContain('99.99')
  })

  it('says what it could not find on a page that is not this receipt', () => {
    const receipt = parseReceiptHtml('<html><body><h1>Not a receipt</h1></body></html>')

    expect(receipt.missing).toEqual(['TOTAL DB', 'TOTAL CR', 'NAQD', 'C/ADV', 'AUTH'])
    expect(receipt.rows.totalDb).toBeUndefined()
  })
})
