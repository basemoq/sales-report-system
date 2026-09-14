import { useState } from 'react'
import type { ReportIdentity } from '../core/dailyReport'
import { Icon } from './Icon'

interface Props {
  identity: ReportIdentity
  onChange: (identity: ReportIdentity) => void
  showrooms: readonly string[]
  supervisors: readonly string[]
}

const OTHER = '__other__'

export function IdentityPanel({ identity, onChange, showrooms, supervisors }: Props) {
  // Which fields the operator switched to typing, so an emptied box stays open.
  const [typing, setTyping] = useState<Partial<Record<keyof ReportIdentity, boolean>>>({})

  const fields: {
    key: keyof ReportIdentity
    label: string
    placeholder: string
    choices: string[]
  }[] = [
    {
      key: 'showroom',
      label: 'إسم المعرض',
      placeholder: 'اكتب اسم المعرض',
      choices: [...showrooms],
    },
    {
      key: 'supervisor',
      label: 'مشرف المعرض',
      placeholder: 'اكتب اسم المشرف',
      choices: [...supervisors],
    },
  ]

  const missing = fields.filter((field) => identity[field.key].trim() === '')

  return (
    <section className="panel no-print">
      <h2>
        <Icon name="store" />
        المعرض والمشرف
      </h2>
      <p className="muted">يُكتبان في رأس القالب. اختر من القائمة، أو «أخرى» لكتابة اسم جديد.</p>

      <div className="fields">
        {fields.map((field) => {
          const value = identity[field.key]
          // A stored name that is not one of the choices is a typed one.
          const isTyping = typing[field.key] || (value !== '' && !field.choices.includes(value))

          return (
            <label key={field.key}>
              <span>{field.label}</span>
              <select
                value={isTyping ? OTHER : value}
                onChange={(event) => {
                  const picked = event.target.value
                  setTyping({ ...typing, [field.key]: picked === OTHER })
                  onChange({ ...identity, [field.key]: picked === OTHER ? '' : picked })
                }}
              >
                <option value="">— اختر —</option>
                {field.choices.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
                <option value={OTHER}>أخرى…</option>
              </select>

              {isTyping && (
                <input
                  type="text"
                  value={value}
                  placeholder={field.placeholder}
                  autoFocus
                  onChange={(event) =>
                    onChange({ ...identity, [field.key]: event.target.value })
                  }
                />
              )}
            </label>
          )
        })}
      </div>

      {missing.length > 0 && (
        <div className="note warn">
          <Icon name="warning" />
          <p>
            {`سيخرج التقرير بخانة «${missing.map((field) => field.label).join('» و«')}» فارغة.`}
          </p>
        </div>
      )}
    </section>
  )
}
