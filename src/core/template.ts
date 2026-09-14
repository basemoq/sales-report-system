import ExcelJS from 'exceljs'

export interface TemplateIssue {
  /** An `error` blocks the save; a `warning` is shown but does not. */
  severity: 'error' | 'warning'
  message: string
}

export interface TemplateStats {
  sheetNames: string[]
  /** Rows carrying at least one non-empty cell, per sheet. */
  populatedRows: Record<string, number>
  /** Cells holding a formula, per sheet. */
  formulaCells: Record<string, number>
}

export interface TemplateValidation {
  valid: boolean
  issues: TemplateIssue[]
  stats: TemplateStats
}

export interface TemplateSpec {
  /** Sheets the template must contain, matched case-insensitively. */
  requiredSheets: string[]
  /** A template with no formulas is a plain export, not a calculation template. */
  minFormulaCells: number
  /** Guards against a truncated file that carries only a header band. */
  minPopulatedRows: number
}

export const DEFAULT_TEMPLATE_SPEC: TemplateSpec = {
  requiredSheets: [],
  minFormulaCells: 1,
  minPopulatedRows: 2,
}

const normalize = (name: string) => name.trim().toLowerCase()

function isFormula(value: ExcelJS.CellValue): boolean {
  return typeof value === 'object' && value !== null && 'formula' in value
}

function isEmpty(value: ExcelJS.CellValue): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  return false
}

/**
 * Checks a candidate template before it is stored, so a wrong or truncated file
 * is rejected at upload rather than silently producing empty reports later.
 * The caller still confirms the save; this only decides whether it may.
 */
export async function validateTemplate(
  fileName: string,
  bytes: ArrayBuffer,
  spec: TemplateSpec = DEFAULT_TEMPLATE_SPEC,
): Promise<TemplateValidation> {
  const issues: TemplateIssue[] = []
  const emptyStats: TemplateStats = { sheetNames: [], populatedRows: {}, formulaCells: {} }

  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(bytes)
  } catch {
    return {
      valid: false,
      issues: [
        {
          severity: 'error',
          message: `تعذّرت قراءة "${fileName}" كملف Excel. القالب يجب أن يكون بصيغة .xlsx`,
        },
      ],
      stats: emptyStats,
    }
  }

  const stats: TemplateStats = {
    sheetNames: workbook.worksheets.map((sheet) => sheet.name),
    populatedRows: {},
    formulaCells: {},
  }

  if (workbook.worksheets.length === 0) {
    issues.push({ severity: 'error', message: 'القالب لا يحتوي على أي ورقة عمل.' })
    return { valid: false, issues, stats }
  }

  for (const sheet of workbook.worksheets) {
    let populated = 0
    let formulas = 0
    sheet.eachRow({ includeEmpty: false }, (row) => {
      let rowHasContent = false
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (isFormula(cell.value)) formulas += 1
        if (!isEmpty(cell.value)) rowHasContent = true
      })
      if (rowHasContent) populated += 1
    })
    stats.populatedRows[sheet.name] = populated
    stats.formulaCells[sheet.name] = formulas
  }

  const present = new Set(stats.sheetNames.map(normalize))
  for (const required of spec.requiredSheets) {
    if (!present.has(normalize(required))) {
      issues.push({
        severity: 'error',
        message: `القالب ينقصه ورقة العمل المطلوبة "${required}".`,
      })
    }
  }

  const totalFormulas = Object.values(stats.formulaCells).reduce((sum, n) => sum + n, 0)
  if (totalFormulas < spec.minFormulaCells) {
    issues.push({
      severity: 'error',
      message:
        `القالب لا يحتوي على معادلات (المطلوب ${spec.minFormulaCells} على الأقل). ` +
        'تأكد أنك رفعت ملف القالب وليس تقريرًا مُصدَّرًا بقيم ثابتة.',
    })
  }

  const totalRows = Object.values(stats.populatedRows).reduce((sum, n) => sum + n, 0)
  if (totalRows < spec.minPopulatedRows) {
    issues.push({
      severity: 'error',
      message: `القالب يحتوي على ${totalRows} صف فقط، والمطلوب ${spec.minPopulatedRows} على الأقل.`,
    })
  }

  for (const sheet of stats.sheetNames) {
    if (stats.populatedRows[sheet] === 0) {
      issues.push({ severity: 'warning', message: `ورقة العمل "${sheet}" فارغة.` })
    }
  }

  return {
    valid: !issues.some((issue) => issue.severity === 'error'),
    issues,
    stats,
  }
}
