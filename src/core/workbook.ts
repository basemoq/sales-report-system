import ExcelJS from 'exceljs'

export type CellValue = string | number | boolean | Date | null

export interface SheetData {
  name: string
  rows: CellValue[][]
}

export class UnsupportedFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedFileError'
  }
}

/** OLE2 compound-document signature, shared by legacy .xls and .doc. */
const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
/** ZIP signature: every OOXML workbook is a zip archive. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((byte, i) => bytes[i] === byte)
}

function normalizeCell(value: ExcelJS.CellValue): CellValue {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'object') {
    if ('result' in value) return normalizeCell(value.result as ExcelJS.CellValue)
    if ('richText' in value) return value.richText.map((part) => part.text).join('')
    if ('text' in value) return value.text
    if ('error' in value) return null
  }
  return null
}

/**
 * Reads an uploaded workbook into plain row matrices. Rows are dense and
 * 0-indexed, so a caller addressing `rows[2][0]` gets sheet cell A3 whether or
 * not the source left gaps.
 */
export async function readWorkbook(fileName: string, bytes: ArrayBuffer): Promise<SheetData[]> {
  const head = new Uint8Array(bytes.slice(0, 8))

  if (startsWith(head, OLE2_MAGIC)) {
    throw new UnsupportedFileError(
      `الملف "${fileName}" بصيغة Excel القديمة (.xls). افتحه في Excel واحفظه بصيغة .xlsx ثم أعد رفعه.`,
    )
  }

  if (fileName.toLowerCase().endsWith('.csv')) {
    return [{ name: 'CSV', rows: parseCsv(new TextDecoder().decode(bytes)) }]
  }

  if (!startsWith(head, ZIP_MAGIC)) {
    throw new UnsupportedFileError(
      `الملف "${fileName}" ليس ملف Excel صالحًا. الصيغ المدعومة: .xlsx و .csv`,
    )
  }

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes)

  return workbook.worksheets.map((sheet) => {
    const rows: CellValue[][] = []
    const width = sheet.columnCount
    for (let r = 1; r <= sheet.rowCount; r += 1) {
      const row = sheet.getRow(r)
      const cells: CellValue[] = []
      for (let c = 1; c <= width; c += 1) {
        cells.push(normalizeCell(row.getCell(c).value))
      }
      rows.push(cells)
    }
    return { name: sheet.name, rows }
  })
}

/** RFC 4180 parsing: quoted fields may contain commas, newlines and `""`. */
export function parseCsv(text: string): CellValue[][] {
  const rows: CellValue[][] = []
  let row: CellValue[] = []
  let field = ''
  let quoted = false
  let i = 0

  // A BOM would otherwise become part of the first header cell.
  if (text.charCodeAt(0) === 0xfeff) i = 1

  const endField = () => {
    row.push(field === '' ? null : field)
    field = ''
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }

  while (i < text.length) {
    const char = text[i]

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i += 1
        continue
      }
      field += char
      i += 1
      continue
    }

    if (char === '"' && field === '') {
      quoted = true
      i += 1
      continue
    }
    if (char === ',') {
      endField()
      i += 1
      continue
    }
    if (char === '\r' && text[i + 1] === '\n') {
      endRow()
      i += 2
      continue
    }
    if (char === '\n' || char === '\r') {
      endRow()
      i += 1
      continue
    }
    field += char
    i += 1
  }

  // A file ending in a newline has no trailing record.
  if (field !== '' || row.length > 0) endRow()

  return rows
}
