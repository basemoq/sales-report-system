import { afterEach, describe, expect, it, vi } from 'vitest'
import handler from './handler'

const ORIGIN = 'https://basemoq.github.io'
const RECEIPT_URL = 'https://d.surepay.sa/r?r=H4sIAAAAAAAAAAXBAQEAIAgDwUrPNhDL2D%2BG'
const PAGE = `<html><body><h1>WINDTEL Telecom</h1><div>14/09/2026 23:50:01</div>
<div>2332054800406708</div><div>TotalsMatched</div>
<table><tr><td>TOTAL DB</td><td>14</td><td>1,406.85</td></tr>
<tr><td>TOTAL CR</td><td>0</td><td>0.00</td></tr></table></body></html>`

/** Node's request and response, as much of them as the handler touches. */
function call(
  body: unknown,
  { origin = ORIGIN as string | null, method = 'POST', type = 'application/json', ip = '' } = {},
) {
  const headers: Record<string, string> = { 'content-type': type }
  if (origin !== null) headers.origin = origin
  if (ip !== '') headers['x-forwarded-for'] = ip

  const sent: { status: number; body: string | undefined; headers: Record<string, string> } = {
    status: 0,
    body: undefined,
    headers: {},
  }
  const response = {
    set statusCode(value: number) {
      sent.status = value
    },
    get statusCode() {
      return sent.status
    },
    setHeader: (name: string, value: string) => {
      sent.headers[name] = value
    },
    end: (chunk?: string) => {
      sent.body = chunk
    },
  }

  return handler({ method, headers, body, on: () => {} }, response).then(() => ({
    ...sent,
    json: () => JSON.parse(sent.body ?? 'null'),
  }))
}

/** A fresh Response per call: a body can only be read once. */
const upstreamReturns = (page: string, init: ResponseInit = {}) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(page, init))

afterEach(() => vi.restoreAllMocks())

describe('the Vercel reader', () => {
  it('reads a receipt and returns the figures alone', async () => {
    upstreamReturns(PAGE)
    const result = await call({ url: RECEIPT_URL }, { ip: '1.1.1.1' })

    expect(result.status).toBe(200)
    expect(result.json().receipt.rows.totalDb).toEqual({ count: 14, amount: 1406.85 })
    expect(result.body).not.toContain('<')
    expect(result.headers['cache-control']).toBe('no-store')
    expect(result.headers['access-control-allow-origin']).toBe(ORIGIN)
  })

  it('reads a body Vercel handed over as text', async () => {
    upstreamReturns(PAGE)
    const result = await call(JSON.stringify({ url: RECEIPT_URL }), { ip: '1.1.1.2' })

    expect(result.status).toBe(200)
  })

  it('refuses a call from another site', async () => {
    const result = await call({ url: RECEIPT_URL }, { origin: 'https://evil.example' })

    expect(result.status).toBe(403)
    expect(result.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('answers a preflight', async () => {
    const result = await call(null, { method: 'OPTIONS' })

    expect(result.status).toBe(204)
    expect(result.headers['access-control-allow-origin']).toBe(ORIGIN)
  })

  it('takes the link in the body only', async () => {
    expect((await call(null, { method: 'GET' })).status).toBe(405)
  })

  it('applies the same checks to the link as the Worker does', async () => {
    const called = vi.spyOn(globalThis, 'fetch')

    for (const url of [
      'http://d.surepay.sa/r?r=a',
      'https://d.surepay.sa.evil.com/r?r=a',
      'https://d.surepay.sa/admin?r=a',
      'https://d.surepay.sa/r?x=a',
    ]) {
      expect((await call({ url }, { ip: '1.1.1.3' })).status).toBe(400)
    }
    expect(called).not.toHaveBeenCalled()
  })

  it('reports the receipt server’s status without its content', async () => {
    upstreamReturns('<html>denied</html>', { status: 401 })
    const result = await call({ url: RECEIPT_URL }, { ip: '1.1.1.4' })

    expect(result.status).toBe(502)
    expect(result.json().upstream).toBe(401)
    expect(result.body).not.toContain('denied')
  })

  it('does not follow a redirect', async () => {
    upstreamReturns('', { status: 302, headers: { location: 'https://evil.example/' } })
    const result = await call({ url: RECEIPT_URL }, { ip: '1.1.1.5' })

    expect(result.status).toBe(502)
    expect(result.body).not.toContain('evil.example')
  })

  it('asks for the page the way the Worker does, and never follows redirects', async () => {
    const called = upstreamReturns(PAGE)
    await call({ url: RECEIPT_URL }, { ip: '1.1.1.6' })

    const [, options] = called.mock.calls[0] as [string, RequestInit]
    expect(options.redirect).toBe('manual')
    expect((options.headers as Record<string, string>)['user-agent']).toContain('Mozilla/5.0')
  })

  it('stops a caller that floods one instance', async () => {
    upstreamReturns(PAGE)
    const flood = '9.9.9.9'
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await call({ url: RECEIPT_URL }, { ip: flood })
    }

    expect((await call({ url: RECEIPT_URL }, { ip: flood })).status).toBe(429)
  })
})
