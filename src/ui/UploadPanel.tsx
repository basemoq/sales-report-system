import { useState, type ChangeEvent } from 'react'
import { buildDailyReport, type DailyReportBuild, type SourceKind } from '../core/pipeline'
import { getIngestedHashes } from '../db/store'

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
  const [notices, setNotices] = useState<string[]>([])

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const picked = [...(event.target.files ?? [])]
    // Re-picking the same files must re-trigger change, so clear the input.
    event.target.value = ''
    if (picked.length === 0) return

    setBusy(true)
    setError(null)
    setRecognised([])
    setNotices([])

    try {
      const files = await Promise.all(
        picked.map(async (file) => ({ fileName: file.name, bytes: await file.arrayBuffer() })),
      )
      const report = await buildDailyReport(files, await getIngestedHashes())

      setRecognised(
        report.sources.map((source) => `${source.fileName} → ${KIND_LABELS[source.kind]}`),
      )
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
      <h2>رفع ملفات اليوم</h2>
      <p className="muted">
        تقرير CACO المختصر والمفصّل (.xlsx)، وتقرير TABS وإيصال موازنة مدى (.pdf). يتعرّف
        التطبيق على كل ملف من محتواه، فلا يهم ترتيب الرفع ولا أسماء الملفات.
      </p>

      <label className="file-input">
        <span>اختر ملفات اليوم</span>
        <input
          type="file"
          accept=".xlsx,.csv,.pdf"
          multiple
          disabled={busy}
          onChange={onPick}
        />
      </label>

      {busy && <p className="muted">جارٍ المعالجة…</p>}
      {error && <p className="error">{error}</p>}

      {recognised.length > 0 && (
        <ul className="issues">
          {recognised.map((line) => (
            <li key={line} className="ok">
              {line}
            </li>
          ))}
        </ul>
      )}

      {notices.length > 0 && (
        <ul className="issues">
          {notices.map((notice, index) => (
            <li key={index} className="warning">
              {notice}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
