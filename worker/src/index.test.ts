import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from './index'

const ORIGIN = 'https://basemoq.github.io'
const RECEIPT_URL = 'https://d.surepay.sa/r?r=H4sIAAAAAAAAAAXBAQEAIAgDwUrPNhDL2D%2BG'

const PAGE = `<html><body><h1>WINDTEL Telecom</h1><div>14/09/2026 23:50:01</div>
<div>2332054800406708</div><div>TotalsMatched</div>
<table><tr><td>TOTAL DB</td><td>14</td><td>1,406.85</td></tr>
<tr><td>TOTAL CR</td><td>0</td><td>0.00</td></tr></table></body></html>`

const post = (body: unknown, origin: string | null = ORIGIN, init: RequestInit = {}) =>
  worker.fetch(
    new Request('https://worker.example/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(origin === null ? {} : { origin }),
      },
      body: JSON.stringify(body),
      ...init,
    }),
    {},
  )

const upstreamReturns = (page: string, init: ResponseInit = {}) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(page, init))

afterEach(() => vi.restoreAllMocks())

describe('the request itself', () => {
  it('answers a preflight from the app, and only the app', async () => {
    const allowed = await worker.fetch(
      new Request('https://worker.example/', { method: 'OPTIONS', headers: { origin: ORIGIN } }),
      {},
    )

    expect(allowed.status).toBe(204)
    expect(allowed.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(allowed.headers.get('vary')).toBe('Origin')
  })

  it('refuses a call from any other site', async () => {
    const response = await post({ url: RECEIPT_URL }, 'https://evil.example')

    expect(response.status).toBe(403)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('takes the link in the body, never in the query string', async () => {
    const response = await worker.fetch(
      new Request(`https://worker.example/?url=${encodeURIComponent(RECEIPT_URL)}`, {
        headers: { origin: ORIGIN },
      }),
      {},
    )

    expect(response.status).toBe(405)
  })

  it('insists on JSON', async () => {
    const response = await worker.fetch(
      new Request('https://worker.example/', {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'text/plain' },
        body: RECEIPT_URL,
      }),
      {},
    )

    expect(response.status).toBe(415)
  })

  it('turns away a body that is not JSON at all', async () => {
    const response = await worker.fetch(
      new Request('https://worker.example/', {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: '{oops',
      }),
      {},
    )

    expect(response.status).toBe(400)
  })

  it('stops when the limiter says the caller has had enough', async () => {
    const limit = vi.fn().mockResolvedValue({ success: false })
    const response = await worker.fetch(
      new Request('https://worker.example/', {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ url: RECEIPT_URL }),
      }),
      { RECEIPT_LIMITER: { limit } },
    )

    expect(response.status).toBe(429)
    expect(limit).toHaveBeenCalled()
  })
})

