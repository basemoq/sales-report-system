import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TEMPLATE_SPEC, validateTemplate } from './template'

async function buildXlsx(build: (workbook: ExcelJS.Workbook) => void): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook()
  build(workbook)
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer
}

/** A template shaped the way a real one is: headers, data rows and a total formula. */
function validTemplate(workbook: ExcelJS.Workbook) {
  const sheet = workbook.addWorksheet('التقرير')
  sheet.getCell('A1').value = 'الموقع'
  sheet.getCell('B1').value = 'المبيعات'
  sheet.getCell('A2').value = 'الرياض'
  sheet.getCell('B2').value = 1000
  sheet.getCell('A3').value = 'الإجمالي'
  sheet.getCell('B3').value = { formula: 'SUM(B2:B2)', result: 1000 }
}

const errorsOf = (issues: { severity: string; message: string }[]) =>
  issues.filter((issue) => issue.severity === 'error')

describe('validateTemplate', () => {
  it('accepts a template carrying formulas and data rows', async () => {
    const result = await validateTemplate('template.xlsx', await buildXlsx(validTemplate))

    expect(result.valid).toBe(true)
    expect(errorsOf(result.issues)).toEqual([])
    expect(result.stats.sheetNames).toEqual(['التقرير'])
    expect(result.stats.formulaCells['التقرير']).toBe(1)
    expect(result.stats.populatedRows['التقرير']).toBe(3)
  })

  it('rejects an exported report that has values where formulas should be', async () => {
    const bytes = await buildXlsx((wb) => {
      const sheet = wb.addWorksheet('التقرير')
      sheet.getCell('A1').value = 'الموقع'
      sheet.getCell('A2').value = 'الرياض'
      sheet.getCell('B2').value = 1000
      sheet.getCell('B3').value = 1000 // a pasted total, not a formula
    })

    const result = await validateTemplate('exported.xlsx', bytes)
    expect(result.valid).toBe(false)
    expect(errorsOf(result.issues)[0].message).toMatch(/معادلات/)
  })

  it('rejects a truncated template that carries only a header row', async () => {
    const bytes = await buildXlsx((wb) => {
      const sheet = wb.addWorksheet('التقرير')
      sheet.getCell('A1').value = 'الموقع'
      sheet.getCell('B1').value = { formula: 'SUM(B2:B9)', result: 0 }
    })

    const result = await validateTemplate('truncated.xlsx', bytes)
    expect(result.valid).toBe(false)
    expect(errorsOf(result.issues).some((issue) => /صف/.test(issue.message))).toBe(true)
  })

  it('rejects a file that is not a workbook', async () => {
    const notExcel = new TextEncoder().encode('just text').slice().buffer as ArrayBuffer
    const result = await validateTemplate('notes.txt', notExcel)

    expect(result.valid).toBe(false)
    expect(errorsOf(result.issues)[0].message).toMatch(/\.xlsx/)
  })

  it('rejects a template missing a sheet the spec requires', async () => {
    const result = await validateTemplate('template.xlsx', await buildXlsx(validTemplate), {
      ...DEFAULT_TEMPLATE_SPEC,
      requiredSheets: ['التقرير', 'الموظفون'],
    })

    expect(result.valid).toBe(false)
    expect(errorsOf(result.issues)).toHaveLength(1)
    expect(errorsOf(result.issues)[0].message).toMatch(/الموظفون/)
  })

  it('matches a required sheet name regardless of case and padding', async () => {
    const bytes = await buildXlsx((wb) => {
      const sheet = wb.addWorksheet('  Summary  ')
      sheet.getCell('A1').value = 'x'
      sheet.getCell('A2').value = { formula: 'A1', result: 'x' }
      sheet.getCell('A3').value = 'y'
    })

    const result = await validateTemplate('t.xlsx', bytes, {
      ...DEFAULT_TEMPLATE_SPEC,
      requiredSheets: ['summary'],
    })
    expect(result.valid).toBe(true)
  })

  it('warns about an empty sheet without blocking the save', async () => {
    const bytes = await buildXlsx((wb) => {
      validTemplate(wb)
      wb.addWorksheet('ملاحظات')
    })

    const result = await validateTemplate('template.xlsx', bytes)
    expect(result.valid).toBe(true)
    expect(result.issues.some((i) => i.severity === 'warning' && /ملاحظات/.test(i.message))).toBe(
      true,
    )
  })

  it('does not count a whitespace-only cell as content', async () => {
    const bytes = await buildXlsx((wb) => {
      const sheet = wb.addWorksheet('التقرير')
      sheet.getCell('A1').value = '   '
      sheet.getCell('A2').value = { formula: 'A1', result: '' }
    })

    const result = await validateTemplate('blank.xlsx', bytes)
    expect(result.stats.populatedRows['التقرير']).toBe(1)
    expect(result.valid).toBe(false)
  })
})
