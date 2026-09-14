// Installs IDBRequest and friends as globals, which `idb` reaches for directly.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  deleteReport,
  getIngestedHashes,
  getReport,
  listReportsInPeriod,
  recordIngestedFiles,
  ReportExistsError,
  resetDBHandle,
  saveReport,
  saveTemplate,
  listTemplates,
  deleteTemplate,
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

describe('templates', () => {
  const template = {
    id: 'default',
    name: 'القالب المعتمد',
    fileName: 'template.xlsx',
    hash: 'abc',
    bytes: new Uint8Array([1, 2, 3]).buffer as ArrayBuffer,
    savedAt: '2025-04-01T00:00:00.000Z',
  }

  it('stores, lists and deletes a template', async () => {
    await saveTemplate(template)
    expect((await listTemplates()).map((t) => t.name)).toEqual(['القالب المعتمد'])

    await deleteTemplate('default')
    expect(await listTemplates()).toEqual([])
  })

  it('replaces a template saved under the same id', async () => {
    await saveTemplate(template)
    await saveTemplate({ ...template, name: 'نسخة محدّثة' })

    const stored = await listTemplates()
    expect(stored).toHaveLength(1)
    expect(stored[0].name).toBe('نسخة محدّثة')
  })
})
