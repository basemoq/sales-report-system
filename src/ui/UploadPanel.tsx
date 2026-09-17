import { useRef, useState, type ChangeEvent } from 'react'
import {
  buildDailyReport,
  type DailyReportBuild,
  type SourceKind,
  type UploadedFile,
} from '../core/pipeline'
import { readCodeFromImage } from '../core/scan'
import { getIngestedHashes } from '../db/store'
import { Collapsible } from './Collapsible'
import { Icon, type IconName } from './Icon'

/**
 * The look of a file in the list, by its name. Nothing is decided from this —
 * what a file actually is, the app works out from its content after the upload
 * — it is the shape on the row while that is happening.
 */
function looksLike(fileName: string): { icon: IconName; tone: string } {
  const name = fileName.toLowerCase()
  if (name.endsWith('.xlsx') || name.endsWith('.csv')) return { icon: 'sheet', tone: 'sheet' }
  if (name.endsWith('.pdf')) return { icon: 'document', tone: 'pdf' }
  return { icon: 'image', tone: 'image' }
}

/** File size as a person reads it. */
function sizeOf(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

interface Props {
  onBuilt: (report: DailyReportBuild) => void
  /**
   * A code found printed on a picked photograph. Reported as soon as it is
   * read, and apart from the report: a picture of a code is worth reading
   * whether or not the day has any figures to go with it.
   */
  onCode: (found: { code: string; payload: string | null }) => void
}

const KIND_LABELS: Record<SourceKind, string> = {
  'caco-summary': 'CACO مختصر',
  'caco-detailed': 'CACO مفصّل',
  tabs: 'TABS',
  mada: 'موازنة مدى',
}

/** What became of one uploaded file, for the row that reports it. */
interface FileOutcome {
  fileName: string
  kind: string
  /** Green when it was read, orange when it was not. */
  ok: boolean
  status: string
}

/** A file the run never reported on, because the run itself failed. */
const failedOutcome = (fileName: string): FileOutcome => ({
  fileName,
  kind: '—',
  ok: false,
  status: 'تعذّرت المعالجة — انظر الرسالة أدناه.',
})

/** What the last run produced, kept apart so each kind gets its own panel. */
interface Outcome {
  files: FileOutcome[]
  missing: string[]
  warnings: string[]
}

const EMPTY: Outcome = { files: [], missing: [], warnings: [] }

export function UploadPanel({ onBuilt, onCode }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome>(EMPTY)
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
    setOutcome(EMPTY)

    if (batch.length === 0) return

    try {
      const report = await buildDailyReport([...batch], await getIngestedHashes())

      setOutcome({
        files: [
          ...report.sources.map((source) => ({
            fileName: source.fileName,
            kind: KIND_LABELS[source.kind],
            ok: true,
            status: 'قُرئ',
          })),
          ...report.duplicates.map((hit) => ({
            fileName: hit.file.fileName,
            kind: '—',
            ok: false,
            status: `مكرر — نفس محتوى «${hit.firstSeenAs}» ${
              hit.reason === 'already-stored' ? 'المُدخل سابقًا' : 'المرفوع في نفس الدفعة'
            }`,
          })),
          ...report.unrecognised.map((file) => ({
            fileName: file.fileName,
            kind: '—',
            ok: false,
            status: file.reason,
          })),
        ],
        missing: report.missingSources,
        warnings: report.warnings,
      })
      onBuilt(report)
    } catch (cause) {
      setError((cause as Error).message)
      // Without this every row keeps saying it is being read, while the message
      // underneath says the reading is over.
      setOutcome({
        files: batch.map((file) => failedOutcome(file.fileName)),
        missing: [],
        warnings: [],
      })
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

    // Looked for while the report is being built rather than after it, since
    // the build can end with nothing to report and the code still matters.
    for (const file of added) {
      if (!/\.(png|jpe?g|heic|heif|webp|gif|bmp)$/i.test(file.fileName)) continue
      void readCodeFromImage(file.bytes).then((found) => {
        if (found !== null) onCode(found)
      })
    }
  }

  const read = outcome.files.filter((file) => file.ok)
  // Rows are shown in the order they were picked, so each is looked up by name.
  const found = new Map(outcome.files.map((file) => [file.fileName, file]))

  return (
    <section className="panel no-print">
      <h2>
        <Icon name="upload" />
        رفع الملفات
      </h2>

      {/*
        * The input still does the work — it simply covers the card, so the
        * native click-to-browse and drag-and-drop both keep working unchanged.
        */}
      <label className={busy ? 'dropzone is-busy' : 'dropzone'}>
        <Icon name="upload" />
        <span className="dropzone-title">اسحب الملفات هنا أو اخترها من جهازك</span>
        <span className="dropzone-sub">يمكنك رفع ملف واحد أو عدة ملفات</span>
        <span className="dropzone-cta">اختيار الملفات</span>
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

      <p className="muted hint">
        سيتم التعرّف على نوع كل ملف وتصنيفه تلقائيًا بعد الرفع.
      </p>

      {queued.length === 0 && (
        <p className="empty-line">
          <Icon name="document" />
          لم يتم اختيار ملفات بعد
        </p>
      )}

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
        <div className="panel-card">
          <h3>
            <Icon name="document" />
            الملفات المرفوعة ({queued.length})
          </h3>

          {/*
            * One row per file: what it is called, how big it is, what the app
            * worked out it is, and how the reading went. The reason a file was
            * turned away can run long, so it opens rather than sitting on the
            * row.
            */}
          <ul className="file-rows">
            {queued.map((file, index) => {
              const outcome = found.get(file.fileName)
              const look = looksLike(file.fileName)
              return (
                <li key={`${file.fileName}-${index}`}>
                  <details>
                    <summary>
                      <span className={`file-icon is-${look.tone}`}>
                        <Icon name={look.icon} />
                      </span>
                      <span className="file-main">
                        <span className="file-name" title={file.fileName}>
                          {file.fileName}
                        </span>
                        <span className="file-size">{sizeOf(file.bytes.byteLength)}</span>
                      </span>
                      <span
                        className={
                          outcome === undefined
                            ? 'pill is-waiting'
                            : outcome.ok
                              ? 'pill is-ok'
                              : 'pill is-warn'
                        }
                      >
                        {outcome === undefined ? 'قيد القراءة' : outcome.ok ? 'تمت القراءة' : 'لم تُقرأ'}
                      </span>
                      <span className="collapsible-arrow" aria-hidden="true" />
                    </summary>
                    <div className="file-detail">
                      <p className="file-full">{file.fileName}</p>
                      {outcome !== undefined && outcome.kind !== '—' && (
                        <p>
                          النوع: <strong>{outcome.kind}</strong>
                        </p>
                      )}
                      <p>{outcome === undefined ? 'في انتظار القراءة.' : outcome.status}</p>
                      <button
                        type="button"
                        className="queue-remove"
                        disabled={busy}
                        onClick={() => setFiles(files.current.filter((_, at) => at !== index))}
                      >
                        إزالة الملف
                      </button>
                    </div>
                  </details>
                </li>
              )
            })}
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

      {/* Red is kept for what stops the day being reported at all. */}
      {error && (
        <div className="note error">
          <Icon name="error" />
          <p>{error}</p>
        </div>
      )}

      {read.length > 0 && (
        <div className="done-panel">
          <span className="done-mark">
            <Icon name="success" />
          </span>
          <div>
            <h3>اكتمل الفحص بنجاح</h3>
            <ul>
              <li>
                تم التعرّف على {read.length} ملف وقراءته: {read.map((file) => file.kind).join('، ')}.
              </li>
              <li>تم التحقق من الأرقام ومطابقتها.</li>
            </ul>
          </div>
        </div>
      )}

      {outcome.missing.length > 0 && (
        <div className="note info">
          <Icon name="info" />
          <p>
            لم تُرفع: {outcome.missing.join('، ')} — تُحتسب صفرًا، والتقرير يكتمل بدونها.
          </p>
        </div>
      )}

      {/* Every warning the build produced, word for word, none dropped. */}
      {outcome.warnings.length > 0 && (
        <Collapsible
          title={
            outcome.warnings.length === 1
              ? 'تنبيه يحتاج مراجعتك'
              : outcome.warnings.length === 2
                ? 'تنبيهان يحتاجان مراجعتك'
                : 'تنبيهات تحتاج مراجعتك'
          }
          icon="warning"
          count={outcome.warnings.length}
          tone="warn"
          open
        >
          <ul className="issues">
            {outcome.warnings.map((warning, index) => (
              <li key={index} className="warning">
                <Icon name="warning" />
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        </Collapsible>
      )}
    </section>
  )
}
