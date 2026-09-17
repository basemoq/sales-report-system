import {
  buildDailyFigures,
  exclusionReport,
  refundSummary,
  unrefundedSuperseded,
  type DailyFigures,
} from './dailyReport'
import { periodKey, toISODate } from './dates'
import { deduplicateByHash, type DuplicateHit } from './dedupe'
import { summarizeEmployees } from './employees'
import { sha256Hex } from './hash'
import type { EmployeeSummary } from './model'
import { canvasOf, readImageText } from './ocr'
import { extractPdfText, renderPdfPages, type PdfTextItem } from './pdf'
import {
  checkDetailedTotal,
  isCacoDetailed,
  isCacoSummary,
  parseCacoDetailed,
  parseCacoSummary,
  type CacoDetailed,
  type CacoSummary,
  type CacoTransaction,
} from './sources/caco'
import { parseMadaReconciliation, type MadaReconciliation } from './sources/mada'
import { parseTabsReport, type TabsReport } from './sources/tabs'
import { readWorkbook, type SheetData } from './workbook'

export interface UploadedFile {
  fileName: string
  bytes: ArrayBuffer
}

export type SourceKind = 'caco-summary' | 'caco-detailed' | 'tabs' | 'mada'

export interface RecognisedSource {
  fileName: string
  hash: string
  kind: SourceKind
}

export interface UnrecognisedFile {
  fileName: string
  hash: string
  reason: string
}

interface FingerprintedFile extends UploadedFile {
  hash: string
}

export interface DailyReportBuild {
  /**
   * Storage key: the shop and the day together. Two showrooms reporting the
   * same day on one device are two reports, not one overwriting the other.
   */
  reportId: string
  /** The day the report covers, `YYYY-MM-DD`, for display and file names. */
  reportDate: string
  periodKey: string
  /** The shop the sources belong to, for checking the template matches. */
  shopId: string | null
  /**
   * The mada receipt shows the shape that means its Visa figure may really be
   * a MasterCard settlement. Only a person can tell the two apart.
   */
  visaMayBeMastercard: boolean
  /** Refund total taken off the figures, for showing beside them. */
  refundDeducted: number
  /** Cancelled (Superseded) orders taken off the figures, for showing beside them. */
  supersededExcluded: number
  figures: DailyFigures
  employees: EmployeeSummary[]
  /** The day's rows, for looking a receipt up by its barcode. */
  transactions: CacoTransaction[]
  sources: RecognisedSource[]
  unrecognised: UnrecognisedFile[]
  duplicates: DuplicateHit<FingerprintedFile>[]
  /** Sources this upload did not include; each simply counts as zero. */
  missingSources: string[]
  warnings: string[]
}

/**
 * A report is identified by its shop and its day. Sources that name no shop
 * fall back to the day alone, which is also the key every report saved before
 * shops were part of it already carries.
 */
export function reportKey(shopId: string | null, isoDate: string): string {
  return shopId === null ? isoDate : `${shopId}-${isoDate}`
}

export class NoDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoDataError'
  }
}

const isPdf = (bytes: ArrayBuffer) => {
  const head = new Uint8Array(bytes.slice(0, 5))
  return head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46
}

/**
 * Photographs and scans, by their own first bytes rather than by extension: a
 * receipt arrives from the camera roll named whatever the phone called it.
 * HEIC is here because that is what an iPhone stores a photo as.
 */
