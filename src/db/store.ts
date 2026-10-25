import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export interface StoredReport<TData = unknown> {
  /** The latest date the report covers, `YYYY-MM-DD`. */
  id: string
  periodKey: string
  createdAt: string
  data: TData
}

export interface IngestedFile {
  hash: string
  fileName: string
  ingestedAt: string
  reportId: string
}

/**
 * The files picked for the day's report, kept on the device until the list is
 * emptied. A receipt's code opens the issuer's page outside the app, and the
 * phone may reload the app on the way back — the list was in memory only, so
 * each receipt had to be saved into a report of its own before the next could
 * be fetched, and the day's report then turned those receipts away as already
 * entered. Kept here, the list survives the trip.
 */
export interface QueuedFiles {
  slot: 'current'
  files: { fileName: string; bytes: ArrayBuffer }[]
  savedAt: string
}

interface ReportsDB extends DBSchema {
  reports: { key: string; value: StoredReport; indexes: { periodKey: string } }
  ingestedFiles: { key: string; value: IngestedFile; indexes: { reportId: string } }
  queue: { key: string; value: QueuedFiles }
}

const DB_NAME = 'sales-report-system'
const DB_VERSION = 2

export class ReportExistsError extends Error {
  readonly reportId: string

  constructor(reportId: string) {
    super(`يوجد تقرير محفوظ بالمعرّف ${reportId}`)
    this.name = 'ReportExistsError'
    this.reportId = reportId
  }
}

let dbPromise: Promise<IDBPDatabase<ReportsDB>> | null = null

export function getDB(): Promise<IDBPDatabase<ReportsDB>> {
  dbPromise ??= openDB<ReportsDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('reports', { keyPath: 'id' }).createIndex('periodKey', 'periodKey')
        db.createObjectStore('ingestedFiles', { keyPath: 'hash' }).createIndex(
          'reportId',
          'reportId',
        )
      }
      // Version 2: the pinned upload list. Reports and ingest records are kept.
      if (oldVersion < 2) db.createObjectStore('queue', { keyPath: 'slot' })
    },
  })
  return dbPromise
}

/** Drops the memoized handle so a test can open a fresh database. */
export function resetDBHandle(): void {
  dbPromise = null
}

export async function getReport(id: string): Promise<StoredReport | undefined> {
  const db = await getDB()
  return db.get('reports', id)
}

export async function listReports(): Promise<StoredReport[]> {
  const db = await getDB()
  return db.getAll('reports')
}

export async function listReportsInPeriod(periodKey: string): Promise<StoredReport[]> {
  const db = await getDB()
  return db.getAllFromIndex('reports', 'periodKey', periodKey)
}

/**
 * Writes a report under its date-derived id. A report already stored under that
 * id is only replaced when the caller has confirmed it with the user, since
 * there are no backups to fall back on.
 */
export async function saveReport(
  report: StoredReport,
  options: { overwrite?: boolean } = {},
): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['reports', 'ingestedFiles'], 'readwrite')

  const existing = await tx.objectStore('reports').get(report.id)
  if (existing && !options.overwrite) {
    tx.abort()
    // Settle the abort we just asked for, so it is not an unhandled rejection.
    await tx.done.catch(() => {})
    throw new ReportExistsError(report.id)
  }

  // Files ingested into the replaced report must stop counting as duplicates,
  // or a re-upload of the same sources could never rebuild the report.
  if (existing) {
    const files = tx.objectStore('ingestedFiles')
    for (const stale of await files.index('reportId').getAllKeys(report.id)) {
      await files.delete(stale)
    }
  }

  await tx.objectStore('reports').put(report)
  await tx.done
}

export async function deleteReport(id: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['reports', 'ingestedFiles'], 'readwrite')
  await tx.objectStore('reports').delete(id)
  const files = tx.objectStore('ingestedFiles')
  for (const stale of await files.index('reportId').getAllKeys(id)) {
    await files.delete(stale)
  }
  await tx.done
}

/** Hash → the name the file carried when it was first ingested. */
export async function getIngestedHashes(): Promise<Map<string, string>> {
  const db = await getDB()
  const files = await db.getAll('ingestedFiles')
  return new Map(files.map((file) => [file.hash, file.fileName]))
}

/** The pinned upload list, or none. */
export async function loadQueue(): Promise<QueuedFiles['files']> {
  const db = await getDB()
  return (await db.get('queue', 'current'))?.files ?? []
}

/** Pins the list as it now stands; an empty list unpins it. */
export async function saveQueue(files: QueuedFiles['files']): Promise<void> {
  const db = await getDB()
  if (files.length === 0) {
    await db.delete('queue', 'current')
    return
  }
  await db.put('queue', {
    slot: 'current',
    files: files.map((file) => ({ fileName: file.fileName, bytes: file.bytes })),
    savedAt: new Date().toISOString(),
  })
}

/** Hash → the name it was first ingested under and the saved report it went into. */
export async function getIngestedFiles(): Promise<Map<string, { fileName: string; reportId: string }>> {
  const db = await getDB()
  const files = await db.getAll('ingestedFiles')
  return new Map(files.map((file) => [file.hash, { fileName: file.fileName, reportId: file.reportId }]))
}

export async function recordIngestedFiles(files: IngestedFile[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('ingestedFiles', 'readwrite')
  for (const file of files) {
    await tx.store.put(file)
  }
  await tx.done
}
