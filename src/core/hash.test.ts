import { describe, expect, it } from 'vitest'
import { sha256Hex } from './hash'

const encode = (text: string) => new TextEncoder().encode(text)

describe('sha256Hex', () => {
  it('matches the known digest of an empty input', async () => {
    await expect(sha256Hex(new Uint8Array())).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('matches the known digest of "abc"', async () => {
    await expect(sha256Hex(encode('abc'))).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('gives identical bytes the same fingerprint', async () => {
    const [a, b] = await Promise.all([
      sha256Hex(encode('sales report')),
      sha256Hex(encode('sales report')),
    ])
    expect(a).toBe(b)
  })

  it('gives differing bytes different fingerprints', async () => {
    const [a, b] = await Promise.all([
      sha256Hex(encode('sales report')),
      sha256Hex(encode('sales report ')),
    ])
    expect(a).not.toBe(b)
  })

  it('hashes only the bytes a view covers, not its backing buffer', async () => {
    const pool = new Uint8Array([1, 2, 3, 4, 5, 6])
    const slice = pool.subarray(1, 4)
    await expect(sha256Hex(slice)).resolves.toBe(await sha256Hex(new Uint8Array([2, 3, 4])))
  })
})
