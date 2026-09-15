import { parseReceiptHtml } from '../../worker/src/parse'
import {
  ALLOWED_ORIGIN,
  BROWSER_HEADERS,
  checkReceiptUrl,
  FETCH_TIMEOUT_MS,
  MAX_BODY_BYTES,
  MAX_PAGE_BYTES,
  upstreamMessage,
} from '../../worker/src/receiptUrl'

/**
 * The same receipt reader, on Vercel's Node runtime.
 *
 * It exists because SurePay answers Cloudflare's addresses with 401 whatever
 * the request looks like, while serving the same link to an ordinary
 * connection. Whether it answers a different data centre any differently is
 * exactly what this is here to find out.
 *
 * The Node runtime is deliberate: Vercel's Edge runtime runs on Cloudflare's
 * own network, which is the address range being refused.
 */

/** Node request and response, narrowed to what this uses. */
interface Req {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
  on: (event: string, listener: (chunk?: unknown) => void) => void
}

interface Res {
  statusCode: number
  setHeader: (name: string, value: string) => void
  end: (body?: string) => void
}

const header = (request: Req, name: string): string | null => {
  const value = request.headers[name]
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

/**
 * Best effort, and honestly so: a serverless function is many short-lived
 * instances, so a counter held in one of them sees only its own share of the
 * traffic. It stops a loop hammering a single instance; it is not a promise.
 */
const SEEN = new Map<string, number[]>()
const RATE_LIMIT = 20
const RATE_WINDOW_MS = 60_000

function withinRate(key: string): boolean {
  const now = Date.now()
  const hits = (SEEN.get(key) ?? []).filter((at) => now - at < RATE_WINDOW_MS)
  hits.push(now)
  SEEN.set(key, hits)
  // The map must not grow without bound across a warm instance's life.
  if (SEEN.size > 5000) SEEN.clear()
  return hits.length <= RATE_LIMIT
}

function send(response: Res, status: number, body: unknown, origin: string | null): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  // The receipt is a live figure and must never be held anywhere.
  response.setHeader('cache-control', 'no-store')
  response.setHeader('referrer-policy', 'no-referrer')
  response.setHeader('x-content-type-options', 'nosniff')
  response.setHeader('vary', 'Origin')
  if (origin === ALLOWED_ORIGIN) {
    response.setHeader('access-control-allow-origin', ALLOWED_ORIGIN)
    response.setHeader('access-control-allow-methods', 'POST, OPTIONS')
    response.setHeader('access-control-allow-headers', 'content-type')
    response.setHeader('access-control-max-age', '86400')
  }
  response.end(status === 204 ? undefined : JSON.stringify(body))
}

const fail = (
  response: Res,
  status: number,
  message: string,
  origin: string | null,
  upstream?: number,
): void =>
  send(
    response,
    status,
    upstream === undefined ? { ok: false, error: message } : { ok: false, error: message, upstream },
    origin,
  )

/** Vercel parses JSON bodies itself; a string body is read as one anyway. */
function bodyOf(request: Req): unknown {
  if (typeof request.body === 'string') {
    try {
      return JSON.parse(request.body)
    } catch {
      return null
    }
  }
  return request.body ?? null
}

export default async function handler(request: Req, response: Res): Promise<void> {
  const origin = header(request, 'origin')

  if (origin !== null && origin !== ALLOWED_ORIGIN) {
    return fail(response, 403, 'هذا الطلب ليس من موقع التقارير.', null)
  }
  if (request.method === 'OPTIONS') return send(response, 204, null, origin)
  if (request.method !== 'POST') {
    return fail(response, 405, 'استخدم POST مع رابط الإيصال في JSON.', origin)
  }
  if (!(header(request, 'content-type') ?? '').includes('application/json')) {
    return fail(response, 415, 'أرسل المحتوى بصيغة JSON.', origin)
  }
  if (Number(header(request, 'content-length') ?? '0') > MAX_BODY_BYTES) {
    return fail(response, 413, 'حجم الطلب أكبر مما يلزم.', origin)
  }
  if (!withinRate(header(request, 'x-forwarded-for') ?? 'unknown')) {
    return fail(response, 429, 'طلبات كثيرة في وقت قصير. انتظر قليلًا ثم أعد المحاولة.', origin)
  }

  const body = bodyOf(request)
  if (body === null) {
    return fail(response, 400, 'تعذّرت قراءة الطلب: صيغته ليست JSON صالحة.', origin)
  }

  const checked = checkReceiptUrl((body as { url?: unknown }).url)
  if ('error' in checked) return fail(response, 400, checked.error, origin)

  let upstream: Response
  try {
    upstream = await fetch(checked.url.toString(), {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: BROWSER_HEADERS,
    })
  } catch (cause) {
    const timedOut = (cause as Error).name === 'TimeoutError'
    return fail(
      response,
      504,
      timedOut ? 'انتهت مهلة جلب الإيصال.' : 'تعذّر الوصول إلى خادم الإيصال.',
      origin,
    )
  }

  if (!upstream.ok || (upstream.status >= 300 && upstream.status < 400)) {
    const { status, message } = upstreamMessage(upstream.status)
    return fail(response, status, message, origin, upstream.status)
  }

  const html = await upstream.text()
  if (html.length > MAX_PAGE_BYTES) {
    return fail(response, 502, 'صفحة الإيصال أكبر من الحد المسموح.', origin)
  }

  const receipt = parseReceiptHtml(html)
  if (receipt.rows.totalDb === undefined && receipt.rows.totalCr === undefined) {
    return fail(response, 422, 'الصفحة لا تبدو إيصال موازنة مدى.', origin)
  }

  // Only the figures leave here; the page itself is dropped with this scope.
  send(response, 200, { ok: true, receipt }, origin)
}
