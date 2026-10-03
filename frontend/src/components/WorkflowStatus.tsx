import type { ReactNode } from 'react'
import type { WorkflowTone } from '../constants/workflowStatus'

const TONE_CLASS: Record<WorkflowTone, string> = {
  neutral:
    'border-[color-mix(in_srgb,var(--color-warm-muted)_90%,#000)] bg-[color-mix(in_srgb,var(--color-warm-muted)_35%,#fff)] text-[var(--color-warm-text)]',
  loading:
    'border-[color-mix(in_srgb,var(--color-brand)_35%,transparent)] bg-[var(--color-brand-muted)] text-[var(--color-brand)]',
  success: 'border-emerald-300/80 bg-emerald-50 text-emerald-900',
  warning: 'border-amber-300/80 bg-amber-50 text-amber-900',
  error: 'border-red-300/80 bg-red-50 text-red-900',
  info: 'border-sky-300/80 bg-sky-50 text-sky-900',
}

export function WorkflowSpinner({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`h-3.5 w-3.5 animate-spin ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}

export function WorkflowStatusBadge({
  label,
  tone = 'neutral',
  loading = false,
  compact = false,
}: {
  label: string
  tone?: WorkflowTone
  loading?: boolean
  compact?: boolean
}) {
  if (!label) return null
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-semibold uppercase tracking-wide ${compact ? 'px-2 py-0.5 text-[0.625rem]' : 'px-2.5 py-0.5 text-[0.6875rem]'} ${TONE_CLASS[tone]}`}
    >
      {loading ? <WorkflowSpinner /> : null}
      {label}
    </span>
  )
}

export function WorkflowStatusBanner({
  label,
  tone = 'neutral',
  loading = false,
  error,
  children,
}: {
  label: string
  tone?: WorkflowTone
  loading?: boolean
  error?: string | null
  children?: ReactNode
}) {
  if (!label && !error) return null
  return (
    <div
      className={`mx-6 mt-4 rounded-xl border px-4 py-3 sm:mx-8 ${TONE_CLASS[tone]}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-2">
        {loading ? <WorkflowSpinner className="h-4 w-4" /> : null}
        {label ? <span className="text-sm font-semibold">{label}</span> : null}
        {children}
      </div>
      {error ? <p className="mt-2 text-sm">{error}</p> : null}
    </div>
  )
}

export function WorkflowStepList({
  steps,
  activeIndex,
}: {
  steps: string[]
  activeIndex: number
}) {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs">
      {steps.map((step, index) => {
        const done = index < activeIndex
        const active = index === activeIndex
        return (
          <li key={step} className="flex items-center gap-2">
            {index > 0 ? (
              <span className="text-[color-mix(in_srgb,var(--color-warm-text)_45%,transparent)]">→</span>
            ) : null}
            <span
              className={
                done
                  ? 'font-medium text-emerald-800'
                  : active
                    ? 'inline-flex items-center gap-1.5 font-semibold text-[var(--color-brand)]'
                    : 'text-[color-mix(in_srgb,var(--color-warm-text)_70%,transparent)]'
              }
            >
              {active ? <WorkflowSpinner /> : null}
              {step}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
