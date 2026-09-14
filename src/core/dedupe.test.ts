import { describe, expect, it } from 'vitest'
import { deduplicateByHash } from './dedupe'

const file = (fileName: string, hash: string) => ({ fileName, hash })

describe('deduplicateByHash', () => {
  it('keeps every file when all hashes differ', () => {
    const files = [file('a.xlsx', 'h1'), file('b.xlsx', 'h2')]
    const { unique, duplicates } = deduplicateByHash(files)
    expect(unique).toEqual(files)
    expect(duplicates).toEqual([])
  })

  it('keeps the first occurrence and flags the repeat within one upload', () => {
    const first = file('march.xlsx', 'same')
    const copy = file('march-copy.xlsx', 'same')
    const { unique, duplicates } = deduplicateByHash([first, copy])

    expect(unique).toEqual([first])
    expect(duplicates).toEqual([
      { file: copy, reason: 'repeated-in-upload', firstSeenAs: 'march.xlsx' },
    ])
  })

  it('flags a file whose bytes were stored in an earlier session', () => {
    const reupload = file('renamed.xlsx', 'stored')
    const { unique, duplicates } = deduplicateByHash(
      [reupload],
      new Map([['stored', 'original.xlsx']]),
    )

    expect(unique).toEqual([])
    expect(duplicates).toEqual([
      { file: reupload, reason: 'already-stored', firstSeenAs: 'original.xlsx' },
    ])
  })

  it('processes the unique files in a batch that also contains duplicates', () => {
    const fresh = file('new.xlsx', 'fresh')
    const { unique, duplicates } = deduplicateByHash(
      [file('old.xlsx', 'stored'), fresh, file('old-again.xlsx', 'stored')],
      new Map([['stored', 'original.xlsx']]),
    )

    expect(unique).toEqual([fresh])
    expect(duplicates).toHaveLength(2)
    expect(duplicates.every((hit) => hit.reason === 'already-stored')).toBe(true)
  })

  it('treats a differing name with differing bytes as a separate file', () => {
    const files = [file('report.xlsx', 'h1'), file('report.xlsx', 'h2')]
    expect(deduplicateByHash(files).unique).toHaveLength(2)
  })
})
