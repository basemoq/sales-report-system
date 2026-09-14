import { reportIdFromDates, periodKey } from './dates'
import { deduplicateByHash, type DuplicateHit } from './dedupe'
import { summarizeEmployees } from './employees'
import { sha256Hex } from './hash'
import type { EmployeeSummary, LocationSummary, SalesRecord } from './model'
import { ingestShoorFiles, type RowProblem, type ShoorFile } from './sources/shoor'
import { readWorkbook } from './workbook'

export interface UploadedFile {
  fileName: string
  bytes: ArrayBuffer
}

interface FingerprintedFile extends UploadedFile {
  hash: string
}

export interface BuiltReport {
  /** The latest date the data covers; the report's identity. */
  reportId: string
  periodKey: string
  locations: LocationSummary[]
  employees: EmployeeSummary[]
  records: SalesRecord[]
  /** Files skipped because their bytes were already accounted for. */
  duplicates: DuplicateHit<FingerprintedFile>[]
  /** Rows that could not be read, by file. */
  problems: RowProblem[]
  /** Fingerprints of the files that were actually ingested. */
  ingested: { hash: string; fileName: string }[]
}

export class NoDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoDataError'
  }
}

/**
 * Turns a batch of uploads into a report: fingerprint, drop bytes already
 * ingested, read, then aggregate. A location conflict inside the batch throws
 * out of `ingestShoorFiles`, so nothing is produced from a contradictory upload.
 */
export async function buildReport(
  files: readonly UploadedFile[],
  storedHashes: ReadonlyMap<string, string> = new Map(),
): Promise<BuiltReport> {
  const fingerprinted: FingerprintedFile[] = await Promise.all(
    files.map(async (file) => ({ ...file, hash: await sha256Hex(file.bytes) })),
  )

  const { unique, duplicates } = deduplicateByHash(fingerprinted, storedHashes)
  if (unique.length === 0) {
    throw new NoDataError('كل الملفات المرفوعة سبق إدخالها؛ لا يوجد جديد لمعالجته.')
  }

  const parsed: ShoorFile[] = await Promise.all(
    unique.map(async (file) => ({
      fileName: file.fileName,
      sheets: await readWorkbook(file.fileName, file.bytes),
    })),
  )

  const { records, locations, problems } = ingestShoorFiles(parsed)

  const reportId = reportIdFromDates(records.map((record) => record.date))
  if (reportId === null) {
    throw new NoDataError('لم يُعثر على أي صف يحمل تاريخًا صالحًا في الملفات المرفوعة.')
  }

  const latest = records.reduce((max, r) => (r.date > max ? r.date : max), records[0].date)

  return {
    reportId,
    periodKey: periodKey(latest),
    locations,
    employees: summarizeEmployees(records),
    records,
    duplicates,
    problems,
    ingested: unique.map(({ hash, fileName }) => ({ hash, fileName })),
  }
}
