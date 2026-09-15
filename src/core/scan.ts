import type { CacoTransaction } from './sources/caco'

/**
 * Reading a code from a still frame. The browser's own BarcodeDetector is used
 * when it exists — it is faster and reads the 1D barcodes as well — and jsQR,
 * which is bundled, covers the rest: Safari has no BarcodeDetector at all, and
 * a scanner that only worked on Android would be no use in the showroom.
 */

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>
}

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike

function nativeDetector(): BarcodeDetectorLike | null {
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  if (ctor === undefined) return null
  try {
    return new ctor()
  } catch {
    // A browser that exposes the constructor but supports no format we asked for.
    return null
  }
}

let jsqr: Promise<typeof import('jsqr')['default']> | null = null

/** ~45KB, so it is fetched the first time the scanner is actually opened. */
function loadJsqr() {
  jsqr ??= import('jsqr').then((module) => module.default)
  return jsqr
}

/** The text of the first code found in the frame, or null when there is none. */
export async function readCode(frame: ImageData): Promise<string | null> {
  const detector = nativeDetector()
  if (detector) {
    const canvas = new OffscreenCanvas(frame.width, frame.height)
    canvas.getContext('2d')?.putImageData(frame, 0, 0)
    const found = await detector.detect(canvas as unknown as CanvasImageSource)
    if (found.length > 0) return found[0].rawValue
  }

  const decode = await loadJsqr()
  return decode(frame.data, frame.width, frame.height)?.data ?? null
}

/**
 * Digits are what a receipt code and the export have in common: the code may
 * carry a URL or extra fields around the number, and the export writes the same
 * number plainly.
 */
const digitsOf = (text: string): string[] =>
  (text.match(/\d{4,}/g) ?? []).map((run) => run.replace(/^0+/, ''))

const fieldsOf = (transaction: CacoTransaction): string[] =>
  [transaction.receiptNo, transaction.salesOrderNumber, transaction.msisdn, transaction.account]
    .filter((field): field is string => field !== null)
    .map((field) => field.trim())

/**
 * The transactions a scanned code points at. A code is matched against the
 * receipt number, the sales order number, the line and the account — whichever
 * the code carries — so scanning either the receipt or the customer's own code
 * finds the day's rows for it.
 */
export function findByCode(
  code: string,
  transactions: readonly CacoTransaction[],
): CacoTransaction[] {
  const text = code.trim()
  if (text === '') return []
  const runs = digitsOf(text)

  return transactions.filter((transaction) =>
    fieldsOf(transaction).some(
      (field) =>
        field === text ||
        // Either side may be the longer string: a receipt number inside a URL,
        // or a code that is just the digits of a longer stored value.
        (field.length >= 4 && text.includes(field)) ||
        runs.some((run) => field.replace(/^0+/, '') === run),
    ),
  )
}
