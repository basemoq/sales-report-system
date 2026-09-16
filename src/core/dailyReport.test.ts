import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import {
  buildDailyFigures,
  fillDailyTemplate,
  reassignVisaToMastercard,
  refundSummary,
  TemplateFillError,
  type DailyFigures,
} from './dailyReport'
import type { CacoDetailed, CacoSummary, CacoTransaction } from './sources/caco'
import type { MadaReconciliation } from './sources/mada'
import type { TabsReport } from './sources/tabs'

const caco = (rows: { orderType: string; total: number }[]): CacoSummary => ({
  parameters: { shopId: 'WFW430', from: new Date(Date.UTC(2026, 8, 13)), to: null },
  paymentMethods: ['Cash', 'SPAN Offline'],
  rows: rows.map((row) => ({ ...row, byMethod: {} })),
  reportedTotals: {},
  grandTotal: 0,
})

const tabs = (
  totals = { billPayment: 723.3, ordering: 0, cashCollection: 0 },
): TabsReport => ({
  totals,
  warehouse: 'WFW430',
  generatedOn: null,
  sectionsFound: [],
})

const mada = (
  cards = { mada: 1190.2, visa: 590.59, mastercard: 0 },
): MadaReconciliation => ({
  terminalDate: new Date(Date.UTC(2026, 8, 13)),
  schemes: [],
  cards,
  unmapped: [],
  totalsMatched: true,
  visaMayBeMastercard: false,
})

/** The real Sep 13 file, reduced to the column the split is derived from. */
const DETAILED_ROWS: [string, number][] = [
  ['Invoice Payment', 2289.98],
  ['Top Up', 423],
  ['Flex 109"Add/Remove Add-On - Order Entry"', 376.05],
  ['Setup Fee Prepaid', 350.85],
  ['"Change Plan Restriction Service"', 519],
  ['Social Media Unlimited', 105.01],
  ['SIM Replacement Fee"SIM Replacement - Order Entry"', 40.25],
  ['Setup Fee (MultiSim)', 20],
]

const detailed = (rows: [string, number][] = DETAILED_ROWS): CacoDetailed => ({
  parameters: { shopId: 'WFW430', from: new Date(Date.UTC(2026, 8, 13)), to: null },
  transactions: rows.map(([orderType, amount], index) => ({
    userId: 'Basem.Alawalgy',
    userFullName: 'Basem.Alawalgy',
    manager: null,
    shopId: 'WFW430',
    msisdn: null,
    account: null,
    date: new Date(Date.UTC(2026, 8, 13)),
    time: '5:38 PM',
    receiptNo: `ZN_${index}`,
    amount,
    paymentMethod: 'Cash',
    orderType,
    salesOrderNumber: null,
    status: 'Processed',
  })),
  reportedTotal: null,
  skippedRows: 0,
})

const CACO_ROWS = [
  { orderType: 'Top Up', total: 423 },
  { orderType: 'Refund', total: 0 },
  { orderType: 'Invoice Payment', total: 2289.98 },
  { orderType: 'Sales Order Payment', total: 1411.16 },
  { orderType: 'EVD Voucher', total: 0 },
]

