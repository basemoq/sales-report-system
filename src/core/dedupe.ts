export interface HashedFile {
  hash: string
  fileName: string
}

export interface DuplicateHit<T extends HashedFile> {
  file: T
  /** `already-stored` = same bytes were ingested in an earlier session. */
  reason: 'already-stored' | 'repeated-in-upload'
  /** Name the file carried the first time these bytes were seen. */
  firstSeenAs: string
}

export interface DedupeResult<T extends HashedFile> {
  unique: T[]
  duplicates: DuplicateHit<T>[]
}

/**
 * Splits an upload batch into files worth processing and files whose bytes are
 * already accounted for. The first occurrence of a hash always wins, so callers
 * can process `unique` and surface `duplicates` as warnings.
 */
export function deduplicateByHash<T extends HashedFile>(
  files: T[],
  storedHashes: ReadonlyMap<string, string> = new Map(),
): DedupeResult<T> {
  const unique: T[] = []
  const duplicates: DuplicateHit<T>[] = []
  const seen = new Map<string, string>()

  for (const file of files) {
    const storedAs = storedHashes.get(file.hash)
    if (storedAs !== undefined) {
      duplicates.push({ file, reason: 'already-stored', firstSeenAs: storedAs })
      continue
    }
    const seenAs = seen.get(file.hash)
    if (seenAs !== undefined) {
      duplicates.push({ file, reason: 'repeated-in-upload', firstSeenAs: seenAs })
      continue
    }
    seen.set(file.hash, file.fileName)
    unique.push(file)
  }

  return { unique, duplicates }
}
