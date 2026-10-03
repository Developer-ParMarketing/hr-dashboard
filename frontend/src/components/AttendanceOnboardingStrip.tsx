import { useEffect, useState } from 'react'

/** Legacy key - no longer used; cleared so older “Dismiss” choices do not stick. */
const LEGACY_STORAGE_KEY = 'attendance-hr-onboarding-v1'

type Props = {
  visible: boolean
  onGoUpload: () => void
  onGoReview: () => void
  onGoMonthly: () => void
}

export function AttendanceOnboardingStrip({ visible, onGoUpload, onGoReview, onGoMonthly }: Props) {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  if (!visible) return null

  if (hidden) {
    return (
      <p className="text-sm">
        <button
          type="button"
          className="font-medium text-[var(--color-brand)] hover:underline"
          onClick={() => setHidden(false)}
        >
          Show getting started guide
        </button>
      </p>
    )
  }

  return (
    <aside className="attendance-onboard card border" aria-label="Attendance workflow guide">
      <div className="attendance-onboard-head">
        <p className="attendance-onboard-title">Getting started</p>
        <button type="button" className="btn-ghost text-xs" onClick={() => setHidden(true)}>
          Hide
        </button>
      </div>
      <ol className="attendance-onboard-steps">
        <li>
          <button type="button" className="attendance-onboard-step" onClick={onGoUpload}>
            <span className="attendance-onboard-num">1</span>
            <span>
              <strong>Upload</strong>
              <span className="attendance-onboard-hint">Process ESSL daily / weekly / monthly file</span>
            </span>
          </button>
        </li>
        <li>
          <button type="button" className="attendance-onboard-step" onClick={onGoReview}>
            <span className="attendance-onboard-num">2</span>
            <span>
              <strong>Review</strong>
              <span className="attendance-onboard-hint">Open Daily, Weekly, or Monthly tabs</span>
            </span>
          </button>
        </li>
        <li>
          <button type="button" className="attendance-onboard-step" onClick={onGoMonthly}>
            <span className="attendance-onboard-num">3</span>
            <span>
              <strong>Approve monthly</strong>
              <span className="attendance-onboard-hint">Lock the month on the Monthly tab before payroll</span>
            </span>
          </button>
        </li>
      </ol>
    </aside>
  )
}
