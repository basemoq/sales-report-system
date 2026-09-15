/**
 * The one link either middleman will open, and the limits both hold to.
 *
 * This lives apart from the handlers on purpose: the check is the whole of the
 * security story, so there is one copy of it, used by the Cloudflare Worker and
 * by the Vercel function alike. Two copies would drift, and the drift would be
 * a hole.
 */

export const ALLOWED_ORIGIN = 'https://basemoq.github.io'
export const ALLOWED_HOST = 'd.surepay.sa'
export const ALLOWED_PATH = '/r'

/** A receipt link is a few hundred characters; anything longer is not one. */
export const MAX_URL_LENGTH = 4096
export const MAX_BODY_BYTES = 8 * 1024
export const MAX_PAGE_BYTES = 512 * 1024
export const FETCH_TIMEOUT_MS = 10_000

export const BROWSER_HEADERS: Record<string, string> = {
  accept: 'text/html,application/xhtml+xml',
  'accept-language': 'ar,en;q=0.8',
  // The receipt page is meant for a phone browser, and a host may turn away
  // anything that does not look like one.
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
}

/**
 * Everything is checked explicitly rather than by a pattern over the string:
 * scheme, host as a whole (so `d.surepay.sa.evil.com` and any other subdomain
 * are refused), path, and the presence of the receipt's own parameter.
 * Credentials in the URL are refused too — they have no place in a receipt link
 * and are a way to dress one host up as another.
 */
export function checkReceiptUrl(value: unknown): { url: URL } | { error: string } {
  if (typeof value !== 'string' || value.trim() === '') {
    return { error: 'أرسل رابط الإيصال في الحقل url.' }
  }
  if (value.length > MAX_URL_LENGTH) return { error: 'الرابط أطول مما يقبله الإيصال.' }

  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return { error: 'الرابط غير صالح.' }
  }

  if (url.protocol !== 'https:') return { error: 'يجب أن يكون الرابط عبر HTTPS.' }
  if (url.username !== '' || url.password !== '') return { error: 'الرابط غير صالح.' }
  if (url.hostname.toLowerCase() !== ALLOWED_HOST) {
    return { error: `لا يُقبل إلا رابط ${ALLOWED_HOST}.` }
  }
  if (url.pathname !== ALLOWED_PATH) return { error: 'مسار الرابط ليس مسار الإيصال.' }
  if ((url.searchParams.get('r') ?? '') === '') return { error: 'الرابط لا يحمل رمز الإيصال.' }

  return { url }
}

/** The Arabic a caller sees for the receipt server's own answer. */
export function upstreamMessage(status: number): { status: number; message: string } {
  if (status >= 300 && status < 400) {
    return { status: 502, message: 'الإيصال يحوّل إلى عنوان آخر، ولم يُتابَع التحويل.' }
  }
  if (status === 404 || status === 410) {
    return { status: 404, message: 'لم يعد هذا الإيصال متاحًا على خادم مدى.' }
  }
  if (status === 401 || status === 403) {
    return { status: 502, message: 'خادم الإيصال رفض الطلب.' }
  }
  return { status: 502, message: 'خادم الإيصال لم يُرجع صفحة صالحة.' }
}
