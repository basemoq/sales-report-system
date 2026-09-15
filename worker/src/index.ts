import { parseReceiptHtml, type MadaReceipt } from './parse'
import {
  ALLOWED_ORIGIN,
  BROWSER_HEADERS,
  checkReceiptUrl,
  FETCH_TIMEOUT_MS,
  MAX_BODY_BYTES,
  MAX_PAGE_BYTES,
  upstreamMessage,
} from './receiptUrl'

/**
 * A single-purpose reader for one thing: the mada reconciliation receipt that a
 * SurePay terminal's QR code points at. The browser cannot read that page
 * itself — it is another origin and sends no CORS headers — so this stands in
 * the middle, and is deliberately narrow: one host, one path, one shape of
 * request, and nothing kept afterwards.
 *
 * It is not a proxy. A link to anywhere else is refused before any request is
 * made, and the page's HTML never leaves here — only the figures read out of it.
 *
 * Note: SurePay answers this Worker with 401 whatever the request looks like —
 * four different shapes were tried — while the same link is served to a home
 * connection. The block is on Cloudflare's addresses, so the same reader also
 * exists as a Vercel function; see vercel/ in this repository.
 */

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
  json(
    upstream === undefined ? { ok: false, error: message } : { ok: false, error: message, upstream },
    status,
    origin,
  )

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
        headers: BROWSER_HEADERS,
      })
    } catch (cause) {
      const timedOut = (cause as Error).name === 'TimeoutError'
      return fail(
        504,
        timedOut ? 'انتهت مهلة جلب الإيصال.' : 'تعذّر الوصول إلى خادم الإيصال.',
        origin,
      )
    }

    if (!upstream.ok || (upstream.status >= 300 && upstream.status < 400)) {
      const { status, message } = upstreamMessage(upstream.status)
      return fail(status, message, origin, upstream.status)
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
