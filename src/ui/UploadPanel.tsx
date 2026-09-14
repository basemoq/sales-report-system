import { useState, type ChangeEvent } from 'react'
import { buildDailyReport, type DailyReportBuild, type SourceKind } from '../core/pipeline'
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

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const picked = [...(event.target.files ?? [])]
    // Re-picking the same files must re-trigger change, so clear the input.
    event.target.value = ''
    if (picked.length === 0) return

    setBusy(true)
    setError(null)
    setRecognised([])
    setMissing([])
    setNotices([])

    try {
      const files = await Promise.all(
        picked.map(async (file) => ({ fileName: file.name, bytes: await file.arrayBuffer() })),
      )
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
        تقرير CACO المختصر والمفصّل (.xlsx)، وتقرير TABS وإيصال موازنة مدى (.pdf). يتعرّف
        التطبيق على كل ملف من محتواه، فلا يهم ترتيب الرفع ولا أسماء الملفات.
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
        </span>
        <input
          type="file"
          accept=".xlsx,.csv,.pdf"
          multiple
          disabled={busy}
          onChange={onPick}
        />
      </label>

      {busy && (
        <div className="note info">
          <Icon name="info" />
          <p>جارٍ المعالجة…</p>
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
