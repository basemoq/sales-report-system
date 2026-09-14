import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { buildDailyReport, NoDataError, type UploadedFile } from './pipeline'

async function workbookUpload(
  fileName: string,
  build: (sheet: ExcelJS.Worksheet) => void,
): Promise<UploadedFile> {
  const workbook = new ExcelJS.Workbook()
  build(workbook.addWorksheet('Sheet'))
  return { fileName, bytes: (await workbook.xlsx.writeBuffer()) as ArrayBuffer }
}

function parameterBand(sheet: ExcelJS.Worksheet, shopId = 'WFW430') {
  sheet.getCell('A5').value = 'Transaction Date & Time From'
  sheet.getCell('B5').value = 'Sep 13,2026 00:00'
  sheet.getCell('A6').value = 'Transaction Date & Time To'
  sheet.getCell('B6').value = 'Sep 13,2026 23:59'
  sheet.getCell('A7').value = 'Shop ID'
  sheet.getCell('B7').value = shopId
}

const cacoSummary = (fileName = 'summary.xlsx', shopId = 'WFW430') =>
  workbookUpload(fileName, (sheet) => {
    sheet.getCell('A1').value = 'Finance CACO report (summary)'
    parameterBand(sheet, shopId)
    sheet.getCell('A10').value = 'PAYMENT_ORDER_TYPE'
    sheet.getCell('B10').value = 'Cash'
    sheet.getCell('C10').value = 'SPAN Offline'
    const rows: [string, number, number][] = [
      ['Top Up', 235, 188],
      ['Invoice Payment', 2048.39, 241.59],
      ['Sales Order Payment', 230.36, 1180.8],
      ['total', 2513.75, 1610.39],
    ]
    rows.forEach(([label, cash, span], index) => {
      const row = 11 + index
      sheet.getCell(`A${row}`).value = label
      sheet.getCell(`B${row}`).value = cash
      sheet.getCell(`C${row}`).value = span
    })
  })

const DETAILED_HEADER = [
  'User ID', 'User Full Name', 'Manager', 'Shop ID', 'Time', 'Date',
  'Receipt No', 'Amount', 'Payment Method', 'Payment Order type/Description',
]

const cacoDetailed = (
  transactions: [string, number, string][] = [
    ['mansour.alremy', 1610.39, 'SPAN Offline'],
    ['Basem.Alawalgy', 2513.75, 'Cash'],
  ],
  total: number | null = 4124.14,
  fileName = 'detailed.xlsx',
) =>
  workbookUpload(fileName, (sheet) => {
    sheet.getCell('A1').value = 'Finance CACO report (detailed)'
    parameterBand(sheet)
    sheet.getRow(12).values = DETAILED_HEADER
    transactions.forEach(([userId, amount, method], index) => {
      sheet.getRow(13 + index).values = [
        userId, userId, 'Hussain.Khorma', 'WFW430', '5:38 PM', '13-Sep-2026',
        `ZN_${index}`, amount, method, 'Setup Fee',
      ]
    })
    if (total !== null) {
      sheet.getRow(13 + transactions.length).values = ['Total amount:', total]
    }
  })

const textUpload = (fileName: string, text: string): UploadedFile => ({
  fileName,
  bytes: new TextEncoder().encode(text).slice().buffer as ArrayBuffer,
})

describe('buildDailyReport', () => {
  it('identifies the report by the day its sources cover', async () => {
    const report = await buildDailyReport([await cacoSummary()])

    expect(report.reportId).toBe('2026-09-13')
    expect(report.periodKey).toBe('2026-09')
  })

  it('recognises each upload by its content, not its name', async () => {
    const report = await buildDailyReport([
      await cacoSummary('export-1.xlsx'),
      await cacoDetailed(undefined, 4124.14, 'export-2.xlsx'),
    ])

    expect(report.sources.map((source) => [source.fileName, source.kind])).toEqual([
      ['export-1.xlsx', 'caco-summary'],
      ['export-2.xlsx', 'caco-detailed'],
    ])
  })

  it('fills the BSS rows from the summary export', async () => {
    const report = await buildDailyReport([await cacoSummary()])

    expect(report.figures.bss).toEqual({
      billPayment: 2289.98,
      ordering: 1411.16,
      cashSales: 423,
    })
  })

  it('builds the employee breakdown from the detailed export', async () => {
    const report = await buildDailyReport([await cacoDetailed()])

    expect(report.employees.map((e) => [e.userId, e.total])).toEqual([
      ['Basem.Alawalgy', 2513.75],
      ['mansour.alremy', 1610.39],
    ])
  })

  it('warns about each source that was not uploaded', async () => {
    const report = await buildDailyReport([await cacoSummary()])
    const warnings = report.warnings.join(' ')

    expect(warnings).toContain('TABS')
    expect(warnings).toContain('مدى')
  })

  it('warns when the two CACO exports disagree on the day total', async () => {
    const report = await buildDailyReport([
      await cacoSummary(),
      await cacoDetailed([['someone', 999, 'Cash']], 999),
    ])

    expect(report.warnings.join(' ')).toContain('لا يطابق مجموع المفصّل')
  })

  it('warns when the detailed rows do not add up to its own printed total', async () => {
    const report = await buildDailyReport([await cacoDetailed(undefined, 9999)])

    expect(report.warnings.join(' ')).toContain('لا يطابق الإجمالي المطبوع')
  })

  it('warns when the two exports are for different shops', async () => {
    const report = await buildDailyReport([
      await cacoSummary('summary.xlsx', 'WFW999'),
      await cacoDetailed(),
    ])

    expect(report.warnings.join(' ')).toContain('فرعين مختلفين')
  })

  it('reports a file it does not recognise rather than guessing', async () => {
    const report = await buildDailyReport([
      await cacoSummary(),
      await workbookUpload('mystery.xlsx', (sheet) => {
        sheet.getCell('A1').value = 'Some other report'
      }),
    ])

    expect(report.unrecognised).toHaveLength(1)
    expect(report.unrecognised[0].fileName).toBe('mystery.xlsx')
    expect(report.unrecognised[0].reason).toContain('CACO')
  })

  it('refuses a batch in which nothing was recognised', async () => {
    await expect(
      buildDailyReport([
        await workbookUpload('a.xlsx', (sheet) => {
          sheet.getCell('A1').value = 'nope'
        }),
      ]),
    ).rejects.toThrow(NoDataError)
  })

  it('skips a file whose bytes were ingested before', async () => {
    const upload = await cacoSummary()
    const first = await buildDailyReport([upload])
    const stored = new Map(first.sources.map((s) => [s.hash, s.fileName]))

    const second = await buildDailyReport([{ ...upload, fileName: 'copy.xlsx' }, await cacoDetailed()], stored)

    expect(second.duplicates).toHaveLength(1)
    expect(second.duplicates[0].firstSeenAs).toBe('summary.xlsx')
    expect(second.sources.map((s) => s.kind)).toEqual(['caco-detailed'])
  })

  it('refuses a batch in which every file was already ingested', async () => {
    const upload = await cacoSummary()
    const first = await buildDailyReport([upload])
    const stored = new Map(first.sources.map((s) => [s.hash, s.fileName]))

    await expect(buildDailyReport([upload], stored)).rejects.toThrow(NoDataError)
  })

  it('reports a PDF that is neither of the two known reports', async () => {
    const report = await buildDailyReport([
      await cacoSummary(),
      textUpload('scan.pdf', '%PDF-1.4\nnot a real report'),
    ])

    expect(report.unrecognised[0].reason).toContain('PDF')
  })
})
