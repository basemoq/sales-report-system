import { useState, type ChangeEvent } from 'react'
import {
  buildDailyReport,
  type DailyReportBuild,
  type SourceKind,
  type UploadedFile,
} from '../core/pipeline'
import { getIngestedHashes } from '../db/store'
import { Icon } from './Icon'

interface Props {
  onBuilt: (report: DailyReportBuild) => void
}

const KIND_LABELS: Record<SourceKind, string> = {
  'caco-summary': 'CACO مختصر',
  'caco-detailed': 'CACO مفصّل',
  tabs: 'TABS',
  mada: 'موازنة مدى',
}

export function UploadPanel({ onBuilt }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recognised, setRecognised] = useState<string[]>([])
  const [missing, setMissing] = useState<string[]>([])
  const [notices, setNotices] = useState<string[]>([])
  /**
   * Picked files wait here until the operator says to go.
   *
   * A camera only ever hands back one shot at a time, and a day's receipt can
   * run to several pages, so the files gather first and are read as one batch.
   * Reading each pick on its own would build a report from the last shot and
   * throw away the ones before it.
   */
  const [queued, setQueued] = useState<UploadedFile[]>([])

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const picked = [...(event.target.files ?? [])]
    // Re-picking the same files must re-trigger change, so clear the input.
    event.target.value = ''
    if (picked.length === 0) return

    setError(null)
    const added = await Promise.all(
      picked.map(async (file) => ({ fileName: file.name, bytes: await file.arrayBuffer() })),
    )
    setQueued((waiting) => [...waiting, ...added])
  }

  async function process() {
    const files = queued
    if (files.length === 0) return

    setBusy(true)
    setError(null)
    setRecognised([])
    setMissing([])
    setNotices([])

    try {
      const report = await buildDailyReport(files, await getIngestedHashes())

      setRecognised(
        report.sources.map((source) => `${source.fileName} → ${KIND_LABELS[source.kind]}`),
      )
      setMissing(report.missingSources)
      setNotices([
        ...report.duplicates.map(
          (hit) =>
            `تم تجاهل «${hit.file.fileName}» — نفس محتوى «${hit.firstSeenAs}» ${
              hit.reason === 'already-stored' ? 'المُدخل سابقًا' : 'المرفوع في نفس الدفعة'
            }.`,
        ),
        ...report.unrecognised.map((file) => `«${file.fileName}»: ${file.reason}`),
        ...report.warnings,
      ])
      onBuilt(report)
      setQueued([])
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel no-print">
      <h2>
        <Icon name="upload" />
        رفع ملفات اليوم
      </h2>
      <p className="muted">
        تقرير CACO المختصر والمفصّل (.xlsx)، وتقرير TABS وإيصال موازنة مدى (.pdf أو صورة).
        يتعرّف التطبيق على كل ملف من محتواه، فلا يهم ترتيب الرفع ولا أسماء الملفات.
      </p>

      {/*
        * The input still does the work — it simply covers the card, so the
        * native click-to-browse and drag-and-drop both keep working unchanged.
        */}
      <label className={busy ? 'dropzone is-busy' : 'dropzone'}>
        <Icon name="upload" />
        <span className="dropzone-title">اسحب الملفات هنا أو اضغط لاختيارها</span>
        <span className="dropzone-formats">
          <span className="badge">XLSX</span>
          <span className="badge">CSV</span>
          <span className="badge">PDF</span>
          <span className="badge">صور</span>
        </span>
        <input
          type="file"
          accept=".xlsx,.csv,.pdf,.png,.jpg,.jpeg,.heic,.webp,image/*"
          multiple
          disabled={busy}
          onChange={onPick}
        />
      </label>

      {/*
        * The camera, spelled out. An iPhone offers it from the picker above on
        * its own; Chrome does not, and `capture` is what asks for it by name on
        * both. A shot lands in the queue, so several pages of one receipt are
        * taken one after another and read together.
        */}
      <div className="upload-actions">
        <label className="link-file">
          التقاط صورة بالكاميرا
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            disabled={busy}
            onChange={onPick}
          />
        </label>
      </div>

      {queued.length > 0 && (
        <div className="queue">
          <ul className="issues">
            {queued.map((file, index) => (
              <li key={`${file.fileName}-${index}`}>
                <Icon name="upload" />
                <span>{file.fileName}</span>
                <button
                  type="button"
                  className="queue-remove"
                  disabled={busy}
                  onClick={() =>
                    setQueued((waiting) => waiting.filter((_, at) => at !== index))
                  }
                >
                  إزالة
                </button>
              </li>
            ))}
          </ul>
          <div className="upload-actions">
            <button type="button" disabled={busy} onClick={process}>
              معالجة {queued.length} ملف
            </button>
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => setQueued([])}
            >
              إفراغ القائمة
            </button>
          </div>
        </div>
      )}

      {busy && (
        <div className="note info">
          <Icon name="info" />
          <p>جارٍ المعالجة… قراءة صورة قد تستغرق بعض الوقت.</p>
        </div>
      )}
      {error && (
        <div className="note error">
          <Icon name="error" />
          <p>{error}</p>
        </div>
      )}

      {recognised.length > 0 && (
        <ul className="issues">
          {recognised.map((line) => (
            <li key={line} className="ok">
              <Icon name="success" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}

      {missing.length > 0 && (
        <div className="note info">
          <Icon name="info" />
          <p>لم تُرفع: {missing.join('، ')} — تُحتسب صفرًا، والتقرير يكتمل بدونها.</p>
        </div>
      )}

      {notices.length > 0 && (
        <ul className="issues">
          {notices.map((notice, index) => (
            <li key={index} className="warning">
              <Icon name="warning" />
              <span>{notice}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
