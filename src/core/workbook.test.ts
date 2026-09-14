import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { parseCsv, readWorkbook, UnsupportedFileError } from './workbook'

async function buildXlsx(
  build: (workbook: ExcelJS.Workbook) => void,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook()
  build(workbook)
  const buffer = await workbook.xlsx.writeBuffer()
  return buffer as ArrayBuffer
}

const toArrayBuffer = (bytes: Uint8Array) => bytes.slice().buffer as ArrayBuffer

describe('readWorkbook', () => {
  it('reads cells as a dense 0-indexed matrix', async () => {
    const bytes = await buildXlsx((wb) => {
      const sheet = wb.addWorksheet('Sales')
      sheet.getCell('A1').value = 'الفرع'
      sheet.getCell('B1').value = 'المبلغ'
      sheet.getCell('A2').value = 'الرياض'
      sheet.getCell('B2').value = 1500
    })

    const sheets = await readWorkbook('report.xlsx', bytes)
    expect(sheets).toHaveLength(1)
    expect(sheets[0].name).toBe('Sales')
    expect(sheets[0].rows[0]).toEqual(['الفرع', 'المبلغ'])
    expect(sheets[0].rows[1]).toEqual(['الرياض', 1500])
  })

  it('reads a formula cell as its cached result', async () => {
    const bytes = await buildXlsx((wb) => {
      const sheet = wb.addWorksheet('Totals')
      sheet.getCell('A1').value = 10
      sheet.getCell('A2').value = 20
      sheet.getCell('A3').value = { formula: 'SUM(A1:A2)', result: 30 }
    })

    const sheets = await readWorkbook('totals.xlsx', bytes)
    expect(sheets[0].rows[2][0]).toBe(30)
  })

  it('flattens rich text to plain text', async () => {
    const bytes = await buildXlsx((wb) => {
      const sheet = wb.addWorksheet('S')
      sheet.getCell('A1').value = {
        richText: [{ text: 'صافي ' }, { text: 'المبيعات' }],
      }
    })

    const sheets = await readWorkbook('rich.xlsx', bytes)
    expect(sheets[0].rows[0][0]).toBe('صافي المبيعات')
  })

  it('pads a short row so column positions stay aligned', async () => {
    const bytes = await buildXlsx((wb) => {
      const sheet = wb.addWorksheet('S')
      sheet.getCell('A1').value = 'a'
      sheet.getCell('C1').value = 'c'
      sheet.getCell('A2').value = 'only-a'
    })

    const sheets = await readWorkbook('gaps.xlsx', bytes)
    expect(sheets[0].rows[0]).toEqual(['a', null, 'c'])
    expect(sheets[0].rows[1]).toEqual(['only-a', null, null])
  })

  it('reads every worksheet in the file', async () => {
    const bytes = await buildXlsx((wb) => {
      wb.addWorksheet('Summary').getCell('A1').value = 's'
      wb.addWorksheet('Detailed').getCell('A1').value = 'd'
    })

    const sheets = await readWorkbook('multi.xlsx', bytes)
    expect(sheets.map((s) => s.name)).toEqual(['Summary', 'Detailed'])
  })

  it('tells the user to convert a legacy .xls file', async () => {
    const ole2 = toArrayBuffer(
      new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00]),
    )
    await expect(readWorkbook('old.xls', ole2)).rejects.toThrow(UnsupportedFileError)
    await expect(readWorkbook('old.xls', ole2)).rejects.toThrow(/\.xlsx/)
  })

  it('rejects a file that is not a workbook at all', async () => {
    const text = toArrayBuffer(new TextEncoder().encode('this is not a workbook'))
    await expect(readWorkbook('notes.txt', text)).rejects.toThrow(UnsupportedFileError)
  })

  it('reads a .csv upload', async () => {
    const csv = toArrayBuffer(new TextEncoder().encode('الفرع,المبلغ\nالرياض,1500\n'))
    const sheets = await readWorkbook('report.csv', csv)
    expect(sheets[0].rows).toEqual([
      ['الفرع', 'المبلغ'],
      ['الرياض', '1500'],
    ])
  })
})

describe('parseCsv', () => {
  it('keeps commas and newlines inside quoted fields', () => {
    expect(parseCsv('a,"b,c"\n"line1\nline2",d')).toEqual([
      ['a', 'b,c'],
      ['line1\nline2', 'd'],
    ])
  })

  it('unescapes a doubled quote', () => {
    expect(parseCsv('"he said ""hi""",x')).toEqual([['he said "hi"', 'x']])
  })

  it('represents an empty field as null', () => {
    expect(parseCsv('a,,c')).toEqual([['a', null, 'c']])
  })

  it('does not emit a trailing record for a final newline', () => {
    expect(parseCsv('a,b\n')).toEqual([['a', 'b']])
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('strips a UTF-8 BOM from the first header cell', () => {
    expect(parseCsv('﻿الفرع,المبلغ')).toEqual([['الفرع', 'المبلغ']])
  })
})
