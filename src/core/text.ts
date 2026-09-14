/** Tashkeel (harakat) plus the tatweel elongation mark. */
const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g
const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/g

/**
 * Folds the spelling variants that make the same header or location name look
 * like two different strings across exports: hamza forms of alef, ya vs alef
 * maqsura, ta marbuta vs ha, tashkeel, and Arabic-Indic digits.
 */
export function normalizeArabic(text: string): string {
  return text
    .normalize('NFKC')
    .replace(DIACRITICS, '')
    .replace(ARABIC_INDIC_DIGITS, (digit) =>
      String(digit.charCodeAt(0) & 0x0f),
    )
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Comparison key for header labels and location names. */
export function matchKey(text: string): string {
  return normalizeArabic(text).toLowerCase()
}

/**
 * Reads a number as it may appear in an export: a real number, or text carrying
 * thousands separators, a currency suffix, Arabic-Indic digits, or a trailing
 * minus. Returns null when the cell does not hold a number.
 */
export function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null

  let text = normalizeArabic(value)
    .replace(/[٫٬]/g, (mark) => (mark === '٫' ? '.' : ''))
    .replace(/[,\s]/g, '')
    .replace(/[^\d.\-()]/g, '')

  if (text === '') return null

  // Accounting negatives: (1,234) means -1234.
  let negative = false
  if (text.startsWith('(') && text.endsWith(')')) {
    negative = true
    text = text.slice(1, -1)
  }
  if (text.endsWith('-')) {
    negative = true
    text = text.slice(0, -1)
  }

  const parsed = Number(text)
  if (!Number.isFinite(parsed)) return null
  return negative ? -parsed : parsed
}