describe('buildDailyFigures', () => {
  it('maps the CACO order types onto the BSS rows', () => {
    const figures = buildDailyFigures({ caco: caco(CACO_ROWS) })

    expect(figures.bss).toEqual({
      billPayment: 2289.98,
      ordering: 1411.16,
      cashSales: 423,
    })
  })

  it('totals the six system figures the way the template sums them', () => {
    const figures = buildDailyFigures({ caco: caco(CACO_ROWS), tabs: tabs(), mada: mada() })

    expect(figures.totalSales).toBe(4847.44)
  })

  it('derives the cash deposit as everything not settled on a card', () => {
    const figures = buildDailyFigures({ caco: caco(CACO_ROWS), tabs: tabs(), mada: mada() })

    // Written out rather than computed, since the raw subtraction is 3066.6499999999996.
    expect(figures.cashDeposit).toBe(3066.65)
  })

  it('rounds to halalas rather than carrying float artefacts', () => {
    const figures = buildDailyFigures({
      caco: caco([
        { orderType: 'Invoice Payment', total: 2048.39 + 241.59 },
        { orderType: 'Sales Order Payment', total: 230.36 + 1180.8 },
      ]),
    })

    expect(figures.bss.ordering).toBe(1411.16)
    expect(Number.isInteger(figures.totalSales * 100)).toBe(true)
  })

  it('treats a missing source as contributing nothing', () => {
    const figures = buildDailyFigures({ tabs: tabs() })

    expect(figures.bss).toEqual({ billPayment: 0, ordering: 0, cashSales: 0 })
    expect(figures.cards).toEqual({ mada: 0, visa: 0, mastercard: 0 })
    expect(figures.totalSales).toBe(723.3)
  })

  it('ignores a CACO order type the template has no row for', () => {
    const figures = buildDailyFigures({
      caco: caco([...CACO_ROWS, { orderType: 'Something New', total: 999 }]),
    })

    expect(figures.totalSales).toBe(4124.14)
  })

  it('recovers the same BSS split from the detailed export alone', () => {
    // Every figure below matches the summary the real pair was checked against.
    const figures = buildDailyFigures({ detailed: detailed() })

    expect(figures.bss).toEqual({
      billPayment: 2289.98,
      ordering: 1411.16,
      cashSales: 423,
    })
  })

  it('reads a sales order from what was sold, not from a named order type', () => {
    const figures = buildDailyFigures({
      detailed: detailed([
        ['Flex 109"Add/Remove Add-On - Order Entry"', 376.05],
        ['Setup Fee Prepaid\nPre-loaded balance', 350.85],
      ]),
    })

    expect(figures.bss.ordering).toBe(726.9)
    expect(figures.bss.billPayment).toBe(0)
  })

  it('leaves a refund and an EVD voucher out, as the summary does', () => {
    const figures = buildDailyFigures({
      detailed: detailed([
        ['Invoice Payment', 100],
        ['Refund', 50],
        ['EVD Voucher', 25],
      ]),
    })

    expect(figures.bss).toEqual({ billPayment: 100, ordering: 0, cashSales: 0 })
  })

  it('prefers the summary when both CACO exports are uploaded', () => {
    const figures = buildDailyFigures({
      caco: caco([{ orderType: 'Invoice Payment', total: 999 }]),
      detailed: detailed(),
    })

    expect(figures.bss.billPayment).toBe(999)
  })

  it('dates the report from the detailed export when there is no summary', () => {
    expect(buildDailyFigures({ detailed: detailed() }).date).toEqual(
      new Date(Date.UTC(2026, 8, 13)),
    )
  })

  it('dates the report from CACO, falling back to the terminal receipt', () => {
    expect(buildDailyFigures({ caco: caco(CACO_ROWS) }).date).toEqual(
      new Date(Date.UTC(2026, 8, 13)),
    )
    expect(buildDailyFigures({ mada: mada() }).date).toEqual(new Date(Date.UTC(2026, 8, 13)))
    expect(buildDailyFigures({}).date).toBeNull()
  })
})

