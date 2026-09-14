import { useEffect, useState, type ChangeEvent } from 'react'
import { sha256Hex } from '../core/hash'
import { validateTemplate, type TemplateValidation } from '../core/template'
import { deleteTemplate, listTemplates, saveTemplate, type StoredTemplate } from '../db/store'

interface Candidate {
  fileName: string
  bytes: ArrayBuffer
  validation: TemplateValidation
}

interface Props {
  /** Called after the stored template is replaced or removed. */
  onTemplateChanged: () => void
}

export function TemplatePanel({ onTemplateChanged }: Props) {
  const [templates, setTemplates] = useState<StoredTemplate[]>([])
  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listTemplates().then(setTemplates).catch((cause: Error) => setError(cause.message))
  }, [])

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Re-picking the same file must re-trigger change, so clear the input.
    event.target.value = ''
    if (!file) return

    setError(null)
    setCandidate(null)
    try {
      const bytes = await file.arrayBuffer()
      setCandidate({
        fileName: file.name,
        bytes,
        validation: await validateTemplate(file.name, bytes),
      })
    } catch (cause) {
      setError((cause as Error).message)
    }
  }

  async function confirmSave() {
    if (candidate === null || !candidate.validation.valid) return
    try {
      await saveTemplate({
        id: 'default',
        name: candidate.fileName.replace(/\.[^.]+$/, ''),
        fileName: candidate.fileName,
        hash: await sha256Hex(candidate.bytes),
        bytes: candidate.bytes,
        savedAt: new Date().toISOString(),
      })
      setTemplates(await listTemplates())
      setCandidate(null)
      onTemplateChanged()
    } catch (cause) {
      setError((cause as Error).message)
    }
  }

  async function remove(id: string) {
    await deleteTemplate(id)
    setTemplates(await listTemplates())
    onTemplateChanged()
  }

  const stored = templates[0]

  return (
    <section className="panel no-print">
      <h2>القالب</h2>

      {stored ? (
        <p>
          القالب المستخدَم: <strong>{stored.fileName}</strong>{' '}
          <button type="button" className="link" onClick={() => remove(stored.id)}>
            حذف والعودة للمدمج
          </button>
        </p>
      ) : (
        <p className="muted">
          يعمل التطبيق على <strong>القالب المدمج</strong> — جاهز على أي جهاز بلا رفع. ارفع ملفًا
          هنا فقط إن أردت استخدام قالب مختلف.
        </p>
      )}

      <label className="file-input">
        <span>استخدام قالب آخر (.xlsx)</span>
        <input type="file" accept=".xlsx" onChange={onPick} />
      </label>

      {error && <p className="error">{error}</p>}

      {candidate && (
        <div className="review">
          <h3>مراجعة «{candidate.fileName}»</h3>

          {candidate.validation.issues.length > 0 && (
            <ul className="issues">
              {candidate.validation.issues.map((issue, index) => (
                <li key={index} className={issue.severity}>
                  {issue.message}
                </li>
              ))}
            </ul>
          )}

          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ورقة العمل</th>
                  <th>صفوف</th>
                  <th>معادلات</th>
                </tr>
              </thead>
              <tbody>
                {candidate.validation.stats.sheetNames.map((sheet) => (
                  <tr key={sheet}>
                    <td>{sheet}</td>
                    <td className="num">{candidate.validation.stats.populatedRows[sheet] ?? 0}</td>
                    <td className="num">{candidate.validation.stats.formulaCells[sheet] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {candidate.validation.valid ? (
            <div className="actions">
              <button type="button" onClick={confirmSave}>
                {stored ? 'تأكيد الاستبدال' : 'تأكيد الحفظ'}
              </button>
              <button type="button" className="link" onClick={() => setCandidate(null)}>
                إلغاء
              </button>
              {stored && (
                <p className="warn">سيحل هذا القالب محل «{stored.fileName}» نهائيًا.</p>
              )}
            </div>
          ) : (
            <p className="error">لا يمكن حفظ هذا الملف كقالب حتى تُعالَج الأخطاء أعلاه.</p>
          )}
        </div>
      )}
    </section>
  )
}
