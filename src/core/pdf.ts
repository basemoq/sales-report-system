export interface PdfTextItem {
  text: string
  /** Page number, 1-based. */
  page: number
  /** PDF user-space coordinates; y grows upward from the page bottom. */
  x: number
  y: number
}

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

let pdfjs: Promise<PdfjsModule> | null = null

/**
 * pdf.js is ~1MB, so it is pulled in only when a PDF is actually opened. The
 * legacy build is used because it runs unchanged in both the browser and the
 * Node test environment.
 */
function loadPdfjs(): Promise<PdfjsModule> {
  pdfjs ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((module) => {
    if (typeof window !== 'undefined') {
      module.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/legacy/build/pdf.worker.mjs',
        import.meta.url,
      ).toString()
    }
    return module
  })
  return pdfjs
}

/**
 * Extracts every text run with the position it was drawn at. These reports lay
 * their figures out by coordinate rather than in reading order, so a value can
 * only be tied to its label by looking at where each sits on the page.
 */
export async function extractPdfText(bytes: ArrayBuffer): Promise<PdfTextItem[]> {
  const { getDocument } = await loadPdfjs()
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true })
  const doc = await task.promise

  try {
    const items: PdfTextItem[] = []
    for (let page = 1; page <= doc.numPages; page += 1) {
      const content = await (await doc.getPage(page)).getTextContent()
      for (const item of content.items) {
        if (!('str' in item) || item.str.trim() === '') continue
        items.push({ text: item.str, page, x: item.transform[4], y: item.transform[5] })
      }
    }
    return items
  } finally {
    await task.destroy()
  }
}

/** Folds letter-spaced headings such as `G r a n d T o t a l :` to `grandtotal`. */
export function labelKey(text: string): string {
  return text.replace(/[\s:：]/g, '').toLowerCase()
}

/** Baselines drift by a point or two between a label and its value. */
const BASELINE_TOLERANCE = 4

/**
 * Text runs joined per baseline, left to right. A heading the PDF drew as
 * several runs (`Consolidated` + `Report`) is one string here.
 */
export function linesOf(items: readonly PdfTextItem[]): string[] {
  const byLine = new Map<string, PdfTextItem[]>()

  for (const item of items) {
    // Rounding to the tolerance keeps runs that drift a point apart on one line.
    const key = `${item.page}:${Math.round(item.y / BASELINE_TOLERANCE)}`
    const line = byLine.get(key)
    if (line) line.push(item)
    else byLine.set(key, [item])
  }

  return [...byLine.values()].map((line) =>
    line
      .sort((a, b) => a.x - b.x)
      .map((item) => item.text.trim())
      .join(' '),
  )
}

/**
 * The value drawn to the right of a label on the same baseline. Returns null
 * when the label's box was left empty, which these reports use to mean zero.
 */
export function valueRightOf(
  items: readonly PdfTextItem[],
  label: PdfTextItem,
  isValue: (text: string) => boolean,
): PdfTextItem | null {
  const candidates = items
    .filter(
      (item) =>
        item.page === label.page &&
        Math.abs(item.y - label.y) <= BASELINE_TOLERANCE &&
        item.x > label.x &&
        isValue(item.text),
    )
    .sort((a, b) => a.x - b.x)

  return candidates[0] ?? null
}
