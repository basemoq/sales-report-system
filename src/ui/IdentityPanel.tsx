import type { ReportIdentity } from '../core/dailyReport'

interface Props {
  identity: ReportIdentity
  onChange: (identity: ReportIdentity) => void
  /** What the active template carries, offered as the ready value. */
  fromTemplate: Partial<ReportIdentity>
  /** Suggested names; any other name can still be typed. */
  showrooms: readonly string[]
  supervisors: readonly string[]
}

/** Keeps the template's own value in the list, and never repeats a name. */
const suggestions = (choices: readonly string[], current: string | undefined) =>
  [...new Set([...(current ? [current] : []), ...choices])].filter((name) => name !== '')

export function IdentityPanel({
  identity,
  onChange,
  fromTemplate,
  showrooms,
  supervisors,
}: Props) {
  const fields: {
    key: keyof ReportIdentity
    label: string
    placeholder: string
    options: string[]
  }[] = [
    {
      key: 'showroom',
      label: 'إسم المعرض',
      placeholder: 'مثال: الشرائع',
      options: suggestions(showrooms, fromTemplate.showroom),
    },
    {
      key: 'supervisor',
      label: 'مشرف المعرض',
      placeholder: 'اسم المشرف',
      options: suggestions(supervisors, fromTemplate.supervisor),
    },
  ]

  const missing = fields.filter((field) => identity[field.key].trim() === '')

  return (
    <section className="panel no-print">
      <h2>المعرض والمشرف</h2>
      <p className="muted">يُكتبان في رأس القالب. اكتب الاسم أو اختره من المقترحات.</p>

      <div className="fields">
        {fields.map((field) => (
          <label key={field.key}>
            <span>{field.label}</span>
            <input
              type="text"
              list={`${field.key}-options`}
              value={identity[field.key]}
              placeholder={field.placeholder}
              onChange={(event) => onChange({ ...identity, [field.key]: event.target.value })}
            />
            <datalist id={`${field.key}-options`}>
              {field.options.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </label>
        ))}
      </div>

      {missing.length > 0 && (
        <p className="warn">
          {`سيخرج التقرير بخانة «${missing.map((field) => field.label).join('» و«')}» فارغة.`}
        </p>
      )}
    </section>
  )
}