/** Mirrors the real daily template, formulas included. */
async function templateBytes(): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('تقرير مبيعات يومي')

  sheet.getCell('A1').value = 'تقرير مبيعات المعارض اليومي'
  sheet.getCell('A2').value = 'إسم المعرض'
  sheet.getCell('B2').value = 'الشرائع'
  sheet.getCell('C2').value = 'كود المعرض'
  sheet.getCell('D2').value = 'FW430'
  sheet.getCell('A3').value = 'مشرف المعرض'
  sheet.getCell('B3').value = 'باسم العولقي'
  sheet.getCell('C3').value = 'التاريخ'
  sheet.getCell('A4').value = 'النظام'
  sheet.getCell('B4').value = 'التصنيف'
  sheet.getCell('D4').value = 'اجمالى المبلغ'

  const rows: [string, string][] = [
    ['TABS', 'Total Bill Payment'],
    ['TABS', ' Total Ordering'],
    ['TABS', 'Total Cash Collection'],
    ['BSS', 'Total Bill Payment'],
    ['BSS', ' Total Ordering'],
    ['BSS', 'Total Cash Sales'],
  ]
  rows.forEach(([system, category], index) => {
    const row = 5 + index
    sheet.getCell(`A${row}`).value = system
    sheet.getCell(`B${row}`).value = category
  })

  sheet.getCell('A11').value = 'ايداع نقدي '
  sheet.getCell('B11').value = 'شبكة - مدي'
  sheet.getCell('C11').value = 'فيزا'
  sheet.getCell('D11').value = 'ماستر كارد'
  sheet.getCell('E11').value = 'إجمالى المبيعات'
  // The figures the template was last saved with — the real one shipped with
  // 12,228.84 and 5,042.50 remembered from another day.
  sheet.getCell('A12').value = { formula: 'E12-D12-C12-B12', result: 5042.5 }
  sheet.getCell('E12').value = { formula: 'SUM(D5:D10)', result: 12228.84 }

  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer
}

async function reload(bytes: ArrayBuffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes)
  return workbook.worksheets[0]
}

const FIGURES: DailyFigures = buildDailyFigures({
  caco: caco(CACO_ROWS),
  tabs: tabs(),
  mada: mada(),
})

describe('fillDailyTemplate', () => {
  it('writes each system figure into its own row', async () => {
    const sheet = await reload((await fillDailyTemplate(await templateBytes(), FIGURES)).bytes)

    expect(sheet.getCell('D5').value).toBe(723.3)
    expect(sheet.getCell('D6').value).toBe(0)
    expect(sheet.getCell('D7').value).toBe(0)
    expect(sheet.getCell('D8').value).toBe(2289.98)
    expect(sheet.getCell('D9').value).toBe(1411.16)
    expect(sheet.getCell('D10').value).toBe(423)
  })

  it('writes the card figures under their own headers', async () => {
    const sheet = await reload((await fillDailyTemplate(await templateBytes(), FIGURES)).bytes)

    expect(sheet.getCell('B12').value).toBe(1190.2)
    expect(sheet.getCell('C12').value).toBe(590.59)
    expect(sheet.getCell('D12').value).toBe(0)
  })

  it('leaves the template to compute the cells it computes itself', async () => {
    const result = await fillDailyTemplate(await templateBytes(), FIGURES)
    const sheet = await reload(result.bytes)

    expect(sheet.getCell('A12').value).toHaveProperty('formula', 'E12-D12-C12-B12')
    expect(sheet.getCell('E12').value).toHaveProperty('formula', 'SUM(D5:D10)')
  })

  it('refuses to replace a formula with a constant and says which cell', async () => {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await templateBytes())
    // A template that computes its own TABS bill payment.
    workbook.worksheets[0].getCell('D5').value = { formula: 'D8*0', result: 0 }
    const bytes = (await workbook.xlsx.writeBuffer()) as ArrayBuffer

    const result = await fillDailyTemplate(bytes, FIGURES)

    expect(result.skippedFormulas).toContain('D5')
    expect(result.warnings.join(' ')).toContain('D5')
    expect((await reload(result.bytes)).getCell('D5').value).toHaveProperty('formula')
  })

  it('writes the report date beside its label', async () => {
    const sheet = await reload((await fillDailyTemplate(await templateBytes(), FIGURES)).bytes)
    expect(sheet.getCell('D3').value).toEqual(new Date(Date.UTC(2026, 8, 13)))
  })

  it('reports which cells it wrote', async () => {
    const result = await fillDailyTemplate(await templateBytes(), FIGURES)

    expect(result.written).toContain('D8 = 2289.98')
    expect(result.written).toContain('B12 = 1190.2')
    expect(result.warnings).toEqual([])
  })

  it('warns about a row the template does not carry instead of failing', async () => {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await templateBytes())
    workbook.worksheets[0].getCell('B7').value = 'Something Else'
    const bytes = (await workbook.xlsx.writeBuffer()) as ArrayBuffer

    const result = await fillDailyTemplate(bytes, FIGURES)
    expect(result.warnings.join(' ')).toContain('Total Cash Collection')
  })

  it('refuses a workbook that is not this template at all', async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('S').getCell('A1').value = 'unrelated'
    const bytes = (await workbook.xlsx.writeBuffer()) as ArrayBuffer

    await expect(fillDailyTemplate(bytes, FIGURES)).rejects.toThrow(TemplateFillError)
  })
})

