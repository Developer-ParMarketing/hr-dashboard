import type { CycleFormPairIssue } from '../utils/cycleFormValidation'

type Props = {
  issues: CycleFormPairIssue[]
  readyCount: number
  totalSteps: number
  onJumpTo: (step: number | 'overall') => void
}

function issueActionLabel(status: CycleFormPairIssue['status']): string {
  return status === 'needsComments' ? 'Needs comments' : 'Needs rating'
}

export function CycleFormSubmitChecklist({ issues, readyCount, totalSteps, onJumpTo }: Props) {
  if (issues.length === 0 && readyCount >= totalSteps) return null

  const pct = totalSteps > 0 ? Math.round((readyCount / totalSteps) * 100) : 0
  const remaining = Math.max(0, totalSteps - readyCount)

  return (
    <section className="perf-submit-checklist" aria-labelledby="perf-submit-checklist-title">
      <div className="perf-submit-checklist-head">
        <div className="min-w-0 flex-1">
          <p id="perf-submit-checklist-title" className="perf-submit-checklist-title">
            Ready to submit
          </p>
          <p className="perf-submit-checklist-desc">
            Each item needs a <span className="font-medium text-[var(--color-ink)]">rating</span> and{' '}
            <span className="font-medium text-[var(--color-ink)]">comments</span>. Save progress
            anytime; submit unlocks when every step is complete.
          </p>
        </div>
        <div className="perf-submit-checklist-meter" aria-hidden>
          <span className="perf-submit-checklist-meter-value tabular-nums">{pct}%</span>
          <div className="perf-submit-checklist-meter-track">
            <div className="perf-submit-checklist-meter-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="perf-submit-checklist-meter-caption tabular-nums">
            {readyCount}/{totalSteps} steps
          </span>
        </div>
      </div>

      {issues.length > 0 ? (
        <ul className="perf-submit-checklist-items">
          {issues.map((issue, idx) => (
            <li key={`${String(issue.step)}-${idx}`}>
              <button
                type="button"
                className="perf-submit-checklist-item"
                onClick={() => onJumpTo(issue.step)}
              >
                <span className="perf-submit-checklist-item-num">
                  {issue.step === 'overall' ? '★' : issue.step}
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm font-medium text-[var(--color-ink)]">
                    {issue.title}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--color-warm-text)]">
                    {issue.status === 'needsComments'
                      ? 'Rating selected - add comments'
                      : 'Comments written - choose a rating'}
                  </span>
                </span>
                <span
                  className={`perf-submit-checklist-chip ${
                    issue.status === 'needsComments'
                      ? 'perf-submit-checklist-chip-comments'
                      : 'perf-submit-checklist-chip-rating'
                  }`}
                >
                  {issueActionLabel(issue.status)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : remaining > 0 ? (
        <p className="perf-submit-checklist-empty-hint text-sm text-[var(--color-warm-text)]">
          {remaining} step{remaining === 1 ? '' : 's'} still empty - open each item in the sidebar
          and fill rating + comments, including Overall.
        </p>
      ) : null}
    </section>
  )
}
