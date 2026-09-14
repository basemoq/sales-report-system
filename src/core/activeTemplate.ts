import bundledTemplateUrl from '../assets/daily-template.xlsx?url'

let bundled: Promise<ArrayBuffer> | null = null

/**
 * The blank daily template shipped with the app: the layout and its formulas,
 * with every per-report value left empty. The app fills it, so there is nothing
 * for anyone to upload or keep up to date on each device.
 */
export function getTemplateBytes(): Promise<ArrayBuffer> {
  bundled ??= fetch(bundledTemplateUrl).then((response) => {
    if (!response.ok) {
      throw new Error(`تعذّر تحميل القالب (${response.status}).`)
    }
    return response.arrayBuffer()
  })
  return bundled
}
