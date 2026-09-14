import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import {
  buildDailyFigures,
  fillDailyTemplate,
  reassignVisaToMastercard,
  TemplateFillError,
  type DailyFigures,
} from './dailyReport'
import type { CacoSummary } from './sources/caco'
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
  sheet.getCell('A12').value = { formula: 'E12-D12-C12-B12', result: 0 }
  sheet.getCell('E12').value = { formula: 'SUM(D5:D10)', result: 0 }

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

