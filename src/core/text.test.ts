import { describe, expect, it } from 'vitest'
import { matchKey, normalizeArabic, parseNumber } from './text'

describe('normalizeArabic', () => {
  it('folds hamza forms of alef to a bare alef', () => {
    expect(normalizeArabic('أحمد')).toBe('احمد')
    expect(normalizeArabic('إجمالي')).toBe('اجمالي')
    expect(normalizeArabic('آخر')).toBe('اخر')
  })

  it('folds alef maqsura to ya and ta marbuta to ha', () => {
    expect(normalizeArabic('مصطفى')).toBe('مصطفي')
    expect(normalizeArabic('المبيعات اليومية')).toBe('المبيعات اليوميه')
  })

  it('strips tashkeel and tatweel', () => {
    expect(normalizeArabic('مَبِيعَات')).toBe('مبيعات')
    expect(normalizeArabic('مبيــعات')).toBe('مبيعات')
  })

  it('converts Arabic-Indic digits to ASCII', () => {
    expect(normalizeArabic('١٢٣')).toBe('123')
    expect(normalizeArabic('۴۵۶')).toBe('456')
  })

  it('collapses runs of whitespace and trims', () => {
    expect(normalizeArabic('  صافي   المبيعات  ')).toBe('صافي المبيعات')
  })

  it('makes two spellings of one location name compare equal', () => {
    expect(matchKey('فرع الرياض')).toBe(matchKey('فرع  الريــاض'))
  })
})

describe('parseNumber', () => {
  it('passes a real number through', () => {
    expect(parseNumber(1500)).toBe(1500)
    expect(parseNumber(-12.5)).toBe(-12.5)
    expect(parseNumber(0)).toBe(0)
  })

  it('reads text carrying thousands separators', () => {
    expect(parseNumber('1,234,567')).toBe(1234567)
    expect(parseNumber('1 234')).toBe(1234)
  })

  it('reads a number with a currency suffix', () => {
    expect(parseNumber('1500 ريال')).toBe(1500)
    expect(parseNumber('1,500.75 SAR')).toBe(1500.75)
  })

  it('reads Arabic-Indic digits', () => {
    expect(parseNumber('١٢٣٤')).toBe(1234)
  })

  it('reads an accounting negative', () => {
    expect(parseNumber('(1,234)')).toBe(-1234)
    expect(parseNumber('1234-')).toBe(-1234)
    expect(parseNumber('-1234')).toBe(-1234)
  })

  it('rejects a cell that holds no number', () => {
    expect(parseNumber(null)).toBeNull()
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('الإجمالي')).toBeNull()
    expect(parseNumber(true)).toBeNull()
    expect(parseNumber(Number.NaN)).toBeNull()
  })
})
