import { useState, type ChangeEvent } from 'react'
import { buildReport, type BuiltReport } from '../core/pipeline'
import { getIngestedHashes } from '../db/store'

interface Props {
  onBuilt: (report: BuiltReport) => void
}

export function UploadPanel({ onBuilt }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notices, setNotices] = useState<string[]>([])

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const picked = [...(event.target.files ?? [])]
    event.target.value = ''
    if (picked.length === 0) return

    setBusy(true)
    setError(null)
    setNotices([])

    try {
      const files = await Promise.all(
        picked.map(async (file) => ({ fileName: file.name, bytes: await file.arrayBuffer() })),
      )
      const report = await buildReport(files, await getIngestedHashes())

      setNotices([
        ...report.duplicates.map(
          (hit) =>
            `تم تجاهل «${hit.file.fileName}» — نفس محتوى «${hit.firstSeenAs}» ${
              hit.reason === 'already-stored' ? 'المُدخل سابقًا' : 'المرفوع في نفس الدفعة'
            }.`,
        ),
        ...report.problems.map(
          (problem) => `«${problem.fileName}» صف ${problem.rowNumber}: ${problem.reason}.`,
        ),
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
      <h2>رفع ملفات شور</h2>
      <label className="file-input">
        <span>اختر ملفًا واحدًا أو أكثر (.xlsx أو .csv)</span>
        <input type="file" accept=".xlsx,.csv" multiple disabled={busy} onChange={onPick} />
      </label>

      {busy && <p className="muted">جارٍ المعالجة…</p>}
      {error && <p className="error">{error}</p>}

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
