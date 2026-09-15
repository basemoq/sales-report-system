import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The file that is actually pasted into the dashboard, tested as the dashboard
 * will run it — so a bundle that fell out of step with the source cannot be
 * deployed unnoticed.
 */
const bundle = await import('../dist/worker.js')
const worker = bundle.default as {
  fetch: (request: Request, env: Record<string, unknown>) => Promise<Response>
}

const ORIGIN = 'https://basemoq.github.io'
const PAGE = `<html><body><h1>WINDTEL Telecom</h1><div>14/09/2026 23:50:01</div>
<div>2332054800406708</div><div>TotalsMatched</div>
<table><tr><td>TOTAL DB</td><td>14</td><td>1,406.85</td></tr>
<tr><td>TOTAL CR</td><td>0</td><td>0.00</td></tr></table></body></html>`

const post = (url: string) =>
  worker.fetch(
    new Request('https://worker.example/', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    }),
    {},
  )

afterEach(() => vi.restoreAllMocks())

describe('the pasted bundle', () => {
  it('reads a receipt', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(PAGE))
    const body = await (await post('https://d.surepay.sa/r?r=abc')).json() as {
      ok: boolean
      receipt: { rows: Record<string, unknown> }
    }

    expect(body.ok).toBe(true)
    expect(body.receipt.rows.totalDb).toEqual({ count: 14, amount: 1406.85 })
  })

  it('still refuses everything it should', async () => {
    const called = vi.spyOn(globalThis, 'fetch')

    expect((await post('https://d.surepay.sa.evil.com/r?r=abc')).status).toBe(400)
    expect((await post('http://d.surepay.sa/r?r=abc')).status).toBe(400)
    expect(called).not.toHaveBeenCalled()
  })
})
