// Installs IDBRequest and friends as globals, which `idb` reaches for directly.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  deleteReport,
  getIngestedFiles,
  getIngestedHashes,
  getReport,
  listReportsInPeriod,
  loadQueue,
  recordIngestedFiles,
  ReportExistsError,
  resetDBHandle,
  saveQueue,
  saveReport,
  type StoredReport,
} from './store'

const report = (id: string, data: unknown = {}): StoredReport => ({
  id,
  periodKey: id.slice(0, 7),
  createdAt: '2025-04-01T00:00:00.000Z',
  data,
})

beforeEach(() => {
  // Each test gets an empty database rather than inheriting the previous one's.
  globalThis.indexedDB = new IDBFactory()
  resetDBHandle()
})

describe('reports', () => {
  it('stores and reads a report back by its date-derived id', async () => {
    await saveReport(report('2025-03-31', { total: 500 }))
    expect((await getReport('2025-03-31'))?.data).toEqual({ total: 500 })
  })

  it('refuses to replace an existing report unless the caller confirmed', async () => {
    await saveReport(report('2025-03-31', { total: 500 }))
    await expect(saveReport(report('2025-03-31', { total: 900 }))).rejects.toThrow(
      ReportExistsError,
    )
    expect((await getReport('2025-03-31'))?.data).toEqual({ total: 500 })
  })

  it('replaces the report once the caller passes overwrite', async () => {
    await saveReport(report('2025-03-31', { total: 500 }))
    await saveReport(report('2025-03-31', { total: 900 }), { overwrite: true })
    expect((await getReport('2025-03-31'))?.data).toEqual({ total: 900 })
  })

  it('lets the sources of a replaced report be uploaded again', async () => {
    await saveReport(report('2025-03-31'))
    await recordIngestedFiles([
      { hash: 'h1', fileName: 'march.xlsx', ingestedAt: 'now', reportId: '2025-03-31' },
    ])
    expect(await getIngestedHashes()).toEqual(new Map([['h1', 'march.xlsx']]))

    await saveReport(report('2025-03-31'), { overwrite: true })
    expect(await getIngestedHashes()).toEqual(new Map())
  })

  it('keeps the ingest record of a report that was not replaced', async () => {
    await saveReport(report('2025-03-31'))
    await saveReport(report('2025-04-30'))
    await recordIngestedFiles([
      { hash: 'h1', fileName: 'march.xlsx', ingestedAt: 'now', reportId: '2025-03-31' },
      { hash: 'h2', fileName: 'april.xlsx', ingestedAt: 'now', reportId: '2025-04-30' },
    ])

    await saveReport(report('2025-04-30'), { overwrite: true })
    expect(await getIngestedHashes()).toEqual(new Map([['h1', 'march.xlsx']]))
  })

  it('says which saved report each ingested file went into', async () => {
    await saveReport(report('WFW430-2026-10-23'))
    await recordIngestedFiles([
      { hash: 'h23', fileName: '23.pdf', ingestedAt: 'now', reportId: 'WFW430-2026-10-23' },
    ])
    expect(await getIngestedFiles()).toEqual(
      new Map([['h23', { fileName: '23.pdf', reportId: 'WFW430-2026-10-23' }]]),
    )
  })

  it('groups reports by period', async () => {
    await saveReport(report('2025-03-15'))
    await saveReport(report('2025-03-31'))
    await saveReport(report('2025-04-30'))

    const march = await listReportsInPeriod('2025-03')
    expect(march.map((r) => r.id).sort()).toEqual(['2025-03-15', '2025-03-31'])
  })

  it('clears a deleted report and its ingest records', async () => {
    await saveReport(report('2025-03-31'))
    await recordIngestedFiles([
      { hash: 'h1', fileName: 'march.xlsx', ingestedAt: 'now', reportId: '2025-03-31' },
    ])

    await deleteReport('2025-03-31')
    expect(await getReport('2025-03-31')).toBeUndefined()
    expect(await getIngestedHashes()).toEqual(new Map())
  })
})

describe('the pinned upload list', () => {
  const bytes = (n: number) => new Uint8Array([n, n + 1, n + 2]).buffer

  it('comes back as it was pinned, bytes and all', async () => {
    await saveQueue([
      { fileName: '22.pdf', bytes: bytes(22) },
      { fileName: '23.pdf', bytes: bytes(23) },
    ])
    resetDBHandle()
    const back = await loadQueue()
    expect(back.map((file) => file.fileName)).toEqual(['22.pdf', '23.pdf'])
    expect([...new Uint8Array(back[1].bytes)]).toEqual([23, 24, 25])
  })

  it('is unpinned by an empty list', async () => {
    await saveQueue([{ fileName: '22.pdf', bytes: bytes(22) }])
    await saveQueue([])
    expect(await loadQueue()).toEqual([])
  })

  it('arrives on a device that already has reports, and keeps them', async () => {
    // A phone that opened the report before the list was kept: version 1.
    const v1 = await openDB('sales-report-system', 1, {
      upgrade(db) {
        db.createObjectStore('reports', { keyPath: 'id' }).createIndex('periodKey', 'periodKey')
        db.createObjectStore('ingestedFiles', { keyPath: 'hash' }).createIndex('reportId', 'reportId')
      },
    })
    await v1.put('reports', report('2026-10-23'))
    v1.close()
    resetDBHandle()

    expect(await getReport('2026-10-23')).toBeDefined()
    await saveQueue([{ fileName: '24.pdf', bytes: bytes(24) }])
    expect((await loadQueue()).map((file) => file.fileName)).toEqual(['24.pdf'])
  })
})
