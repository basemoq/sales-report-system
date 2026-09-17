import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

/**
 * The day's warnings behind a single mark.
 *
 * Every one of them still has to be read before a day is signed off, but laid
 * out down the page they pushed the figures below the fold and made an ordinary
 * day look like a wreck. So they sit behind one mark carrying their count, and
 * open over the page rather than in it — nothing is dropped, and nothing is
 * pushed down to make room.
 */
export function WarningsBubble({ warnings }: { warnings: readonly string[] }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const close = (event: Event) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (warnings.length === 0) return null

  const label =
    warnings.length === 1
      ? 'تنبيه يحتاج مراجعتك'
      : warnings.length === 2
        ? 'تنبيهان يحتاجان مراجعتك'
        : `${warnings.length} تنبيهات تحتاج مراجعتك`

  return (
    <div className="warn-mark" ref={box}>
      <button
        type="button"
        className={open ? 'warn-button is-open' : 'warn-button'}
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((shown) => !shown)}
      >
        <Icon name="warning" />
        <span className="warn-count">{warnings.length}</span>
        <span className="warn-label">{label}</span>
      </button>

      {open && (
        <div className="warn-bubble" role="dialog" aria-label={label}>
          <ul>
            {warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
