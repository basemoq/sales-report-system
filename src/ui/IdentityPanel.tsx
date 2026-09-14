import type { ReportIdentity } from '../core/dailyReport'

interface Props {
  identity: ReportIdentity
  onChange: (identity: ReportIdentity) => void
  /** What the stored template carries, offered as the ready choice. */
  fromTemplate: Partial<ReportIdentity>
  /** Names to choose from; the template's own value is always included. */
  showrooms: readonly string[]
  supervisors: readonly string[]
}

/** Keeps the template's own value in the list, and never repeats a name. */
const optionsFor = (choices: readonly string[], current: string | undefined) =>
  [...new Set([...(current ? [current] : []), ...choices])].filter((name) => name !== '')

export function IdentityPanel({
  identity,
  onChange,
  fromTemplate,
  showrooms,
  supervisors,
}: Props) {
  const showroomOptions = optionsFor(showrooms, fromTemplate.showroom)
  const supervisorOptions = optionsFor(supervisors, fromTemplate.supervisor)

  return (
    <section className="panel no-print">
      <h2>المعرض والمشرف</h2>
      <p className="muted">
        يُكتبان في رأس القالب. الافتراضي ما يحمله القالب المحفوظ.
      </p>

      <div className="fields">
        <label>
          <span>إسم المعرض</span>
          <select
            value={identity.showroom}
            onChange={(event) => onChange({ ...identity, showroom: event.target.value })}
          >
            {showroomOptions.length === 0 && <option value="">— لا يوجد قالب محفوظ —</option>}
            {showroomOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>مشرف المعرض</span>
          <select
            value={identity.supervisor}
            onChange={(event) => onChange({ ...identity, supervisor: event.target.value })}
          >
            {supervisorOptions.length === 0 && <option value="">— لا يوجد قالب محفوظ —</option>}
            {supervisorOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  )
}
