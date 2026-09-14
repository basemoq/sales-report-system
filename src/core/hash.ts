/**
 * SHA-256 fingerprint of an uploaded file's bytes, used to detect a file that
 * has already been ingested regardless of its filename.
 */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const view: Uint8Array =
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  // Copy into a standalone buffer so a view over a larger pool hashes only its own bytes.
  const exact = view.byteLength === view.buffer.byteLength ? view.buffer : view.slice().buffer
  const digest = await crypto.subtle.digest('SHA-256', exact as ArrayBuffer)
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
