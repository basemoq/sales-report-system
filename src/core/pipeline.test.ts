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

/** A row is [user, amount, payment method, order description]. */
const cacoDetailed = (
  transactions: [string, number, string, string?][] = [
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
    transactions.forEach(([userId, amount, method, description], index) => {
      sheet.getRow(13 + index).values = [
        userId, userId, 'Hussain.Khorma', 'WFW430', '5:38 PM', '13-Sep-2026',
        `ZN_${index}`, amount, method, description ?? 'Setup Fee',
      ]
    })
    if (total !== null) {
      sheet.getRow(13 + transactions.length).values = ['Total amount:', total]
    }
  })

/**
 * A detailed export where rows carry the line they were sold against, which is
 * what ties a refund to the sale it reverses.
 *
 * Rows are [user, amount, MSISDN, description].
 */
const cacoDetailedWithLines = (
  rows: [string, number, string, string][],
  total: number | null = null,
) =>
  workbookUpload('detailed-lines.xlsx', (sheet) => {
    sheet.getCell('A1').value = 'Finance CACO report (detailed)'
    parameterBand(sheet)
    sheet.getRow(12).values = [...DETAILED_HEADER, 'Sub no (MSISDN)']
    rows.forEach(([userId, amount, msisdn, description], index) => {
      sheet.getRow(13 + index).values = [
        userId, userId, 'Hussain.Khorma', 'WFW430', '5:38 PM', '13-Sep-2026',
        `ZN_${index}`, amount, 'Cash', description, msisdn,
      ]
    })
    if (total !== null) {
      sheet.getRow(13 + rows.length).values = ['Total amount:', total]
    }
  })

const textUpload = (fileName: string, text: string): UploadedFile => ({
  fileName,
  bytes: new TextEncoder().encode(text).slice().buffer as ArrayBuffer,
})

describe('buildDailyReport', () => {
  it('identifies the report by the shop and the day its sources cover', async () => {
    const report = await buildDailyReport([await cacoSummary()])

    expect(report.reportId).toBe('WFW430-2026-09-13')
    expect(report.reportDate).toBe('2026-09-13')
    expect(report.periodKey).toBe('2026-09')
  })

  it('keeps two showrooms reporting the same day apart', async () => {
    const riyadh = await buildDailyReport([await cacoSummary('a.xlsx', 'WFW430')])
    const jeddah = await buildDailyReport([await cacoSummary('b.xlsx', 'WFW999')])

    expect(riyadh.reportId).not.toBe(jeddah.reportId)
    expect(riyadh.reportDate).toBe(jeddah.reportDate)
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

  it('names a re-upload after itself, not after the copy it was read from', async () => {
    // What a file turned out to be is kept by its content, so adding a second
    // photograph does not re-read the first. The name is not part of that: the
    // same bytes can arrive again called something else.
    await buildDailyReport([await cacoSummary('first-name.xlsx')])
    const again = await buildDailyReport([await cacoSummary('second-name.xlsx')])

    expect(again.sources.map((source) => source.fileName)).toEqual(['second-name.xlsx'])
  })

  it('carries no photographs when the day held none', async () => {
    // The pictures are kept so a figure the scan could not read can be typed in
    // beside them; a workbook has none.
    const report = await buildDailyReport([await cacoSummary()])

    expect(report.receiptImages).toEqual([])
  })

  it('fills the BSS rows from the summary export', async () => {
    const report = await buildDailyReport([await cacoSummary()])

    expect(report.figures.bss).toEqual({
      billPayment: 2289.98,
      ordering: 1411.16,
      cashSales: 423,
    })
  })

  it('takes a reversed sale off the person who made it, not off whoever refunded it', async () => {
    // A cancelled order is refunded by a central operations login rather than by
    // the salesperson. Left as the export has it, the seller keeps credit for a
    // sale that was undone and the operations account shows up as an employee
    // in the red.
    const report = await buildDailyReport([
      await cacoDetailedWithLines([
        ['ABDULLAH.YOUSEF', 40.25, '966590000953', 'SIM Replacement Fee'],
        ['ABDULLAH.YOUSEF', 100, '966500000001', 'Setup Fee'],
        ['zainops', -40.25, '966590000953', 'Refund'],
      ]),
    ])

    expect(report.employees.map((e) => [e.userId, e.total])).toEqual([
      ['ABDULLAH.YOUSEF', 100],
    ])
    // The day's total is the same either way — the pair cancels.
    expect(report.figures.totalSales).toBe(100)
  })

  it('leaves a refund whose sale was not found on whoever processed it', async () => {
    // Nothing says whose sale it reversed, so moving it would be a guess; it is
    // already reported as needing a person.
    const report = await buildDailyReport([
      await cacoDetailedWithLines([
        ['ABDULLAH.YOUSEF', 100, '966500000001', 'Setup Fee'],
        ['zainops', -40.25, '966599999999', 'Refund'],
      ]),
    ])

    expect(report.employees.map((e) => e.userId).sort()).toEqual([
      'ABDULLAH.YOUSEF',
      'zainops',
    ])
  })

  it('builds the employee breakdown from the detailed export', async () => {
    const report = await buildDailyReport([await cacoDetailed()])

    expect(report.employees.map((e) => [e.userId, e.total])).toEqual([
      ['Basem.Alawalgy', 2513.75],
      ['mansour.alremy', 1610.39],
    ])
  })

  it('lists the sources that were not uploaded without treating them as faults', async () => {
    const report = await buildDailyReport([await cacoSummary()])

    expect(report.missingSources).toEqual(['TABS', 'موازنة مدى'])
    // The one warning the summary alone earns: it carries no status column, so
    // a cancelled order cannot be told from a completed one in it.
    expect(report.warnings).toEqual([
      'تقرير CACO المختصر لا يحمل حالة أمر البيع، فلا يمكن كشف العمليات الملغاة (Superseded) منه — ارفع التقرير المفصّل للتأكد.',
    ])
  })

  it('completes without TABS, counting it as zero', async () => {
    const report = await buildDailyReport([await cacoSummary()])

    expect(report.figures.tabs).toEqual({ billPayment: 0, ordering: 0, cashCollection: 0 })
    expect(report.figures.totalSales).toBe(4124.14)
    expect(report.reportDate).toBe('2026-09-13')
  })

  it('reports the sales from the detailed export when no summary was uploaded', async () => {
    const report = await buildDailyReport([
      await cacoDetailed(
        [
          ['someone', 2289.98, 'Cash', 'Invoice Payment'],
          ['someone', 423, 'Cash', 'Top Up'],
          ['someone', 1411.16, 'Cash', 'Flex 109"Add/Remove Add-On"'],
        ],
        4124.14,
      ),
    ])

    expect(report.figures.bss).toEqual({
      billPayment: 2289.98,
      ordering: 1411.16,
      cashSales: 423,
    })
    expect(report.figures.date).not.toBeNull()
    expect(report.missingSources).toEqual(['TABS', 'موازنة مدى'])
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
