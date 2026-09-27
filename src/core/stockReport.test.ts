/// <reference types="node" />
import { readFileSync } from 'node:fs'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { fillStockTemplate, parseCount, readStockLayout } from './stockReport'
import { stockFileName } from '../ui/format'

/** The template the app ships, read from disk as the build would carry it. */
function shipped(): ArrayBuffer {
  const file = readFileSync(new URL('../assets/stock-template.xlsx', import.meta.url))
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer
}

async function reload(bytes: ArrayBuffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes)
  return workbook.worksheets[0]
}

describe('the stock sheet', () => {
  it('reads its devices from the template header, in order, between SHOP and Comments', async () => {
    const layout = await readStockLayout(shipped())

    expect(layout.shopColumn).toBe(1)
    expect(layout.commentsColumn).toBe(16)
    expect(layout.devices.map((device) => device.label)).toEqual([
      'BSS- Router', 'Gaming Router', 'Router Black', 'Mesh Black', 'MI FI', 'Mesh',
      'IPHONE 17 PRO MAX', 'IPHONE 17 PRO', 'IPHONE 17',
      'SAMSUNG S26 ULTRA 256GB', 'SAMSUNG S26 plus 256GB', 'SAMSUNG S26 256GB',
      'SAM A36', 'SAM A56',
    ])
  })

  it('ships blank: no shop and no count in the data row', async () => {
    const sheet = await reload(shipped())
    for (let column = 1; column <= 16; column++) {
      expect(sheet.getCell(2, column).value ?? null).toBeNull()
    }
  })

  it('writes the shop, the counts and the comment into the second row', async () => {
    const layout = await readStockLayout(shipped())
    const header = (label: string) => layout.devices.find((device) => device.label === label)!.header
    const { bytes, counted } = await fillStockTemplate(shipped(), {
      shopId: 'WFW430',
      counts: { [header('BSS- Router')]: 13, [header('Gaming Router')]: 1, [header('Mesh Black')]: 0 },
      comments: '  راوتر تالف واحد  ',
    })
    const sheet = await reload(bytes)

    expect(counted).toBe(3)
    expect(sheet.getCell('A2').value).toBe('WFW430')
    expect(sheet.getCell('B2').value).toBe(13)
    expect(sheet.getCell('C2').value).toBe(1)
    // A typed zero is a count; an untouched device stays empty.
    expect(sheet.getCell('E2').value).toBe(0)
    expect(sheet.getCell('D2').value ?? null).toBeNull()
    expect(sheet.getCell('P2').value).toBe('راوتر تالف واحد')
  })

  it('keeps the sheet as the region lays it out: headers, colours and widths', async () => {
    const { bytes } = await fillStockTemplate(shipped(), { shopId: 'WFW430', counts: {}, comments: '' })
    const before = await reload(shipped())
    const after = await reload(bytes)

    for (let column = 1; column <= 16; column++) {
      expect(after.getCell(1, column).value).toEqual(before.getCell(1, column).value)
      expect(after.getCell(1, column).fill).toEqual(before.getCell(1, column).fill)
      expect(after.getColumn(column).width).toBe(before.getColumn(column).width)
    }
  })

  it('takes whole counts only, Arabic-Indic digits included', () => {
    expect(parseCount('')).toBeNull()
    expect(parseCount(' 12 ')).toBe(12)
    expect(parseCount('١٣')).toBe(13)
    expect(parseCount('0')).toBe(0)
    expect(parseCount('2.5')).toBe('invalid')
    expect(parseCount('-1')).toBe('invalid')
    expect(parseCount('abc')).toBe('invalid')
  })

  it('names the file in Latin, by shop and day', () => {
    expect(stockFileName('WFW430', '2026-09-26')).toBe('stock-WFW430-2026-09-26.xlsx')
    expect(stockFileName(null, '2026-09-26')).toBe('stock-2026-09-26.xlsx')
  })
})
