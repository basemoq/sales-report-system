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

/**
 * ZXing, compiled to WebAssembly: the reader that copes with a code as a camera
 * actually sees one.
 *
 * `BarcodeDetector` is missing from Safari altogether and from Android phones
 * whose barcode module was never installed, which left jsQR — and jsQR wants a
 * clean, square, head-on code. Measured on a photograph of a SurePay terminal's
 * own screen, taken in a showroom: jsQR spent 1.5 seconds and found nothing,
 * ZXing read it in 0.8. The glare off the glass, the angle, and the moiré
 * between the screen's pixels and the camera's are enough, and that is the
 * ordinary way this code is photographed. It also reads the striped codes,
 * which jsQR never could.
 *
 * ~800KB, fetched the first time a code is actually looked for, and served by
 * this app rather than a CDN for the same reason the OCR engine is.
 */
let zxing: Promise<typeof import('zxing-wasm/reader')> | null = null

function loadZxing() {
  zxing ??= import('zxing-wasm/reader').then((module) => {
    const base = import.meta.env?.BASE_URL ?? '/'
    module.prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) =>
          path.endsWith('.wasm')
            ? `${base.endsWith('/') ? base : `${base}/`}barcode/${path}`
            : `${prefix}${path}`,
      },
    })
    return module
  })
  return zxing
}

/** The text of the first code found in the frame, or null when there is none. */
export async function readCode(frame: ImageData): Promise<string | null> {
  const detector = nativeDetector()
  if (detector) {
    try {
      const canvas = new OffscreenCanvas(frame.width, frame.height)
      canvas.getContext('2d')?.putImageData(frame, 0, 0)
      const found = await detector.detect(canvas as unknown as CanvasImageSource)
      if (found.length > 0) return found[0].rawValue
    } catch {
      // A detector that exists but cannot read this frame is not the end of it.
    }
  }

  const decode = await loadJsqr()
  const qr = decode(frame.data, frame.width, frame.height)?.data
  if (qr !== undefined) return qr

  try {
    const { readBarcodes } = await loadZxing()
    const found = await readBarcodes(frame, { tryHarder: true })
    return found.find((result) => result.text !== '')?.text ?? null
  } catch {
    return null
  }
}

/**
 * The code printed on a photograph, if it carries one.
 *
 * A receipt is photographed for its figures, and the same photograph usually
 * has its code on it. Reading it here rather than while the day's report is
 * built keeps the two apart: a picture of a code is worth reading whether or
 * not there are any figures to go with it.
 */
export async function readCodeFromImage(
  bytes: ArrayBuffer,
): Promise<{ code: string; payload: string | null } | null> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(new Blob([bytes]))
  } catch {
    return null
  }

  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (context === null) return null
    // A code saved with a transparent ground — a screenshot, an export from a
    // till's own app — is black on nothing, and nothing reads as black. Without
    // the paper under it the decoder is handed a solid dark square.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0)

    const code = await readCode(context.getImageData(0, 0, canvas.width, canvas.height))
    if (code === null) return null
    return { code, payload: await decodeCodePayload(code) }
  } catch {
    return null
  } finally {
    bitmap.close()
  }
}

/**
 * Zain's receipt code is a SurePay link whose `r` parameter is the receipt
 * itself: gzip, base64, then URL-encoded — the whole payload travels inside the
 * code, so it can be opened on the device with nothing to call.
 */
const GZIP_BASE64 = /^H4sI/

function payloadOf(code: string): string | null {
  const candidates = [code.trim()]
  try {
    // A link carries it in a query parameter, whichever the issuer named.
    const url = new URL(code)
    candidates.push(...[...url.searchParams.values()])
  } catch {
    /* not a URL; the code may be the payload itself */
  }
  return candidates.find((value) => GZIP_BASE64.test(value)) ?? null
}

const bytesOf = (base64: string): Uint8Array => {
  const binary = atob(base64.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

let gunzip: Promise<typeof import('fflate')['gunzipSync']> | null = null

/**
 * The receipt inside the code, unpacked. Returns null when the code carries no
 * such payload, or when it is not readable as text — an unexpected shape is
 * shown as the raw code rather than guessed at.
 */
export async function decodeCodePayload(code: string): Promise<string | null> {
  const payload = payloadOf(code)
  if (payload === null) return null

  try {
    gunzip ??= import('fflate').then((module) => module.gunzipSync)
    const text = new TextDecoder().decode((await gunzip)(bytesOf(payload)))
    // Binary payloads decode to replacement characters; those help nobody.
    return text.includes('\uFFFD') ? null : text
  } catch {
    return null
  }
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

/**
 * What a Zain receipt code carries once unpacked: a payment reference and the
 * moment of the sale, separated by a caret — `2332054800406708^20260914235001`.
 * Either may come first, so the fourteen-digit part is read as the timestamp
 * and the other as the reference.
 */
export interface ReceiptCode {
  reference: string | null
  /** Local date as `YYYY-MM-DD`, from the code's own stamp. */
  day: string | null
  /** Minutes since midnight, local, for finding the sale by its moment. */
  minutes: number | null
}

const TIMESTAMP = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/

export function parseReceiptPayload(payload: string): ReceiptCode {
  const parts = payload.trim().split(/[\^|;]/).map((part) => part.trim())
  const stamp = parts.map((part) => TIMESTAMP.exec(part)).find((match) => match !== null)
  const reference = parts.find((part) => part !== stamp?.[0] && /^\d{6,}$/.test(part)) ?? null

  if (stamp === undefined) return { reference, day: null, minutes: null }
  const [, year, month, day, hour, minute] = stamp
  return {
    reference,
    day: `${year}-${month}-${day}`,
    minutes: Number(hour) * 60 + Number(minute),
  }
}

/** `5:38 PM`, `17:38` and `5:38:20 PM` as minutes since midnight. */
export function timeToMinutes(time: string | null): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i.exec(time?.trim() ?? '')
  if (match === null) return null

  const [, rawHour, minute, meridiem] = match
  let hour = Number(rawHour)
  if (meridiem?.toUpperCase() === 'PM' && hour !== 12) hour += 12
  if (meridiem?.toUpperCase() === 'AM' && hour === 12) hour = 0
  return hour * 60 + Number(minute)
}

const isoDay = (date: Date): string => date.toISOString().slice(0, 10)

/**
 * The day's rows around the moment the code stamps. Used when the code's
 * reference is not one the export carries — which is the usual case, since the
 * payment reference belongs to the card network, not to CACO — so the receipt
 * can still be found by when it was rung up.
 */
export function findByMoment(
  code: ReceiptCode,
  transactions: readonly CacoTransaction[],
  toleranceMinutes = 2,
): CacoTransaction[] {
  if (code.day === null || code.minutes === null) return []

  return transactions.filter((transaction) => {
    const minutes = timeToMinutes(transaction.time)
    return (
      minutes !== null &&
      isoDay(transaction.date) === code.day &&
      Math.abs(minutes - code.minutes!) <= toleranceMinutes
    )
  })
}
