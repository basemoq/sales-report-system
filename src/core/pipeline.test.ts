import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { buildReport, NoDataError, type UploadedFile } from './pipeline'
import { LocationConflictError } from './sources/shoor'

async function shoorUpload(
  fileName: string,
  shopId: string,
  location: string,
  rows: (string | number)[][],
): Promise<UploadedFile> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Sheet1')
  sheet.addRow(['Shop ID:', shopId])
  sheet.addRow(['الموقع:', location])
  sheet.addRow([])
  sheet.addRow(['التاريخ', 'المبلغ', 'الموظف', 'عدد العمليات'])
  for (const row of rows) sheet.addRow(row)
  return { fileName, bytes: (await workbook.xlsx.writeBuffer()) as ArrayBuffer }
}

const RIYADH_ROWS = [
  ['2025-03-01', 1000, 'أحمد', 5],
  ['2025-03-31', 1500, 'سالم', 7],
]

describe('buildReport', () => {
  it('identifies the report by the latest date it covers', async () => {
    const report = await buildReport([
      await shoorUpload('riyadh.xlsx', '101', 'الرياض', RIYADH_ROWS),
    ])

    expect(report.reportId).toBe('2025-03-31')
    expect(report.periodKey).toBe('2025-03')
  })

  it('aggregates locations and employees from the batch', async () => {
    const report = await buildReport([
      await shoorUpload('riyadh.xlsx', '101', 'الرياض', RIYADH_ROWS),
      await shoorUpload('jeddah.xlsx', '102', 'جدة', [['2025-03-01', 800, 'خالد', 4]]),
    ])

    expect(report.locations.map((l) => l.total)).toEqual([2500, 800])
    expect(report.employees.map((e) => e.employee)).toEqual(['سالم', 'أحمد', 'خالد'])
  })

  it('skips a file whose bytes were ingested before, and says so', async () => {
    const upload = await shoorUpload('riyadh.xlsx', '101', 'الرياض', RIYADH_ROWS)
    const first = await buildReport([upload])
    const stored = new Map(first.ingested.map((f) => [f.hash, f.fileName]))

    const second = await buildReport(
      [
        { ...upload, fileName: 'riyadh-copy.xlsx' },
        await shoorUpload('jeddah.xlsx', '102', 'جدة', [['2025-03-02', 800, 'خالد', 4]]),
      ],
      stored,
    )

    expect(second.duplicates).toHaveLength(1)
    expect(second.duplicates[0].firstSeenAs).toBe('riyadh.xlsx')
    expect(second.locations.map((l) => l.shopId)).toEqual(['102'])
  })

  it('refuses a batch in which every file was already ingested', async () => {
    const upload = await shoorUpload('riyadh.xlsx', '101', 'الرياض', RIYADH_ROWS)
    const first = await buildReport([upload])
    const stored = new Map(first.ingested.map((f) => [f.hash, f.fileName]))

    await expect(buildReport([upload], stored)).rejects.toThrow(NoDataError)
  })

  it('skips a file repeated twice within one upload', async () => {
    const upload = await shoorUpload('riyadh.xlsx', '101', 'الرياض', RIYADH_ROWS)
    const report = await buildReport([upload, { ...upload, fileName: 'copy.xlsx' }])

    expect(report.duplicates).toHaveLength(1)
    expect(report.locations[0].total).toBe(2500)
  })

  it('produces nothing when the batch contradicts itself about a shop', async () => {
    await expect(
      buildReport([
        await shoorUpload('a.xlsx', '101', 'الرياض', [['2025-03-01', 100, 'أ', 1]]),
        await shoorUpload('b.xlsx', '101', 'جدة', [['2025-03-02', 200, 'ب', 1]]),
      ]),
    ).rejects.toThrow(LocationConflictError)
  })

  it('refuses a batch with no dated rows to identify it by', async () => {
    await expect(
      buildReport([await shoorUpload('a.xlsx', '101', 'الرياض', [['الإجمالي', 100, 'أ', 1]])]),
    ).rejects.toThrow(NoDataError)
  })

  it('reports the fingerprints it ingested so they can be recorded', async () => {
    const report = await buildReport([
      await shoorUpload('riyadh.xlsx', '101', 'الرياض', RIYADH_ROWS),
    ])

    expect(report.ingested).toHaveLength(1)
    expect(report.ingested[0].fileName).toBe('riyadh.xlsx')
    expect(report.ingested[0].hash).toMatch(/^[0-9a-f]{64}$/)
  })
})
