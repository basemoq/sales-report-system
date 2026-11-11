/// <reference types="node" />
import { readFileSync } from 'node:fs'
import ExcelJS from 'exceljs'
import { unzipSync, strFromU8 } from 'fflate'
import { describe, expect, it } from 'vitest'

/**
 * The shipped daily template must look the same wherever it is opened.
 *
 * Its colours were theme colours (accent + tint) and its headings used the
 * theme's heading font. A copy that reaches Excel without its theme part — a
 * mail gateway that rebuilds attachments, for one — falls back to Excel's
 * default theme: the headers turn grey, the payment row green, and Cambria
 * becomes Calibri Light. So every colour is written as the colour itself, and
 * every font by its own name.
 */
function shipped(): ArrayBuffer {
  const file = readFileSync(new URL('../assets/daily-template.xlsx', import.meta.url))
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer
}

describe('the shipped daily template', () => {
  it('names every colour and font itself, leaning on no theme', () => {
    const styles = strFromU8(unzipSync(new Uint8Array(shipped()))['xl/styles.xml'])
    expect(styles).not.toMatch(/theme="\d+"/)
    expect(styles).not.toMatch(/<scheme val="(major|minor)"\/>/)
  })

  it('keeps the region’s look: green header, khaki headings, peach payment row, Cambria', async () => {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(shipped())
    const sheet = workbook.worksheets[0]
    const fill = (address: string) => {
      const value = sheet.getCell(address).fill
      return value && value.type === 'pattern' ? value.fgColor?.argb : undefined
    }

    expect(fill('A1')).toBe('FFEBF1DE')
    expect(fill('A2')).toBe('FFB9CDE5')
    expect(fill('A4')).toBe('FFDDD9C3')
    expect(fill('A12')).toBe('FFFCD5B5')
    expect(fill('E12')).toBe('FFC6D9F1')
    expect(sheet.getCell('A2').font?.name).toBe('Cambria')
  })

  it('carries the MSAP row (November 2026) inside the total, and the deposit under it', async () => {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(shipped())
    const sheet = workbook.worksheets[0]
    const formula = (address: string) => {
      const value = sheet.getCell(address).value
      return value && typeof value === 'object' && 'formula' in value ? value.formula : undefined
    }

    expect(sheet.getCell('A11').value).toBe('MSAP')
    expect(sheet.getCell('B11').value).toBe('MSAP Sales')
    expect(formula('E13')).toBe('SUM(D5:D11)')
    expect(formula('A13')).toBe('E13-D13-C13-B13')
  })
})