describe('reassignVisaToMastercard', () => {
  const figures = buildDailyFigures({ caco: caco(CACO_ROWS), tabs: tabs(), mada: mada() })

  it('moves the Visa figure into the MasterCard column', () => {
    const corrected = reassignVisaToMastercard(figures)

    expect(corrected.cards).toEqual({ mada: 1190.2, visa: 0, mastercard: 590.59 })
  })

  it('adds to a MasterCard figure that is already there', () => {
    const corrected = reassignVisaToMastercard(
      buildDailyFigures({ mada: mada({ mada: 0, visa: 100, mastercard: 37.26 }) }),
    )

    expect(corrected.cards.mastercard).toBe(137.26)
  })

  it('leaves the cash deposit alone, since the card total is unchanged', () => {
    expect(reassignVisaToMastercard(figures).cashDeposit).toBe(figures.cashDeposit)
  })

  it('leaves the sales figures alone', () => {
    const corrected = reassignVisaToMastercard(figures)

    expect(corrected.totalSales).toBe(figures.totalSales)
    expect(corrected.bss).toEqual(figures.bss)
    expect(corrected.tabs).toEqual(figures.tabs)
  })
})

describe('the showroom and supervisor', () => {
  it('writes the chosen pair into the template head', async () => {
    const result = await fillDailyTemplate(await templateBytes(), FIGURES, {
      showroom: 'العزيزية',
      supervisor: 'خالد',
    })
    const sheet = await reload(result.bytes)

    expect(sheet.getCell('B2').value).toBe('العزيزية')
    expect(sheet.getCell('B3').value).toBe('خالد')
  })

  it('leaves the template as it is when nothing was chosen', async () => {
    const sheet = await reload((await fillDailyTemplate(await templateBytes(), FIGURES)).bytes)

    expect(sheet.getCell('B2').value).toBe('الشرائع')
    expect(sheet.getCell('B3').value).toBe('باسم العولقي')
  })

  it('ignores a blank choice rather than emptying the template cell', async () => {
    const result = await fillDailyTemplate(await templateBytes(), FIGURES, {
      showroom: '   ',
      supervisor: '',
    })

    expect((await reload(result.bytes)).getCell('B2').value).toBe('الشرائع')
  })

  it('writes the shop code the sources came from', async () => {
    const result = await fillDailyTemplate(await templateBytes(), FIGURES, {
      shopId: 'WFW430',
    })

    expect((await reload(result.bytes)).getCell('D2').value).toBe('WFW430')
  })

  it('leaves the template shop code alone when the sources named none', async () => {
    const result = await fillDailyTemplate(await templateBytes(), FIGURES, { shopId: null })

    expect((await reload(result.bytes)).getCell('D2').value).toBe('FW430')
  })

  it('trims the name it writes', async () => {
    const result = await fillDailyTemplate(await templateBytes(), FIGURES, {
      showroom: '  العزيزية  ',
      supervisor: 'خالد',
    })

    expect((await reload(result.bytes)).getCell('B2').value).toBe('العزيزية')
  })
})

/**
 * The real shape of a cancelled sale: the original row stays in the export,
 * marked Superseded, and a Refund row on the same line carries the money back
 * out — as it did on 20 Aug, where 50.00 went out at 9:43 and came back at
 * 10:17 against the same MSISDN.
 */
