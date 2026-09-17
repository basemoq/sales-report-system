import type { PdfTextItem } from './pdf'

/**
 * Reading a receipt that was photographed or scanned rather than exported.
 *
 * The mada and TABS parsers work off `PdfTextItem`s — a text run with the point
 * it was drawn at — because these receipts lay their figures out by coordinate,
 * not in reading order. So OCR is made to produce the same thing: each word it
 * recognises becomes an item at the place it sits on the page, and the existing
 * parsers then read a photo exactly as they read an export. Nothing downstream
 * needs to know which it was.
 */

export class OcrError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OcrError'
  }
}

/** A source OCR can read, with the size the coordinates are relative to. */
export interface OcrImage {
  source: OffscreenCanvas
  width: number
  height: number
  /** Page this image is, for a multi-page scan. 1-based. */
  page?: number
}

/**
 * The smallest width receipt print is legible at. A phone photographed close up
 * is usually well past this; one taken from across the counter, or a picture
 * that has been through a messaging app, is not, and a small image is better
 * enlarged than read as a smudge.
 */
const MIN_OCR_WIDTH = 1600

/**
 * A photograph as something the engine can read. The bitmap goes onto a canvas
 * because that is what tesseract.js takes — it has no idea what an
 * `ImageBitmap` is — and the canvas is the chance to enlarge a small photo on
 * the way through.
 */
export function canvasOf(bitmap: ImageBitmap): OcrImage {
  const scale = bitmap.width < MIN_OCR_WIDTH ? MIN_OCR_WIDTH / bitmap.width : 1
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')
  if (context === null) throw new OcrError('تعذّر تجهيز الصورة للقراءة.')
  context.drawImage(bitmap, 0, 0, width, height)

  return { source: canvas, width, height }
}

/**
 * Pixels are turned into PDF points so that the tolerances the parsers hold —
 * four points between a label and its value, six for the left margin — mean the
 * same thing on a 2480px scan as on an exported page. A4 width is the yardstick
 * because that is what a scanner produces and what a phone photo is cropped to.
 */
const A4_WIDTH_POINTS = 595

/** Below this, a word is more likely a smudge than a character. */
const MIN_WORD_CONFIDENCE = 40

/**
 * How close two words must sit to be one thing the receipt printed.
 *
 * OCR hands back words, not the runs a PDF would carry, so `mada HOST` arrives
 * as two items and the parser reads the `mada` as a scheme of its own rather
 * than as the subsection it heads. Measured on a real receipt: the gap inside a
 * label runs 6–11px against a line height of 14–21, while the gap between two
 * columns of the table runs 130–151. There is no contest, so the threshold sits
 * between them with room on both sides.
 */
const MERGE_GAP_RATIO = 0.8

/**
 * A money figure whose decimal point the scan lost: `3987 81` for 3987.81.
 * Two digits after a gap this small is a point that did not survive; a count
 * and an amount sit a hundred pixels apart, not eight.
 */
const LOST_DECIMAL_POINT = /^[\d,]+$/

export type Word = { text: string; x0: number; x1: number; bottom: number; height: number }

/** Words the receipt printed as one run, rejoined. */
export function mergeWords(words: readonly Word[]): Word[] {
  const runs: Word[] = []

  for (const word of words) {
    const previous = runs[runs.length - 1]
    const height = Math.max(previous?.height ?? 0, word.height)
    if (previous === undefined || word.x0 - previous.x1 > height * MERGE_GAP_RATIO) {
      runs.push({ ...word })
      continue
    }

    const lostPoint =
      word.text.length === 2 &&
      LOST_DECIMAL_POINT.test(word.text) &&
      LOST_DECIMAL_POINT.test(previous.text)

    previous.text += lostPoint ? `.${word.text}` : ` ${word.text}`
    previous.x1 = word.x1
    previous.bottom = Math.max(previous.bottom, word.bottom)
    previous.height = height
  }

  return runs
}

type TesseractModule = typeof import('tesseract.js')
type TesseractWorker = Awaited<ReturnType<TesseractModule['createWorker']>>

/**
 * Where the OCR engine's own files are served from.
 *
 * They are served by this app rather than a CDN: the app is installed as an
 * offline PWA and used in a showroom, and a receipt must still be readable when
 * the network is not. It also keeps a third party out of the loading path.
 */
const assetBase = (): string => {
  const base = import.meta.env?.BASE_URL ?? '/'
  return `${base.endsWith('/') ? base : `${base}/`}ocr/`
}

let worker: Promise<TesseractWorker> | null = null

/**
 * ~10MB of engine and language data, so it is fetched the first time a photo is
 * actually read, and the worker is then kept for the rest of the session — a
 * showroom reads several receipts in a row.
 */
function loadWorker(): Promise<TesseractWorker> {
  worker ??= import('tesseract.js').then(({ createWorker }) =>
    createWorker('eng', 1, {
      corePath: assetBase(),
      langPath: assetBase(),
      workerPath: `${assetBase()}worker.min.js`,
    }),
  )
  return worker
}

/** Frees the engine's memory once a batch of receipts has been read. */
export async function releaseOcr(): Promise<void> {
  const pending = worker
  worker = null
  if (pending === null) return
  try {
    await (await pending).terminate()
  } catch {
    /* already gone */
  }
}

/**
 * The words on an image, as items in PDF space: x from the left, y upward from
 * the bottom, both in points. A word is placed at its own baseline — its
 * bottom edge — which is what `linesOf` and the parsers group on.
 */
export async function readImageText(image: OcrImage): Promise<PdfTextItem[]> {
  if (image.width === 0 || image.height === 0) {
    throw new OcrError('الصورة فارغة.')
  }

  let engine: TesseractWorker
  try {
    engine = await loadWorker()
  } catch (cause) {
    throw new OcrError(`تعذّر تحميل محرّك قراءة الصور: ${(cause as Error).message}`)
  }

  const scale = A4_WIDTH_POINTS / image.width
  const page = image.page ?? 1

  const { data } = await engine.recognize(image.source, {}, { blocks: true })

  const items: PdfTextItem[] = []
  let lineNumber = 0
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        // The engine's own grouping, carried through: it holds on a tilted
        // photograph where a shared baseline no longer does.
        const id = `${page}:${lineNumber}`
        lineNumber += 1
        const words: Word[] = []
        for (const word of line.words) {
          const text = word.text.trim()
          if (text === '' || word.confidence < MIN_WORD_CONFIDENCE) continue
          words.push({
            text,
            x0: word.bbox.x0,
            x1: word.bbox.x1,
            bottom: word.bbox.y1,
            height: word.bbox.y1 - word.bbox.y0,
          })
        }

        for (const run of mergeWords(words)) {
          items.push({
            text: run.text,
            line: id,
            page,
            x: run.x0 * scale,
            // OCR counts down from the top; a PDF counts up from the bottom.
            y: (image.height - run.bottom) * scale,
          })
        }
      }
    }
  }

  return items
}
