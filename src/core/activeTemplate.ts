import bundledTemplateUrl from '../assets/daily-template.xlsx?url'
import { getTemplate } from '../db/store'

export interface ActiveTemplate {
  bytes: ArrayBuffer
  fileName: string
  /** `bundled` is the blank template shipped with the app. */
  source: 'stored' | 'bundled'
}

export const BUNDLED_TEMPLATE_NAME = 'القالب المدمج'

let bundled: Promise<ArrayBuffer> | null = null

function fetchBundled(): Promise<ArrayBuffer> {
  bundled ??= fetch(bundledTemplateUrl).then((response) => {
    if (!response.ok) {
      throw new Error(`تعذّر تحميل القالب المدمج (${response.status}).`)
    }
    return response.arrayBuffer()
  })
  return bundled
}

/**
 * The template to fill: whichever one was uploaded on this device, or the blank
 * one shipped with the app. Shipping a blank template is what lets a fresh
 * device produce a report without uploading anything first; it carries the
 * layout and the formulas but none of a given day's figures or names.
 */
export async function getActiveTemplate(): Promise<ActiveTemplate> {
  const stored = await getTemplate('default')
  if (stored !== undefined) {
    return { bytes: stored.bytes, fileName: stored.fileName, source: 'stored' }
  }
  return { bytes: await fetchBundled(), fileName: BUNDLED_TEMPLATE_NAME, source: 'bundled' }
}