const withRefund = (
  original: { orderType: string; amount: number; msisdn: string },
  refund: { amount: number; msisdn: string },
): CacoDetailed => {
  const base = detailed([])
  const row = (over: Partial<CacoTransaction>): CacoTransaction => ({
    ...detailed([['x', 0]]).transactions[0],
    ...over,
  })
  return {
    ...base,
    transactions: [
      row({
        orderType: original.orderType,
        amount: original.amount,
        msisdn: original.msisdn,
        status: 'Superseded',
        paymentMethod: 'SPAN Offline',
      }),
      row({ orderType: 'Refund', amount: refund.amount, msisdn: refund.msisdn }),
    ],
  }
}

describe('refunds against a superseded sale', () => {
  it('takes the refund off the row its original sale was counted in', () => {
    const figures = buildDailyFigures({
      detailed: withRefund(
        { orderType: 'Setup Fee Prepaid', amount: 50, msisdn: '966501342646' },
        { amount: -50, msisdn: '966501342646' },
      ),
    })

    expect(figures.bss.ordering).toBe(0)
  })

  it('takes it off the bill payment row when that is what was reversed', () => {
    const figures = buildDailyFigures({
      detailed: withRefund(
        { orderType: 'Invoice Payment', amount: 50, msisdn: '966501342646' },
        { amount: -50, msisdn: '966501342646' },
      ),
    })

    expect(figures.bss).toEqual({ billPayment: 0, ordering: 0, cashSales: 0 })
  })

  it('deducts a refund the export wrote without its minus sign', () => {
    const figures = buildDailyFigures({
      detailed: withRefund(
        { orderType: 'Setup Fee Prepaid', amount: 50, msisdn: '966501342646' },
        { amount: 50, msisdn: '966501342646' },
      ),
    })

    expect(figures.bss.ordering).toBe(0)
  })

  it('nets it off the summary too, which reports its refunds in a row of their own', () => {
    const detailedWithRefund = withRefund(
      { orderType: 'Setup Fee Prepaid', amount: 50, msisdn: '966501342646' },
      { amount: -50, msisdn: '966501342646' },
    )
    const figures = buildDailyFigures({
      caco: caco([
        { orderType: 'Sales Order Payment', total: 1411.16 },
        { orderType: 'Refund', total: -50 },
      ]),
      detailed: detailedWithRefund,
    })

    expect(figures.bss.ordering).toBe(1361.16)
  })

  it('leaves a refund whose original is not in the day alone, and says so', () => {
    const sources = {
      detailed: withRefund(
        { orderType: 'Setup Fee Prepaid', amount: 50, msisdn: '966501342646' },
        { amount: -50, msisdn: '966509999999' },
      ),
    }

    expect(buildDailyFigures(sources).bss.ordering).toBe(50)
    expect(refundSummary(sources).unplaced[0]).toContain('لم يُعثر على عمليته الأصلية')
    expect(refundSummary(sources).deducted).toBe(0)
  })

  it('does not reverse a sale twice with one refund each', () => {
    const base = detailed([])
    const row = (over: Partial<CacoTransaction>): CacoTransaction => ({
      ...detailed([['x', 0]]).transactions[0],
      ...over,
    })
    const figures = buildDailyFigures({
      detailed: {
        ...base,
        transactions: [
          row({ orderType: 'Setup Fee', amount: 50, msisdn: '9665', status: 'Superseded' }),
          row({ orderType: 'Setup Fee', amount: 50, msisdn: '9665' }),
          row({ orderType: 'Refund', amount: -50, msisdn: '9665' }),
        ],
      },
    })

    expect(figures.bss.ordering).toBe(50)
  })

  it('takes the summary\u2019s own refund row off ordering when it stands alone', () => {
    const sources = {
      caco: caco([
        { orderType: 'Sales Order Payment', total: 1411.16 },
        { orderType: 'Invoice Payment', total: 2289.98 },
        { orderType: 'Refund', total: -50 },
      ]),
    }

    expect(buildDailyFigures(sources).bss).toEqual({
      billPayment: 2289.98,
      ordering: 1361.16,
      cashSales: 0,
    })
    expect(refundSummary(sources).deducted).toBe(50)
  })

  it('deducts a summary refund row the export wrote without its minus sign', () => {
    const figures = buildDailyFigures({
      caco: caco([
        { orderType: 'Sales Order Payment', total: 1411.16 },
        { orderType: 'Refund', total: 50 },
      ]),
    })

    expect(figures.bss.ordering).toBe(1361.16)
  })

  it('leaves the figures alone when the summary reports no refund', () => {
    const sources = { caco: caco(CACO_ROWS) }

    expect(buildDailyFigures(sources).bss.ordering).toBe(1411.16)
    expect(refundSummary(sources)).toEqual({ deducted: 0, unplaced: [] })
  })

  it('prefers the detailed export over the summary assumption', () => {
    const sources = {
      caco: caco([
        { orderType: 'Invoice Payment', total: 2339.98 },
        { orderType: 'Sales Order Payment', total: 1411.16 },
        { orderType: 'Refund', total: -50 },
      ]),
      detailed: withRefund(
        { orderType: 'Invoice Payment', amount: 50, msisdn: '966501342646' },
        { amount: -50, msisdn: '966501342646' },
      ),
    }

    // Off bill payment, where the detailed export says the sale was, and not
    // off ordering, which is only where a lone summary would have put it.
    expect(buildDailyFigures(sources).bss).toEqual({
      billPayment: 2289.98,
      ordering: 1411.16,
      cashSales: 0,
    })
  })

  it('reports what it deducted, for showing beside the figures', () => {
    const summary = refundSummary({
      detailed: withRefund(
        { orderType: 'Setup Fee Prepaid', amount: 50, msisdn: '966501342646' },
        { amount: -50, msisdn: '966501342646' },
      ),
    })

    expect(summary).toEqual({ deducted: 50, unplaced: [] })
  })

  it('counts the summary row only when the detailed export is not there', () => {
    const summary = refundSummary({
      caco: caco([{ orderType: 'Refund', total: -50 }]),
      detailed: withRefund(
        { orderType: 'Setup Fee Prepaid', amount: 50, msisdn: '966501342646' },
        { amount: -50, msisdn: '966501342646' },
      ),
    })

    expect(summary.deducted).toBe(50)
  })
})

