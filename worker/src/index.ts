import { parseReceiptHtml, type MadaReceipt } from './parse'

/**
 * A single-purpose reader for one thing: the mada reconciliation receipt that a
 * SurePay terminal's QR code points at. The browser cannot read that page
 * itself — it is another origin and sends no CORS headers — so this stands in
 * the middle, and is deliberately narrow: one host, one path, one shape of
 * request, and nothing kept afterwards.
 *
 * It is not a proxy. A link to anywhere else is refused before any request is
 * made, and the page's HTML never leaves here — only the figures read out of it.
 */

const ALLOWED_ORIGIN = 'https://basemoq.github.io'
const ALLOWED_HOST = 'd.surepay.sa'
const ALLOWED_PATH = '/r'

/** A receipt link is a few hundred characters; anything longer is not one. */
const MAX_URL_LENGTH = 4096
const MAX_BODY_BYTES = 8 * 1024
const MAX_PAGE_BYTES = 512 * 1024
const FETCH_TIMEOUT_MS = 10_000

interface Env {
  /** Optional: Workers rate-limiting binding, applied per client address. */
  RECEIPT_LIMITER?: { limit: (options: { key: string }) => Promise<{ success: boolean }> }
}

/**
 * Arabic, and never an echo of what was sent: the input is not repeated back.
 * `upstream` carries the receipt server's own status code when it answered —
 * a number, never any of its content — because without it a failure cannot be
 * told apart from an expired link.
 */
const fail = (
  status: number,
  message: string,
  origin: string | null,
  upstream?: number,
): Response =>
  json(upstream === undefined ? { ok: false, error: message } : { ok: false, error: message, upstream }, status, origin)

function json(body: unknown, status: number, origin: string | null): Response {
  // 204 carries no body, so a preflight answers with headers alone.
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: responseHeaders(origin),
  })
}

function responseHeaders(origin: string | null): Headers {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    // The receipt is a live figure and must never be held anywhere.
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    vary: 'Origin',
  })
  if (origin === ALLOWED_ORIGIN) {
    headers.set('access-control-allow-origin', ALLOWED_ORIGIN)
    headers.set('access-control-allow-methods', 'POST, OPTIONS')
    headers.set('access-control-allow-headers', 'content-type')
    headers.set('access-control-max-age', '86400')
  }
  return headers
}

/**
 * The one link this accepts. Everything is checked explicitly rather than by a
 * pattern over the string: scheme, host as a whole (so `d.surepay.sa.evil.com`
 * and any other subdomain are refused), path, and the presence of the receipt's
 * own parameter. Credentials in the URL are refused too — they have no place in
 * a receipt link and are a way to dress one host up as another.
 */
function checkReceiptUrl(value: unknown): { url: URL } | { error: string } {
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

/** Reads at most the cap, and stops the transfer rather than buffering more. */
async function readCapped(response: Response): Promise<string | null> {
  const body = response.body
  if (body === null) return null

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_PAGE_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const merged = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8').decode(merged)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('origin')

    // A browser may only call this from the app; a call with no origin at all
    // (curl, a health check) is allowed but gets no CORS grant.
    if (origin !== null && origin !== ALLOWED_ORIGIN) {
      return fail(403, 'هذا الطلب ليس من موقع التقارير.', null)
    }

    if (request.method === 'OPTIONS') return json({ ok: true }, 204, origin)
    if (request.method !== 'POST') {
      return fail(405, 'استخدم POST مع رابط الإيصال في JSON.', origin)
    }
    if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
      return fail(415, 'أرسل المحتوى بصيغة JSON.', origin)
    }

    const length = Number(request.headers.get('content-length') ?? '0')
    if (length > MAX_BODY_BYTES) return fail(413, 'حجم الطلب أكبر مما يلزم.', origin)

    if (env.RECEIPT_LIMITER) {
      const key = request.headers.get('cf-connecting-ip') ?? 'unknown'
      const { success } = await env.RECEIPT_LIMITER.limit({ key })
      if (!success) return fail(429, 'طلبات كثيرة في وقت قصير. انتظر قليلًا ثم أعد المحاولة.', origin)
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail(400, 'تعذّرت قراءة الطلب: صيغته ليست JSON صالحة.', origin)
    }

    const checked = checkReceiptUrl((body as { url?: unknown } | null)?.url)
    if ('error' in checked) return fail(400, checked.error, origin)

    let upstream: Response
    try {
      upstream = await fetch(checked.url.toString(), {
        // A redirect is never followed: the check above would be worthless if
        // the first response could send this anywhere it liked.
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'ar,en;q=0.8',
          // The receipt page is meant for a phone browser and some hosts turn
        // away anything that does not look like one.
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        },
      })
    } catch (cause) {
      const timedOut = (cause as Error).name === 'TimeoutError'
      return fail(
        504,
        timedOut ? 'انتهت مهلة جلب الإيصال.' : 'تعذّر الوصول إلى خادم الإيصال.',
        origin,
      )
    }

    if (upstream.status >= 300 && upstream.status < 400) {
      return fail(502, 'الإيصال يحوّل إلى عنوان آخر، ولم يُتابَع التحويل.', origin, upstream.status)
    }
    if (upstream.status === 404 || upstream.status === 410) {
      return fail(404, 'لم يعد هذا الإيصال متاحًا على خادم مدى.', origin, upstream.status)
    }
    if (upstream.status === 403 || upstream.status === 401) {
      return fail(502, 'خادم الإيصال رفض الطلب.', origin, upstream.status)
    }
    if (!upstream.ok) {
      return fail(502, 'خادم الإيصال لم يُرجع صفحة صالحة.', origin, upstream.status)
    }

    const html = await readCapped(upstream)
    if (html === null) return fail(502, 'صفحة الإيصال أكبر من الحد المسموح.', origin)

    const receipt = parseReceiptHtml(html)
    if (receipt.rows.totalDb === undefined && receipt.rows.totalCr === undefined) {
      return fail(422, 'الصفحة لا تبدو إيصال موازنة مدى.', origin)
    }

    // Only the figures leave here; the page itself is dropped with this scope.
    return json({ ok: true, receipt } satisfies { ok: true; receipt: MadaReceipt }, 200, origin)
  },
}