describe('which links it will open', () => {
  const refused = [
    ['no link at all', undefined],
    ['an empty link', '   '],
    ['plain HTTP', 'http://d.surepay.sa/r?r=abc'],
    ['another host', 'https://example.com/r?r=abc'],
    ['a host that only ends with it', 'https://d.surepay.sa.evil.com/r?r=abc'],
    ['a subdomain of it', 'https://a.d.surepay.sa/r?r=abc'],
    ['the bare domain', 'https://surepay.sa/r?r=abc'],
    ['a host dressed up with credentials', 'https://d.surepay.sa@evil.example/r?r=abc'],
    ['another path', 'https://d.surepay.sa/admin?r=abc'],
    ['a path that starts with it', 'https://d.surepay.sa/rr?r=abc'],
    ['no receipt code', 'https://d.surepay.sa/r?x=abc'],
    ['an empty receipt code', 'https://d.surepay.sa/r?r='],
    ['something that is not a URL', 'not a url'],
  ] as const

  for (const [what, url] of refused) {
    it(`refuses ${what}, without calling out`, async () => {
      const called = vi.spyOn(globalThis, 'fetch')
      const response = await post({ url })

      expect(response.status).toBe(400)
      expect(called).not.toHaveBeenCalled()
      expect((await response.json() as { error: string }).error).toMatch(/[؀-ۿ]/)
    })
  }

  it('opens the one link it is for', async () => {
    const called = upstreamReturns(PAGE)
    await post({ url: RECEIPT_URL })

    expect(called).toHaveBeenCalledOnce()
    const [url, options] = called.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(RECEIPT_URL)
    expect(options.redirect).toBe('manual')
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('what comes back', () => {
  it('returns the figures, and none of the page', async () => {
    upstreamReturns(PAGE)
    const body = await (await post({ url: RECEIPT_URL })).json() as {
      ok: boolean
      receipt: { rows: Record<string, unknown>; reference: string; totalsMatched: boolean }
    }

    expect(body.ok).toBe(true)
    expect(body.receipt.rows.totalDb).toEqual({ count: 14, amount: 1406.85 })
    expect(body.receipt.reference).toBe('2332054800406708')
    expect(body.receipt.totalsMatched).toBe(true)
    expect(JSON.stringify(body)).not.toContain('<')
  })

  it('never lets the answer be cached anywhere', async () => {
    upstreamReturns(PAGE)
    const response = await post({ url: RECEIPT_URL })

    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('does not follow a redirect, even off the same host', async () => {
    upstreamReturns('', { status: 302, headers: { location: 'https://evil.example/' } })
    const response = await post({ url: RECEIPT_URL })

    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('evil.example')
  })

  it('says plainly when the receipt has expired', async () => {
    upstreamReturns('gone', { status: 404 })

    expect((await post({ url: RECEIPT_URL })).status).toBe(404)
  })

  it('gives up on a page that is too big to be a receipt', async () => {
    upstreamReturns('x'.repeat(600 * 1024))

    expect((await post({ url: RECEIPT_URL })).status).toBe(502)
  })

  it('gives up when the receipt server does not answer in time', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
    )

    expect((await post({ url: RECEIPT_URL })).status).toBe(504)
  })

  it('says so when the page is not this receipt', async () => {
    upstreamReturns('<html><body>Something else entirely</body></html>')
    const response = await post({ url: RECEIPT_URL })

    expect(response.status).toBe(422)
  })

  it('does not repeat the link back in an error', async () => {
    const response = await post({ url: 'https://evil.example/r?r=secret-token' })

    expect(await response.text()).not.toContain('secret-token')
  })
})

describe('telling one failure from another', () => {
  it('reports the receipt server’s own status, and nothing it said', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>Access denied by WAF</html>', { status: 403 }),
    )
    const response = await post({ url: RECEIPT_URL })
    const body = await response.json() as { upstream: number; error: string }

    expect(body.upstream).toBe(403)
    expect(JSON.stringify(body)).not.toContain('WAF')
  })

  it('says an expired receipt is expired', async () => {
    upstreamReturns('gone', { status: 404 })
    const body = await (await post({ url: RECEIPT_URL })).json() as { upstream: number }

    expect(body.upstream).toBe(404)
  })

  it('asks for the page as a phone browser would', async () => {
    const called = upstreamReturns(PAGE)
    await post({ url: RECEIPT_URL })

    const [, options] = called.mock.calls[0] as [string, RequestInit]
    expect((options.headers as Record<string, string>)['user-agent']).toContain('Mozilla/5.0')
  })
})

describe('telling one failure from another', () => {
  it('reports the receipt server’s own status, and nothing it said', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>Access denied by WAF</html>', { status: 403 }),
    )
    const response = await post({ url: RECEIPT_URL })
    const body = await response.json() as { upstream: number; error: string }

    expect(body.upstream).toBe(403)
    expect(JSON.stringify(body)).not.toContain('WAF')
  })

  it('says an expired receipt is expired', async () => {
    upstreamReturns('gone', { status: 404 })
    const body = await (await post({ url: RECEIPT_URL })).json() as { upstream: number }

    expect(body.upstream).toBe(404)
  })

  it('asks for the page as a phone browser would', async () => {
    const called = upstreamReturns(PAGE)
    await post({ url: RECEIPT_URL })

    const [, options] = called.mock.calls[0] as [string, RequestInit]
    expect((options.headers as Record<string, string>)['user-agent']).toContain('Mozilla/5.0')
  })
})
