import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import {
  decodeCodePayload,
  findByCode,
  findByMoment,
  parseReceiptPayload,
  readCode,
} from '../core/scan'
import type { CacoTransaction } from '../core/sources/caco'
import { formatMoney } from './format'
import { Icon } from './Icon'

interface Props {
  /** The day's rows, when a CACO detailed export has been uploaded. */
  transactions: readonly CacoTransaction[]
}

type State =
  | { kind: 'idle' }
  | { kind: 'scanning' }
  | { kind: 'read'; code: string; payload: string | null }
  | { kind: 'error'; message: string }

/** The frame the camera is showing, as pixels a decoder can read. */
function frameOf(video: HTMLVideoElement): ImageData | null {
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  if (canvas.width === 0 || canvas.height === 0) return null

  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (context === null) return null
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

export function ScanPanel({ transactions }: Props) {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const timer = useRef<number | null>(null)

  const stop = useCallback(() => {
    if (timer.current !== null) window.clearInterval(timer.current)
    timer.current = null
    // A camera left running keeps the phone's indicator on and drains it.
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
  }, [])

  // Whatever ends the scan — a code read, the panel closing, a reload — must
  // release the camera.
  useEffect(() => stop, [stop])

  async function start() {
    setState({ kind: 'scanning' })
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        // The back camera on a phone; a laptop simply has the one.
        video: { facingMode: { ideal: 'environment' } },
      })
      stream.current = media
      const element = video.current
      if (element === null) return
      element.srcObject = media
      await element.play()

      timer.current = window.setInterval(async () => {
        const frame = element.videoWidth === 0 ? null : frameOf(element)
        if (frame === null) return
        const code = await readCode(frame)
        if (code === null) return
        stop()
        setState({ kind: 'read', code, payload: await decodeCodePayload(code) })
      }, 400)
    } catch (cause) {
      stop()
      setState({
        kind: 'error',
        message:
          (cause as Error).name === 'NotAllowedError'
            ? 'لم يُسمح باستخدام الكاميرا. اسمح بها من إعدادات المتصفح، أو استخدم «من صورة».'
            : `تعذّر تشغيل الكاميرا: ${(cause as Error).message}`,
      })
    }
  }

  /** The way in on a device with no camera, and when the code is a photo. */
  async function fromImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    stop()
    try {
      const bitmap = await createImageBitmap(file)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (context === null) throw new Error('تعذّرت قراءة الصورة.')
      context.drawImage(bitmap, 0, 0)
      const code = await readCode(context.getImageData(0, 0, canvas.width, canvas.height))

      setState(
        code === null
          ? { kind: 'error', message: 'لم يُعثر على باركود في الصورة.' }
          : { kind: 'read', code, payload: await decodeCodePayload(code) },
      )
    } catch (cause) {
      setState({ kind: 'error', message: (cause as Error).message })
    }
  }

  const receipt = state.kind === 'read' ? parseReceiptPayload(state.payload ?? state.code) : null

  // The receipt may be inside the code rather than named by it, so both the
  // code and what it unpacks to are searched.
  const byNumber =
    state.kind === 'read'
      ? findByCode([state.code, state.payload].filter(Boolean).join('\n'), transactions)
      : []

  // The code's reference belongs to the payment network, not to CACO, so most
  // receipts are found by the moment they stamp instead.
  const byMoment = receipt && byNumber.length === 0 ? findByMoment(receipt, transactions) : []
  const matches = byNumber.length > 0 ? byNumber : byMoment

  return (
    <section className="panel no-print">
      <h2>
        <Icon name="scan" />
        قراءة باركود
      </h2>
      <p className="muted">
        امسح باركود الإيصال للعثور على عمليته في ملف CACO المفصّل المرفوع. تعمل القراءة داخل
        الجهاز ولا تُرسل الصورة إلى أي خادم.
      </p>

      <div className="actions">
        {state.kind === 'scanning' ? (
          <button
            type="button"
            className="link"
            onClick={() => {
              stop()
              setState({ kind: 'idle' })
            }}
          >
            إيقاف الكاميرا
          </button>
        ) : (
          <button type="button" onClick={start}>
            فتح الكاميرا
          </button>
        )}

        <label className="link-file">
          من صورة
          <input type="file" accept="image/*" onChange={fromImage} />
        </label>
      </div>

      <video
        ref={video}
        className={state.kind === 'scanning' ? 'scan-view' : 'scan-view is-hidden'}
        muted
        playsInline
      />

      {state.kind === 'error' && (
        <div className="note error">
          <Icon name="error" />
          <p>{state.message}</p>
        </div>
      )}

      {state.kind === 'read' && (
        <>
          <div className="note info">
            <Icon name="info" />
            <p>
              الباركود: <code>{state.code}</code>
            </p>
          </div>

          {state.payload !== null && (
            <div className="note info">
              <Icon name="document" />
              <p>
                محتوى الرمز: <code>{state.payload}</code>
                {receipt?.reference && (
                  <>
                    <br />
                    رقم المرجع: <code>{receipt.reference}</code>
                  </>
                )}
                {receipt?.day && receipt.minutes !== null && (
                  <>
                    <br />
                    وقت العملية: {receipt.day} —{' '}
                    {String(Math.floor(receipt.minutes / 60)).padStart(2, '0')}:
                    {String(receipt.minutes % 60).padStart(2, '0')}
                  </>
                )}
              </p>
            </div>
          )}

          <div className="actions">
            <button
              type="button"
              className="link"
              onClick={() =>
                navigator.clipboard?.writeText(
                  [state.code, state.payload].filter(Boolean).join('\n'),
                )
              }
            >
              نسخ نص الرمز
            </button>
          </div>

          {matches.length === 0 ? (
            <div className="note warn">
              <Icon name="warning" />
              <p>
                {transactions.length === 0
                  ? 'ارفع تقرير CACO المفصّل أولًا للبحث عن العملية.'
                  : 'لا توجد عملية بهذا الرقم في ملف اليوم المرفوع.'}
              </p>
            </div>
          ) : (
            <>
              {byNumber.length === 0 && (
                <p className="muted">
                  لم يحمل الرمز رقمًا من أرقام CACO، فعُثر على العمليات بوقت الإيصال نفسه.
                </p>
              )}
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>الموظف</th>
                      <th>الوقت</th>
                      <th>المبلغ</th>
                      <th>طريقة الدفع</th>
                      <th>الوصف</th>
                      <th>رقم الإيصال</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matches.map((transaction, index) => (
                      <tr key={`${transaction.receiptNo}-${index}`}>
                        <td>{transaction.userId}</td>
                        <td>{transaction.time ?? '—'}</td>
                        <td className="num">{formatMoney(transaction.amount)}</td>
                        <td>{transaction.paymentMethod}</td>
                        <td>{transaction.orderType ?? '—'}</td>
                        <td>{transaction.receiptNo ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
