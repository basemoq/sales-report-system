import { useRef, useState, type ChangeEvent } from 'react'
import {
  buildDailyReport,
  type DailyReportBuild,
  type SourceKind,
  type UploadedFile,
} from '../core/pipeline'
import { getIngestedHashes } from '../db/store'
import { Collapsible } from './Collapsible'
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

/** What became of one uploaded file, for the row that reports it. */
interface FileOutcome {
  fileName: string
  kind: string
  /** Green when it was read, orange when it was not. */
  ok: boolean
  status: string
}

/** What the last run produced, kept apart so each kind gets its own panel. */
interface Outcome {
  files: FileOutcome[]
  missing: string[]
  warnings: string[]
}

const EMPTY: Outcome = { files: [], missing: [], warnings: [] }

export function UploadPanel({ onBuilt }: Props) {
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
          {/*
            * One row per file: what it is called, what the app worked out it
            * is, and how the reading went. The queue and the outcome used to be
            * two lists of the same names.
            */}
          <ul className="file-rows">
            {queued.map((file, index) => {
              const outcome = found.get(file.fileName)
              return (
                <li
                  key={`${file.fileName}-${index}`}
                  className={outcome === undefined ? '' : outcome.ok ? 'ok' : 'warning'}
                >
                  <Icon
                    name={
                      outcome === undefined ? 'document' : outcome.ok ? 'success' : 'warning'
                    }
                  />
                  <span className="file-name">{file.fileName}</span>
                  {outcome !== undefined && <span className="file-kind">{outcome.kind}</span>}
                  <button
                    type="button"
                    className="queue-remove"
                    disabled={busy}
                    onClick={() => setFiles(files.current.filter((_, at) => at !== index))}
                  >
                    إزالة
                  </button>
                  <span className="file-status">
                    {outcome === undefined ? 'في انتظار القراءة' : outcome.status}
                  </span>
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
        <div className="note ok">
          <Icon name="success" />
          <p>
            تم التعرّف على {read.length} ملف: {read.map((file) => file.kind).join('، ')}.
          </p>
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
          title="تنبيهات تحتاج مراجعتك"
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