const IMAGE_MAGIC: { name: string; bytes: number[]; offset?: number }[] = [
  { name: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { name: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
  { name: 'gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { name: 'bmp', bytes: [0x42, 0x4d] },
  { name: 'webp', bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
  { name: 'heif', bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },
]

const isImage = (bytes: ArrayBuffer): boolean => {
  const head = new Uint8Array(bytes.slice(0, 16))
  return IMAGE_MAGIC.some(({ bytes: magic, offset = 0 }) =>
    magic.every((byte, index) => head[offset + index] === byte),
  )
}

interface Recognised {
  file: FingerprintedFile
  kind: SourceKind
  sheets?: SheetData[]
  items?: PdfTextItem[]
  /**
   * The text was read off a picture rather than out of the file. OCR misreads
   * digits, and these are amounts, so the operator is told to check them.
   */
  scanned?: boolean
}

/**
 * The text on a photographed or scanned receipt, laid out as a PDF's would be.
 * A scanned PDF is drawn page by page first; a photo is read as it is.
 */
async function readScannedText(file: FingerprintedFile): Promise<PdfTextItem[]> {
  if (isPdf(file.bytes)) {
    const pages = await renderPdfPages(file.bytes)
    const items: PdfTextItem[] = []
    for (const rendered of pages) {
      items.push(
        ...(await readImageText({
          source: rendered.canvas,
          width: rendered.width,
          height: rendered.height,
          page: rendered.page,
        })),
      )
    }
    return items
  }

  const bitmap = await createImageBitmap(new Blob([file.bytes]))
  try {
    return await readImageText(canvasOf(bitmap))
  } finally {
    bitmap.close()
  }
}

/** The PDF and receipt parsers, each rejecting what is not its own report. */
function parseReceipt(items: PdfTextItem[]): SourceKind | null {
  try {
    parseTabsReport(items)
    return 'tabs'
  } catch {
    /* not a TABS export */
  }
  try {
    parseMadaReconciliation(items)
    return 'mada'
  } catch {
    /* not a mada receipt */
  }
  return null
}

/**
 * Works out what each upload is from its content rather than its name, since
 * these exports are named by the moment they were generated.
 */
async function recognise(
  file: FingerprintedFile,
): Promise<Recognised | { file: FingerprintedFile; reason: string }> {
  const picture = isImage(file.bytes)

  if (isPdf(file.bytes) || picture) {
    let items: PdfTextItem[] = []
    if (!picture) {
      try {
        items = await extractPdfText(file.bytes)
      } catch (cause) {
        // A damaged file must not sink the rest of the batch.
        return { file, reason: `تعذّرت قراءة ملف PDF: ${(cause as Error).message}` }
      }

      const kind = parseReceipt(items)
      if (kind !== null) return { file, kind, items }
    }

    // Either a photograph, or a PDF that is a picture of a receipt rather than
    // an export of one — a scan carries no text at all, so there is nothing for
    // the parsers to read until the page is drawn and looked at.
    try {
      const scanned = await readScannedText(file)
      const kind = parseReceipt(scanned)
      if (kind !== null) return { file, kind, items: scanned, scanned: true }
    } catch (cause) {
      return {
        file,
        reason: `تعذّرت قراءة الإيصال المصوّر: ${(cause as Error).message}`,
      }
    }

    return {
      file,
      reason: picture
        ? 'الصورة لا تُقرأ كإيصال موازنة مدى ولا كتقرير TABS — صوّرها كاملة وواضحة وأعد المحاولة.'
        : 'ملف PDF غير معروف — ليس تقرير TABS ولا إيصال موازنة مدى.',
    }
  }

  let sheets: SheetData[]
  try {
    sheets = await readWorkbook(file.fileName, file.bytes)
  } catch (cause) {
    return { file, reason: (cause as Error).message }
  }

  if (isCacoSummary(sheets)) return { file, kind: 'caco-summary', sheets }
  if (isCacoDetailed(sheets)) return { file, kind: 'caco-detailed', sheets }
  return {
    file,
    reason: 'ملف Excel غير معروف — ليس تقرير CACO مختصرًا ولا مفصّلًا.',
  }
}

/**
 * Turns a day's uploads into the figures the template carries, plus the
 * employee breakdown. Files already ingested are skipped, and a file that is
 * none of the four known reports is reported rather than guessed at.
 */
export async function buildDailyReport(
  files: readonly UploadedFile[],
  storedHashes: ReadonlyMap<string, string> = new Map(),
): Promise<DailyReportBuild> {
  const fingerprinted: FingerprintedFile[] = await Promise.all(
    files.map(async (file) => ({ ...file, hash: await sha256Hex(file.bytes) })),
  )

  const { unique, duplicates } = deduplicateByHash(fingerprinted, storedHashes)
  if (unique.length === 0) {
    throw new NoDataError('كل الملفات المرفوعة سبق إدخالها؛ لا يوجد جديد لمعالجته.')
  }

  const outcomes = await Promise.all(unique.map(recognise))

  const sources: RecognisedSource[] = []
  const unrecognised: UnrecognisedFile[] = []
  const warnings: string[] = []

  let caco: CacoSummary | undefined
  let detailed: CacoDetailed | undefined
  let tabs: TabsReport | undefined
  let mada: MadaReconciliation | undefined

  for (const outcome of outcomes) {
    if (!('kind' in outcome)) {
      unrecognised.push({
        fileName: outcome.file.fileName,
        hash: outcome.file.hash,
        reason: outcome.reason,
      })
      continue
    }

    sources.push({ fileName: outcome.file.fileName, hash: outcome.file.hash, kind: outcome.kind })

    // OCR misreads digits, and these are amounts, so a figure read off a
    // picture is never presented as if it came out of the export.
    if (outcome.scanned === true) {
      warnings.push(
        `«${outcome.file.fileName}» قُرئ من صورة وليس من ملف — راجع المبالغ قبل الاعتماد.`,
      )
    }

    switch (outcome.kind) {
      case 'caco-summary':
        caco = parseCacoSummary(outcome.sheets!)
        break
      case 'caco-detailed':
        detailed = parseCacoDetailed(outcome.sheets!)
        break
      case 'tabs':
        tabs = parseTabsReport(outcome.items!)
        break
      case 'mada':
        mada = parseMadaReconciliation(outcome.items!)
        break
    }
  }

  if (caco === undefined && detailed === undefined && tabs === undefined && mada === undefined) {
    // Why each file was turned away goes with the message: without it the
    // operator is told only that nothing worked, which is the one thing they
    // already know.
    throw new NoDataError(
      [
        'لم يُتعرَّف على أي ملف من الملفات المرفوعة.',
        ...unrecognised.map((file) => `«${file.fileName}»: ${file.reason}`),
      ].join('\n'),
    )
  }

  // The BSS rows come from the summary, or from the detailed export when only
  // that was uploaded — both describe the same split.
  const figures = buildDailyFigures({ caco, detailed, tabs, mada })

  const missingSources: string[] = []
  if (caco === undefined && detailed === undefined) missingSources.push('CACO')
  if (tabs === undefined) missingSources.push('TABS')
  if (mada === undefined) missingSources.push('موازنة مدى')

  warnings.push(...crossCheck(caco, detailed))

  // A refund that was deducted is shown beside the figures it changed; one that
  // could not be placed is a warning, since it is still in them.
  const refunds = refundSummary({ caco, detailed })
  warnings.push(...refunds.unplaced)

  // Cancelled orders, unmapped summary rows and money that never reaches the
  // drawer: each one moves a figure, so each one is said out loud.
  const exclusions = exclusionReport({ caco, detailed })
  warnings.push(...exclusions.warnings)

  // The receipt printed one figure two ways and they did not agree: on a
  // scanned receipt that is a misread digit, and it is money.
  for (const gap of mada?.disagreements ?? []) {
    warnings.push(
      `إيصال مدى: قسم «${gap.scheme}» طُبع بمبلغين مختلفين — ${gap.totals.toFixed(2)} في سطر TOTALS و ${gap.debit.toFixed(2)} في سطر TOTAL DB. راجع الإيصال وصحّح الرقم يدويًا.`,
    )
  }

  if (mada?.totalsMatched === false) {
    warnings.push('إيصال مدى لا يُظهر تطابق المجاميع (TotalsMatched).')
  }
  for (const scheme of mada?.unmapped ?? []) {
    warnings.push(
      `إيصال مدى يحتوي على شبكة «${scheme.scheme}» بمبلغ ${scheme.amount} لا يقابلها عمود في القالب.`,
    )
  }

  const date = figures.date
  if (!date) {
    throw new NoDataError('تعذّر تحديد تاريخ التقرير من الملفات المرفوعة.')
  }

  const reportDate = toISODate(date)
  const shopId =
    caco?.parameters.shopId ?? detailed?.parameters.shopId ?? tabs?.warehouse ?? null

  return {
    reportId: reportKey(shopId, reportDate),
    reportDate,
    periodKey: periodKey(date),
    shopId,
    visaMayBeMastercard: mada?.visaMayBeMastercard ?? false,
    refundDeducted: refunds.deducted,
    supersededExcluded: exclusions.supersededExcluded,
    figures,
    // The same rows the figures left out are left out here, so the two halves
    // of one report cannot disagree about what the day sold.
    employees: summarizeEmployees(countedForEmployees(detailed)),
    transactions: detailed?.transactions ?? [],
    sources,
    unrecognised,
    duplicates,
    missingSources,
    warnings,
  }
}

/** The day's rows less the cancelled orders the figures excluded. */
function countedForEmployees(detailed?: CacoDetailed): CacoTransaction[] {
  if (detailed === undefined) return []
  const dropped = new Set(unrefundedSuperseded(detailed))
  return detailed.transactions.filter((transaction) => !dropped.has(transaction))
}

/**
 * The two CACO exports describe the same day from different angles, so their
 * totals must agree. A gap means one of them was run over a different range.
 */
function crossCheck(caco?: CacoSummary, detailed?: CacoDetailed): string[] {
  const warnings: string[] = []

  if (detailed) {
    const check = checkDetailedTotal(detailed)
    if (!check.ok) {
      warnings.push(
        `تقرير CACO المفصّل: مجموع الصفوف ${check.summed.toFixed(2)} لا يطابق الإجمالي المطبوع ${check.reported?.toFixed(2)}.`,
      )
    }
    if (detailed.skippedRows > 0) {
      warnings.push(`تقرير CACO المفصّل: تعذّرت قراءة ${detailed.skippedRows} صف.`)
    }
  }

  if (caco && detailed) {
    const summed = detailed.transactions.reduce((sum, t) => sum + t.amount, 0)
    if (Math.abs(summed - caco.grandTotal) > 0.01) {
      warnings.push(
        `إجمالي CACO المختصر ${caco.grandTotal.toFixed(2)} لا يطابق مجموع المفصّل ${summed.toFixed(2)}.`,
      )
    }
    if (caco.parameters.shopId !== detailed.parameters.shopId) {
      warnings.push(
        `الملفان يخصان فرعين مختلفين: ${caco.parameters.shopId} و ${detailed.parameters.shopId}.`,
      )
    }
  }

  return warnings
}