describe('what the file shows before Excel recalculates it', () => {
  it('replaces the template\u2019s remembered totals with this day\u2019s', async () => {
    const sheet = await reload((await fillDailyTemplate(await templateBytes(), FIGURES)).bytes)

    expect(sheet.getCell('E12').value).toMatchObject({
      formula: 'SUM(D5:D10)',
      result: FIGURES.totalSales,
    })
    expect(sheet.getCell('A12').value).toMatchObject({
      formula: 'E12-D12-C12-B12',
      result: FIGURES.cashDeposit,
    })
  })

  /*
   * A desktop opens a downloaded file in Protected View, which shows it without
   * calculating it. Left alone, the totals read as the template's old ones —
   * 12,228.84 against rows adding to 1,480.00 — while a phone, which does
   * calculate on open, showed the right figure from the same file.
   */
  it('asks Excel to work every formula out again on open', async () => {
    const { bytes } = await fillDailyTemplate(await templateBytes(), FIGURES)
    // Read from the file itself: exceljs does not report this setting back.
    const { unzipSync, strFromU8 } = await import('fflate')
    const workbookXml = strFromU8(unzipSync(new Uint8Array(bytes))['xl/workbook.xml'])

    expect(workbookXml).toContain('fullCalcOnLoad="1"')
  })

  it('leaves a formula it has no figure for with nothing remembered', async () => {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await templateBytes())
    workbook.worksheets[0].getCell('E13').value = { formula: 'E12*2', result: 99999 }
    const stale = (await workbook.xlsx.writeBuffer()) as ArrayBuffer

    const sheet = await reload((await fillDailyTemplate(stale, FIGURES)).bytes)

    expect(sheet.getCell('E13').value).toMatchObject({ formula: 'E12*2' })
    expect((sheet.getCell('E13').value as { result?: number }).result).toBeUndefined()
  })
})
