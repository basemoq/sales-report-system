import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export interface StoredTemplate {
  id: string
  name: string
  fileName: string
  hash: string
  bytes: ArrayBuffer
  savedAt: string
}

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

interface ReportsDB extends DBSchema {
  templates: { key: string; value: StoredTemplate }
  reports: { key: string; value: StoredReport; indexes: { periodKey: string } }
  ingestedFiles: { key: string; value: IngestedFile; indexes: { reportId: string } }
}

const DB_NAME = 'sales-report-system'
const DB_VERSION = 1

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
    upgrade(db) {
      db.createObjectStore('templates', { keyPath: 'id' })
      db.createObjectStore('reports', { keyPath: 'id' }).createIndex('periodKey', 'periodKey')
      db.createObjectStore('ingestedFiles', { keyPath: 'hash' }).createIndex(
        'reportId',
        'reportId',
      )
    },
  })
  return dbPromise
}

/** Drops the memoized handle so a test can open a fresh database. */
export function resetDBHandle(): void {
  dbPromise = null
}

export async function saveTemplate(template: StoredTemplate): Promise<void> {
  const db = await getDB()
  await db.put('templates', template)
}

export async function listTemplates(): Promise<StoredTemplate[]> {
  const db = await getDB()
  return db.getAll('templates')
}

export async function getTemplate(id: string): Promise<StoredTemplate | undefined> {
  const db = await getDB()
  return db.get('templates', id)
}

export async function deleteTemplate(id: string): Promise<void> {
  const db = await getDB()
  await db.delete('templates', id)
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

export async function recordIngestedFiles(files: IngestedFile[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('ingestedFiles', 'readwrite')
  for (const file of files) {
    await tx.store.put(file)
  }
  await tx.done
}
