import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

/**
 * A section that opens and closes, built on `<details>` so the browser keeps
 * the state and the keyboard works without any of it being written here.
 *
 * Nothing is removed by collapsing: a closed section still prints, so the
 * report on paper carries everything it carried before.
 */
export function Collapsible({
  title,
  icon,
  count,
  tone,
  open = false,
  children,
}: {
  title: string
  icon?: IconName
  /** Shown beside the title, for a section holding a known number of things. */
  count?: number
  tone?: 'warn' | 'plain'
  open?: boolean
  children: ReactNode
}) {
  return (
    <details className={tone === 'warn' ? 'collapsible is-warn' : 'collapsible'} open={open}>
      <summary>
        {icon && <Icon name={icon} />}
        <span className="collapsible-title">{title}</span>
        {count !== undefined && <span className="collapsible-count">{count}</span>}
        <span className="collapsible-arrow" aria-hidden="true" />
      </summary>
      <div className="collapsible-body">{children}</div>
    </details>
  )
}
