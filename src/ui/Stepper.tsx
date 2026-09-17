/**
 * Where the day's work has reached, along the four stages it goes through.
 *
 * Purely a read-out: every stage is worked out from state the app already
 * keeps, and nothing here gates anything. The app has never had steps to walk
 * through — files are read as they arrive — so this says where things stand
 * rather than telling anyone what to do next.
 */

const STEPS = ['المعلومات', 'الملفات', 'التحقق', 'التقارير'] as const

export interface StepperState {
  /** The header names are filled in. */
  identity: boolean
  /** At least one file is in the day's batch. */
  files: boolean
  /** A report was built, so the checks have run. */
  checked: boolean
}

export function Stepper({ identity, files, checked }: StepperState) {
  const done = [identity, files, checked, checked]
  // The stage being worked on: the first unfinished one, or the last.
  const current = done.indexOf(false) === -1 ? STEPS.length - 1 : done.indexOf(false)

  return (
    <nav className="stepper no-print" aria-label="مراحل إعداد التقرير">
      <ol>
        {STEPS.map((step, index) => (
          <li
            key={step}
            className={
              done[index] ? 'is-done' : index === current ? 'is-current' : 'is-waiting'
            }
            aria-current={index === current ? 'step' : undefined}
          >
            <span className="step-dot">{done[index] ? '✓' : index + 1}</span>
            <span className="step-name">{step}</span>
          </li>
        ))}
      </ol>
    </nav>
  )
}
