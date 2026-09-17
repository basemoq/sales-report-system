/**
 * Splitting a photograph into the pieces of paper it holds.
 *
 * A reconciliation slip is often cut into strips and photographed side by side,
 * and OCR reads such a photo line by line across the whole width: a line from
 * the left strip and a line from the right one come back as a single row of
 * text, interleaved past any hope of reading the figures out of it. Each strip
 * has to be its own image before a word of it is read.
 *
 * The cut is found by looking at where the ink is. Down each column of pixels,
 * count the dark ones; a strip is a run of columns that carry ink, and the
 * paper-free gap between two strips carries none. The same pass throws away the
 * desk, the cable and the sliver of a neighbouring page — anything too narrow
 * to be a receipt — which is worth as much as the split itself: one stray word
 * off to the side used to be taken for the page margin and cost the whole
 * parse.
 */

/** Ink is darker than this share of the image's own middle brightness. */
const INK_RATIO = 0.75

/** A column carries ink when this share of it is dark. */
const INKED_COLUMN_RATIO = 0.004

/** Gaps narrower than this are the space between words, not between strips. */
const GUTTER_RATIO = 0.03

/** Narrower than this and it is not a receipt: it is the desk, or an edge. */
const MIN_STRIP_RATIO = 0.08

/** Analysis runs on a small copy; the crop is taken from the full-size one. */
const PROFILE_WIDTH = 800

export interface Run {
  start: number
  end: number
}

function inkProfile(canvas: OffscreenCanvas): { inked: boolean[]; width: number } {
  const scale = Math.min(1, PROFILE_WIDTH / canvas.width)
  const width = Math.max(1, Math.round(canvas.width * scale))
  const height = Math.max(1, Math.round(canvas.height * scale))

  const small = new OffscreenCanvas(width, height)
  const context = small.getContext('2d')
  if (context === null) return { inked: [], width: canvas.width }
  context.drawImage(canvas, 0, 0, width, height)
  const { data } = context.getImageData(0, 0, width, height)

  const luma = new Uint8Array(width * height)
  let sum = 0
  for (let i = 0; i < luma.length; i += 1) {
    const at = i * 4
    // Rec. 601 luma, rounded to integers: the exactness buys nothing here.
    const value = (data[at] * 77 + data[at + 1] * 150 + data[at + 2] * 29) >> 8
    luma[i] = value
    sum += value
  }

  // The threshold follows the photograph rather than being fixed: a receipt
  // shot in a showroom is nothing like one shot under a window.
  const threshold = (sum / luma.length) * INK_RATIO
  const needed = Math.max(3, Math.round(height * INKED_COLUMN_RATIO))

  const inked: boolean[] = []
  for (let x = 0; x < width; x += 1) {
    let dark = 0
    for (let y = 0; y < height; y += 1) {
      if (luma[y * width + x] < threshold) dark += 1
    }
    inked.push(dark >= needed)
  }

  return { inked, width }
}

/** Runs of inked columns, with word spacing closed up and specks dropped. */
export function stripsOf(inked: readonly boolean[]): Run[] {
  const runs: Run[] = []
  let start: number | null = null

  for (let x = 0; x <= inked.length; x += 1) {
    if (inked[x] === true) {
      start ??= x
      continue
    }
    if (start !== null) {
      runs.push({ start, end: x })
      start = null
    }
  }

  const gutter = inked.length * GUTTER_RATIO
  const joined: Run[] = []
  for (const run of runs) {
    const previous = joined[joined.length - 1]
    if (previous !== undefined && run.start - previous.end <= gutter) previous.end = run.end
    else joined.push({ ...run })
  }

  return joined.filter((run) => run.end - run.start >= inked.length * MIN_STRIP_RATIO)
}

/**
 * The pieces of paper in a photograph, left to right, each as its own image.
 * A photograph holding one receipt comes back as it went in.
 */
export function splitStrips(canvas: OffscreenCanvas): OffscreenCanvas[] {
  const { inked, width } = inkProfile(canvas)
  if (inked.length === 0) return [canvas]

  const strips = stripsOf(inked)
  if (strips.length === 0) return [canvas]
  // Nothing was cropped away and there is only one strip: the photograph is
  // already the receipt.
  if (strips.length === 1 && strips[0].end - strips[0].start >= inked.length * 0.97) {
    return [canvas]
  }

  const scale = canvas.width / width
  // A little paper on each side, so nothing is clipped off a letter.
  const margin = canvas.width * 0.01

  return strips.map((strip) => {
    const left = Math.max(0, Math.round(strip.start * scale - margin))
    const right = Math.min(canvas.width, Math.round(strip.end * scale + margin))
    const cut = new OffscreenCanvas(Math.max(1, right - left), canvas.height)
    cut
      .getContext('2d')
      ?.drawImage(canvas, left, 0, cut.width, canvas.height, 0, 0, cut.width, canvas.height)
    return cut
  })
}
