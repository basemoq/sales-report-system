import { useRef, useState, type ChangeEvent } from 'react'
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
   * The day's files, and the report is rebuilt from all of them every time the
   * set changes.
   *
   * A camera only ever hands back one shot at a time, and a day's receipt can
   * run to several pages, so a second shot has to join the first rather than
   * replace it. Reading only what was just picked would build a report from the
   * last shot and throw the ones before it away.
   */
  const [queued, setQueued] = useState<UploadedFile[]>([])

  // The run reads the files from here rather than from state: a shot picked
  // while the previous run is still going must be in the batch that follows,
  // and a state update would not have landed yet.
  const files = useRef<UploadedFile[]>([])
  const running = useRef(false)
  const again = useRef(false)

  async function build() {
    // Reading a photograph is slow enough that another shot can arrive mid-run.
    // It is not dropped: the run in flight finishes and then goes round again
    // with the fuller set.
    if (running.current) {
      again.current = true
      return
    }

    running.current = true
    setBusy(true)

    try {
      do {
        again.current = false
        await buildOnce(files.current)
      } while (again.current)
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  async function buildOnce(batch: readonly UploadedFile[]) {
    setError(null)
    setRecognised([])
    setMissing([])
    setNotices([])

    if (batch.length === 0) return

    try {
      const report = await buildDailyReport([...batch], await getIngestedHashes())

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
    }
  }

  function setFiles(next: UploadedFile[]) {
    files.current = next
    setQueued(next)
    void build()
  }

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const picked = [...(event.target.files ?? [])]
    // Re-picking the same files must re-trigger change, so clear the input.
    event.target.value = ''
    if (picked.length === 0) return

    const added = await Promise.all(
      picked.map(async (file) => ({ fileName: file.name, bytes: await file.arrayBuffer() })),
    )
    setFiles([...files.current, ...added])
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
          onChange={onPick}
        />
      </label>

      {/*
        * The camera, spelled out. An iPhone offers it from the picker above on
        * its own; Chrome does not, and `capture` is what asks for it by name on
        * both. A shot joins the day's files and the report is rebuilt, so
        * several pages of one receipt are taken one after another and read
        * together.
        */}
      <div className="upload-actions">
        <label className="link-file">
          التقاط صورة بالكاميرا
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
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
                  onClick={() => setFiles(files.current.filter((_, at) => at !== index))}
                >
                  إزالة
                </button>
              </li>
            ))}
          </ul>
          <div className="upload-actions">
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => setFiles([])}
            >
              إفراغ القائمة
            </button>
          </div>
        </div>
      )}

      {busy && (
        <div className="note info">
          <Icon name="info" />
          <p>جارٍ المعالجة… قراءة صورة قد تستغرق بعض الوقت. تقدر تضيف ملفات أثناء ذلك.</p>
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
