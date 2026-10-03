import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { useBeforeUnload } from 'react-router-dom'
import {
  saveAppraisal,
  type AppraisalSubmission,
  type RatingScaleEntry,
} from '../api/performance'
import { formatDojDdMmYyyy } from '../utils/dojFormat'
import { confirmAction } from '../utils/confirmAction'
import {
  draftRowsFromSubmission,
  perfFormIsDirty,
} from '../utils/perfFormDraft'
import {
  collectCycleFormPairIssues,
  criterionPairStatusForMode,
  isCycleFormSubmitReady,
  overallPairStatusForMode,
  pairStatusShortLabel,
  pairStatusWarning,
  type CycleFormPairIssue,
  type CriterionPairStatus,
  validateCycleFormSubmit,
} from '../utils/cycleFormValidation'
import { CycleFormSubmitChecklist } from './CycleFormSubmitChecklist'

type DraftAnswer = {
  criterionIndex: number
  employeeRating: string
  employeeComments: string
  managerRating: string
  managerComments: string
  managementRating: string
  managementComments: string
}

type StepId = number | 'overall'

type Props = {
  submission: AppraisalSubmission
  ratingScale: RatingScaleEntry[]
  mode: 'employee' | 'manager' | 'management' | 'view'
  /** Fits inside admin split panel - no page scroll, compact columns */
  embed?: 'admin'
  /** Defaults to performance appraisal save */
  saveSubmission?: typeof saveAppraisal
  /** Singular label for messages, e.g. "goal sheet" */
  formLabel?: string
  onSaved: (submission: AppraisalSubmission) => void
  onError: (message: string) => void
  onDirtyChange?: (dirty: boolean) => void
}

const DEFAULT_SCALE: RatingScaleEntry[] = [
  { value: 1, label: 'Needs Development', note: '' },
  { value: 2, label: 'Below Expectations', note: '' },
  { value: 3, label: 'Meets Expectations', note: '' },
  { value: 4, label: 'Above Par', note: '' },
  { value: 5, label: 'Significantly Above Par', note: '' },
]

function errorMessage(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    return (e.response?.data as { message?: string })?.message ?? e.message ?? fallback
  }
  return e instanceof Error ? e.message : fallback
}

function draftFromSubmission(submission: AppraisalSubmission): DraftAnswer[] {
  return draftRowsFromSubmission(submission)
}

function scaleRows(ratingScale: RatingScaleEntry[]): RatingScaleEntry[] {
  return ratingScale.length > 0 ? ratingScale : DEFAULT_SCALE
}

function criterionComplete(
  row: DraftAnswer,
  mode: Props['mode'],
  showManager: boolean,
  showManagement: boolean,
): boolean {
  if (mode === 'employee') {
    return criterionPairStatusForMode(row, 'employee') === 'complete'
  }
  if (mode === 'manager') {
    return criterionPairStatusForMode(row, 'manager') === 'complete'
  }
  if (mode === 'management') {
    return criterionPairStatusForMode(row, 'management') === 'complete'
  }
  if (mode === 'view') {
    return (
      row.employeeRating !== '' ||
      (showManager && row.managerRating !== '') ||
      (showManagement && row.managementRating !== '')
    )
  }
  return row.employeeRating !== ''
}

function RatingPicker({
  value,
  onChange,
  readOnly,
  ratingScale,
  labelledBy,
  compact,
  highlightMissing,
}: {
  value: string
  onChange: (v: string) => void
  readOnly: boolean
  ratingScale: RatingScaleEntry[]
  labelledBy?: string
  compact?: boolean
  highlightMissing?: boolean
}) {
  const rows = scaleRows(ratingScale)
  const selected = rows.find((r) => String(r.value) === value)

  if (readOnly) {
    if (!value || !selected) {
      return (
        <p className="text-xs text-[var(--color-warm-text)]" aria-labelledby={labelledBy}>
          Not rated
        </p>
      )
    }
    return (
        <p className="text-xs leading-snug text-[var(--color-ink)]" aria-labelledby={labelledBy}>
        <span className="font-semibold tabular-nums text-[var(--color-brand)]">{value}</span>
        <span className="text-[var(--color-warm-text)]"> · {selected.label}</span>
        {selected.note ? (
          <span className="text-[var(--color-warm-text)]"> ({selected.note})</span>
        ) : null}
      </p>
    )
  }

  return (
    <div
      className={`perf-rating-inline ${compact ? 'perf-rating-inline-compact' : ''} ${
        highlightMissing ? 'perf-field-attention-rating' : ''
      }`}
      aria-labelledby={labelledBy}
    >
      <div className="perf-rating-inline-row" role="radiogroup" aria-label="Rating from 1 to 5">
        {rows.map((r) => {
          const str = String(r.value)
          const active = value === str
          return (
            <button
              key={r.value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${r.value}, ${r.label}`}
              className={`perf-rating-inline-btn ${active ? 'perf-rating-inline-btn-active' : ''}`}
              onClick={() => onChange(active ? '' : str)}
            >
              {r.value}
            </button>
          )
        })}
      </div>
      {selected ? (
        <p className="perf-rating-inline-caption">
          <span className="font-medium text-[var(--color-ink)]">{selected.label}</span>
          {selected.note ? (
            <span className="text-[var(--color-warm-text)]"> · {selected.note}</span>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}

function PairFieldWarning({ status }: { status: CriterionPairStatus }) {
  const message = pairStatusWarning(status)
  const short = pairStatusShortLabel(status)
  if (!message || !short) return null
  return (
    <div className="perf-submit-inline-hint" role="status">
      <span className="perf-submit-inline-hint-icon" aria-hidden>
        !
      </span>
      <div>
        <p className="font-medium">{short}</p>
        <p className="mt-0.5 opacity-90">{message}</p>
      </div>
    </div>
  )
}

function CommentField({
  label,
  value,
  onChange,
  readOnly,
  compact,
  highlightMissing,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  readOnly: boolean
  compact?: boolean
  highlightMissing?: boolean
}) {
  return (
    <label className={`block ${highlightMissing ? 'perf-field-attention-comments' : ''}`}>
      <span className="field-label">{label}</span>
      {readOnly ? (
        <p
          className={`mt-1.5 whitespace-pre-wrap rounded-lg border border-[color-mix(in_srgb,var(--color-warm-muted)_70%,transparent)] bg-[var(--color-surface)] px-2.5 py-2 text-[var(--color-ink)] ${
            compact
              ? 'line-clamp-4 max-h-[5.5rem] overflow-hidden text-xs leading-snug'
              : 'min-h-[3rem] text-sm leading-relaxed'
          }`}
        >
          {value.trim() ? value : '-'}
        </p>
      ) : (
        <textarea
          className="field mt-2 min-h-[5rem] w-full resize-y text-sm leading-relaxed"
          value={value}
          placeholder="Add comments (required to submit when you add a rating)…"
          rows={3}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  )
}

export function PerformanceAppraisalForm({
  submission,
  ratingScale,
  mode,
  embed,
  saveSubmission = saveAppraisal,
  formLabel = 'appraisal',
  onSaved,
  onError,
  onDirtyChange,
}: Props) {
  const adminEmbed = embed === 'admin'
  const [draft, setDraft] = useState<DraftAnswer[]>(() => draftFromSubmission(submission))
  const [overallEmployee, setOverallEmployee] = useState(
    submission.overallEmployeeRating != null ? String(submission.overallEmployeeRating) : '',
  )
  const [overallManager, setOverallManager] = useState(
    submission.overallManagerRating != null ? String(submission.overallManagerRating) : '',
  )
  const [overallManagement, setOverallManagement] = useState(
    submission.overallManagementRating != null ? String(submission.overallManagementRating) : '',
  )
  const [overallEmployeeComments, setOverallEmployeeComments] = useState(
    submission.overallEmployeeComments ?? '',
  )
  const [overallManagerComments, setOverallManagerComments] = useState(
    submission.overallManagerComments ?? '',
  )
  const [overallManagementComments, setOverallManagementComments] = useState(
    submission.overallManagementComments ?? '',
  )
  const [step, setStep] = useState<StepId>(1)
  const [saving, setSaving] = useState(false)

  const template = submission.template
  const criteria = template?.criteria ?? []
  const stepIds = useMemo(
    (): StepId[] => [...criteria.map((c) => c.index), 'overall' as const],
    [criteria],
  )

  const submissionSyncKey = useMemo(
    () =>
      JSON.stringify({
        id: submission.id,
        cycleYear: submission.cycleYear,
        employeeId: submission.employeeId,
        employeeUpdatedAt: submission.employeeUpdatedAt,
        managerUpdatedAt: submission.managerUpdatedAt,
        managementUpdatedAt: submission.managementUpdatedAt,
        managerSubmittedAt: submission.managerSubmittedAt,
        employeeSubmittedAt: submission.employeeSubmittedAt,
        managementSubmittedAt: submission.managementSubmittedAt,
        overallEmployeeRating: submission.overallEmployeeRating,
        overallManagerRating: submission.overallManagerRating,
        overallManagementRating: submission.overallManagementRating,
        overallEmployeeComments: submission.overallEmployeeComments,
        overallManagerComments: submission.overallManagerComments,
        overallManagementComments: submission.overallManagementComments,
        answers: submission.answers,
      }),
    [
      submission.id,
      submission.cycleYear,
      submission.employeeId,
      submission.employeeUpdatedAt,
      submission.managerUpdatedAt,
      submission.managementUpdatedAt,
      submission.managerSubmittedAt,
      submission.employeeSubmittedAt,
      submission.managementSubmittedAt,
      submission.overallEmployeeRating,
      submission.overallManagerRating,
      submission.overallManagementRating,
      submission.overallEmployeeComments,
      submission.overallManagerComments,
      submission.overallManagementComments,
      submission.answers,
    ],
  )

  useEffect(() => {
    setDraft(draftFromSubmission(submission))
    setOverallEmployee(
      submission.overallEmployeeRating != null ? String(submission.overallEmployeeRating) : '',
    )
    setOverallManager(
      submission.overallManagerRating != null ? String(submission.overallManagerRating) : '',
    )
    setOverallManagement(
      submission.overallManagementRating != null ? String(submission.overallManagementRating) : '',
    )
    setOverallEmployeeComments(submission.overallEmployeeComments ?? '')
    setOverallManagerComments(submission.overallManagerComments ?? '')
    setOverallManagementComments(submission.overallManagementComments ?? '')
  }, [submissionSyncKey])

  useEffect(() => {
    setStep(criteria[0]?.index ?? 'overall')
  }, [submission.employeeId, submission.cycleYear, criteria.length])

  const showManager = submission.showManagerReview
  const showManagement = submission.showManagementReview

  /** UI interactivity follows the page mode (not only API flags). */
  const employeeReadOnly = mode !== 'employee' || submission.employeeSubmittedAt != null
  const readOnlyManager = mode !== 'manager' || submission.managerSubmittedAt != null
  const readOnlyManagement =
    mode !== 'management' ||
    submission.managerSubmittedAt == null ||
    submission.managementSubmittedAt != null

  const showEmployeeColumn =
    mode === 'view' || mode === 'employee' || mode === 'manager' || mode === 'management'
  const showManagerColumn = showManager && (mode === 'view' || mode === 'manager')
  const showManagementColumn = showManagement && (mode === 'view' || mode === 'management')

  const canSaveEmployee = mode === 'employee' && submission.employeeSubmittedAt == null
  const canSubmitEmployee = canSaveEmployee
  const canSaveManagerDraft =
    mode === 'manager' &&
    !submission.managerSubmittedAt &&
    submission.employeeSubmittedAt != null &&
    submission.canEditManagerFields
  const canSubmitManager = canSaveManagerDraft
  const canSaveManagement =
    mode === 'management' &&
    submission.managerSubmittedAt != null &&
    submission.managementSubmittedAt == null
  const canSubmitManagement = canSaveManagement

  const canTrackDirty = canSaveEmployee || canSaveManagerDraft || canSaveManagement
  const showToolbarActions =
    canSaveEmployee ||
    canSubmitEmployee ||
    canSaveManagerDraft ||
    canSubmitManager ||
    canSaveManagement ||
    canSubmitManagement

  const isDirty = useMemo(
    () =>
      perfFormIsDirty(
        submission,
        mode,
        draft,
        overallEmployee,
        overallManager,
        overallManagement,
        overallEmployeeComments,
        overallManagerComments,
        overallManagementComments,
      ),
    [
      submission,
      mode,
      draft,
      overallEmployee,
      overallManager,
      overallManagement,
      overallEmployeeComments,
      overallManagerComments,
      overallManagementComments,
    ],
  )

  useEffect(() => {
    onDirtyChange?.(isDirty && canTrackDirty)
  }, [isDirty, canTrackDirty, onDirtyChange])

  useBeforeUnload(
    (event) => {
      if (!isDirty || !canTrackDirty) return
      event.preventDefault()
      event.returnValue = ''
    },
    { capture: true },
  )

  const eligibilityMessage = useMemo(() => {
    if (mode !== 'employee') return null
    if (submission.canEditEmployeeFields) return null
    if (submission.employeeEditNote) return submission.employeeEditNote
    if (!submission.dateOfJoining) {
      return `Date of joining is not set on your profile. Ask HR to add it on your employee record so your login can be linked.`
    }
    return null
  }, [mode, submission.canEditEmployeeFields, submission.dateOfJoining, submission.employeeEditNote])

  const editBlockedMessage = useMemo(() => {
    if (mode === 'view') {
      return 'This form is read-only. Open My goal sheet / My appraisal to edit your own entry, or use Team / Management review for manager and leadership ratings.'
    }
    if (mode === 'employee' && submission.employeeSubmittedAt) {
      return 'Your self-assessment is submitted and locked.'
    }
    if (mode === 'manager') {
      if (submission.managerSubmittedAt) {
        return 'Manager review is already submitted and locked.'
      }
      if (!submission.employeeSubmittedAt) {
        return 'Self-assessment is still in progress. You can review and rate after the employee submits.'
      }
      if (!submission.canEditManagerFields) {
        return 'You cannot edit manager review for this employee.'
      }
    }
    if (mode === 'management') {
      if (submission.managementSubmittedAt) {
        return 'Management review is already submitted and locked.'
      }
      if (!submission.managerSubmittedAt) {
        return 'Management ratings unlock after the assigned manager submits their review.'
      }
    }
    return null
  }, [mode, submission.managerSubmittedAt, submission.employeeSubmittedAt, submission.managementSubmittedAt, submission.canEditManagerFields])

  const employeeContentWithheld =
    mode !== 'employee' && submission.employeeSubmittedAt == null
  const managerContentWithheld =
    showManagerColumn && mode !== 'manager' && submission.managerSubmittedAt == null

  const completedCount = useMemo(() => {
    let n = 0
    for (const c of criteria) {
      const row = draft.find((d) => d.criterionIndex === c.index)
      if (!row) continue
      if (criterionComplete(row, mode, showManager, showManagement)) n += 1
    }
    return n
  }, [criteria, draft, mode, showManager, showManagement])

  const stepIndex = stepIds.indexOf(step)
  const progressPct =
    stepIds.length > 0 ? Math.round(((stepIndex + 1) / stepIds.length) * 100) : 0

  const submitReady = useMemo(() => {
    if (!template || mode === 'view') return false
    if (mode !== 'employee' && mode !== 'manager' && mode !== 'management') return false
    return isCycleFormSubmitReady(
      mode,
      template,
      draft,
      overallEmployee,
      overallManager,
      overallManagement,
      overallEmployeeComments,
      overallManagerComments,
      overallManagementComments,
    )
  }, [
    template,
    mode,
    draft,
    overallEmployee,
    overallManager,
    overallManagement,
    overallEmployeeComments,
    overallManagerComments,
    overallManagementComments,
  ])

  const submitDisabledHint =
    'Complete every item with a rating and comments, plus the overall rating and overall comments, to enable Submit.'

  const pairIssues = useMemo((): CycleFormPairIssue[] => {
    if (!template || mode === 'view') return []
    return collectCycleFormPairIssues(
      mode,
      template,
      draft,
      overallEmployee,
      overallManager,
      overallManagement,
      overallEmployeeComments,
      overallManagerComments,
      overallManagementComments,
    )
  }, [
    template,
    mode,
    draft,
    overallEmployee,
    overallManager,
    overallManagement,
    overallEmployeeComments,
    overallManagerComments,
    overallManagementComments,
  ])

  const submitStepProgress = useMemo(() => {
    if (!template || mode === 'view') return { ready: 0, total: 0 }
    let ready = 0
    for (const c of criteria) {
      const row = draft.find((d) => d.criterionIndex === c.index)
      if (criterionPairStatusForMode(row, mode) === 'complete') ready += 1
    }
    const overallStatus = overallPairStatusForMode(
      mode,
      overallEmployee,
      overallManager,
      overallManagement,
      overallEmployeeComments,
      overallManagerComments,
      overallManagementComments,
    )
    if (overallStatus === 'complete') ready += 1
    return { ready, total: criteria.length + 1 }
  }, [
    template,
    mode,
    criteria,
    draft,
    overallEmployee,
    overallManager,
    overallManagement,
    overallEmployeeComments,
    overallManagerComments,
    overallManagementComments,
  ])

  const activeCriterion =
    step !== 'overall' ? criteria.find((c) => c.index === step) : null
  const activeRow =
    activeCriterion != null
      ? draft.find((d) => d.criterionIndex === activeCriterion.index)
      : null

  const activePairStatus = useMemo((): CriterionPairStatus | null => {
    if (mode === 'view' || step === 'overall' || !activeRow) return null
    if (mode !== 'employee' && mode !== 'manager' && mode !== 'management') return null
    return criterionPairStatusForMode(activeRow, mode)
  }, [mode, step, activeRow])

  const overallPairStatus = useMemo((): CriterionPairStatus | null => {
    if (mode !== 'employee' && mode !== 'manager' && mode !== 'management') return null
    return overallPairStatusForMode(
      mode,
      overallEmployee,
      overallManager,
      overallManagement,
      overallEmployeeComments,
      overallManagerComments,
      overallManagementComments,
    )
  }, [
    mode,
    overallEmployee,
    overallManager,
    overallManagement,
    overallEmployeeComments,
    overallManagerComments,
    overallManagementComments,
  ])

  const updateDraft = (index: number, patch: Partial<DraftAnswer>) => {
    setDraft((prev) =>
      prev.map((row) => (row.criterionIndex === index ? { ...row, ...patch } : row)),
    )
  }

  const goPrev = () => {
    if (stepIndex > 0) setStep(stepIds[stepIndex - 1])
  }

  const goNext = () => {
    if (stepIndex < stepIds.length - 1) setStep(stepIds[stepIndex + 1])
  }

  const persist = async (opts: { submit?: boolean }) => {
    const employeeLabel = submission.employeeName || submission.employeeCode || 'this employee'

    if (opts.submit && template && mode !== 'view') {
      const check = validateCycleFormSubmit(
        mode,
        template,
        draft,
        overallEmployee,
        overallManager,
        overallManagement,
        overallEmployeeComments,
        overallManagerComments,
        overallManagementComments,
      )
      if (!check.ok) {
        onError(check.message)
        if (check.criterionIndex != null) setStep(check.criterionIndex)
        else if (check.message.includes('Overall')) setStep('overall')
        return
      }
    }

    if (opts.submit) {
      const confirmText =
        mode === 'employee'
          ? `Submit your ${formLabel}? Every item must have a rating and comments. You can still save progress first with partial entries.`
          : mode === 'management'
            ? `Submit management ${formLabel} for ${employeeLabel}?`
            : `Submit manager ${formLabel} for ${employeeLabel} to management?`
      if (!(await confirmAction(confirmText))) return
    }
    setSaving(true)
    try {
      if (mode === 'employee' && (canSaveEmployee || opts.submit)) {
        onSaved(
          await saveSubmission(submission.employeeId, submission.cycleYear, {
            role: 'employee',
            submit: opts.submit === true,
            overallRating: overallEmployee === '' ? null : Number.parseInt(overallEmployee, 10),
            overallComments: overallEmployeeComments.trim() || null,
            answers: draft.map((row) => ({
              criterionIndex: row.criterionIndex,
              rating: row.employeeRating === '' ? null : Number.parseInt(row.employeeRating, 10),
              comments: row.employeeComments.trim() || null,
            })),
          }),
        )
        return
      }

      if (mode === 'manager' && (canSaveManagerDraft || opts.submit)) {
        onSaved(
          await saveSubmission(submission.employeeId, submission.cycleYear, {
            role: 'manager',
            submit: opts.submit === true,
            overallRating: overallManager === '' ? null : Number.parseInt(overallManager, 10),
            overallComments: overallManagerComments.trim() || null,
            answers: draft.map((row) => ({
              criterionIndex: row.criterionIndex,
              rating: row.managerRating === '' ? null : Number.parseInt(row.managerRating, 10),
              comments: row.managerComments.trim() || null,
            })),
          }),
        )
        return
      }

      if (mode === 'management' && (canSaveManagement || opts.submit)) {
        onSaved(
          await saveSubmission(submission.employeeId, submission.cycleYear, {
            role: 'management',
            submit: opts.submit === true,
            overallRating:
              overallManagement === '' ? null : Number.parseInt(overallManagement, 10),
            overallComments: overallManagementComments.trim() || null,
            answers: draft.map((row) => ({
              criterionIndex: row.criterionIndex,
              rating:
                row.managementRating === '' ? null : Number.parseInt(row.managementRating, 10),
              comments: row.managementComments.trim() || null,
            })),
          }),
        )
      }
    } catch (e) {
      onError(errorMessage(e, `Could not save ${formLabel}`))
    } finally {
      setSaving(false)
    }
  }

  if (!template || criteria.length === 0) {
    return (
      <div className="card border p-8 text-sm leading-relaxed text-[var(--color-warm-text)]">
        {submission.teamName === 'Performance Marketing'
          ? 'Performance Marketing goal sheet template is not published yet. Check back later.'
          : submission.teamName
            ? `No ${formLabel} template is configured for ${submission.teamName} yet.`
            : `You are not assigned to a team yet. Ask HR to assign your team before completing your ${formLabel}.`}
      </div>
    )
  }

  const managerLocked = submission.managerSubmittedAt != null
  const employeeLocked = submission.employeeSubmittedAt != null

  const titleCol = template.titleColumn
  const employeePanelTitle = mode === 'employee' ? 'Your assessment' : 'Employee assessment'
  const overallNavAttention =
    mode !== 'view' &&
    (overallPairStatus === 'needsRating' || overallPairStatus === 'needsComments')

  const formActionButtons = showToolbarActions ? (
    <>
      {canSaveEmployee ? (
        <button
          type="button"
          className="btn-primary"
          disabled={saving}
          onClick={() => void persist({})}
        >
          {saving ? 'Saving…' : 'Save progress'}
        </button>
      ) : null}
      {canSubmitEmployee ? (
        <button
          type="button"
          className="btn-secondary"
          disabled={saving || !submitReady}
          title={!submitReady ? submitDisabledHint : undefined}
          onClick={() => void persist({ submit: true })}
        >
          {saving ? 'Submitting…' : 'Submit'}
        </button>
      ) : null}
      {canSaveManagerDraft ? (
        <button
          type="button"
          className="btn-primary"
          disabled={saving}
          onClick={() => void persist({})}
        >
          {saving ? 'Saving…' : 'Save progress'}
        </button>
      ) : null}
      {canSubmitManager ? (
        <button
          type="button"
          className="btn-secondary"
          disabled={saving || !submitReady}
          title={!submitReady ? submitDisabledHint : undefined}
          onClick={() => void persist({ submit: true })}
        >
          {saving ? 'Submitting…' : 'Submit to management'}
        </button>
      ) : null}
      {canSaveManagement ? (
        <button
          type="button"
          className="btn-primary"
          disabled={saving}
          onClick={() => void persist({})}
        >
          {saving ? 'Saving…' : 'Save progress'}
        </button>
      ) : null}
      {canSubmitManagement ? (
        <button
          type="button"
          className="btn-secondary"
          disabled={saving || !submitReady}
          title={!submitReady ? submitDisabledHint : undefined}
          onClick={() => void persist({ submit: true })}
        >
          {saving ? 'Submitting…' : 'Submit'}
        </button>
      ) : null}
    </>
  ) : null

  return (
    <div className={`perf-appraisal ${adminEmbed ? 'perf-appraisal-admin-panel' : ''}`}>
      {!adminEmbed ? (
        <header className="perf-studio-header">
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-[var(--color-ink)]">{submission.employeeName}</p>
            <p className="mt-0.5 text-sm text-[var(--color-warm-text)]">
              {submission.employeeCode} · {submission.teamName}
              {submission.dateOfJoining
                ? ` · DOJ ${formatDojDdMmYyyy(submission.dateOfJoining)}`
                : ''}
            </p>
          </div>
          <div className="text-right text-sm text-[var(--color-warm-text)]">
            <p className="font-medium tabular-nums text-[var(--color-ink)]">
              {completedCount} / {criteria.length} items
            </p>
            {employeeLocked && mode === 'employee' ? (
              <p className="mt-0.5 text-xs text-[var(--color-brand)]">Self-assessment submitted</p>
            ) : null}
            {managerLocked && showManager ? (
              <p className="mt-0.5 text-xs text-[var(--color-brand)]">Manager review locked</p>
            ) : null}
          </div>
        </header>
      ) : null}

      {!adminEmbed && eligibilityMessage ? (
        <p className="text-sm leading-relaxed text-[var(--color-warm-text)]">{eligibilityMessage}</p>
      ) : null}

      {!adminEmbed && editBlockedMessage ? (
        <p className="text-sm leading-relaxed text-[var(--color-warm-text)]">{editBlockedMessage}</p>
      ) : null}

      {!adminEmbed && !submitReady && canTrackDirty && template ? (
        <CycleFormSubmitChecklist
          issues={pairIssues}
          readyCount={submitStepProgress.ready}
          totalSteps={submitStepProgress.total}
          onJumpTo={(next) => setStep(next)}
        />
      ) : null}

      {!adminEmbed ? (
        <>
          <div
            className="perf-progress"
            role="progressbar"
            aria-valuenow={progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="perf-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <p className="text-xs text-[var(--color-warm-text)]">
            Step {stepIndex + 1} of {stepIds.length}
            {step === 'overall' ? ' · Overall rating' : ''}
          </p>
        </>
      ) : null}

      <div
        className={`card perf-studio overflow-hidden ${adminEmbed ? 'min-h-0 flex-1' : ''}`}
      >
        <div className="border-b border-[color-mix(in_srgb,var(--color-warm-muted)_75%,transparent)] p-3 lg:hidden">
          <label className="block">
            <span className="field-label">Jump to</span>
            <select
              className="field field-compact mt-1 w-full"
              value={String(step)}
              onChange={(e) => {
                const v = e.target.value
                setStep(v === 'overall' ? 'overall' : Number.parseInt(v, 10))
              }}
            >
              {criteria.map((c) => (
                <option key={c.index} value={c.index}>
                  {c.index}. {c.title}
                </option>
              ))}
              <option value="overall">Overall rating</option>
            </select>
          </label>
        </div>

        <div className="perf-studio-grid">
          <nav className="perf-studio-nav hidden lg:block" aria-label="Appraisal items">
            <p className="perf-studio-nav-kicker">{titleCol}</p>
            <ul className="mt-2 space-y-1">
              {criteria.map((c) => {
                const row = draft.find((d) => d.criterionIndex === c.index)
                const done =
                  row != null &&
                  criterionComplete(row, mode, showManager, showManagement)
                const partial =
                  row != null &&
                  mode !== 'view' &&
                  (mode === 'employee' || mode === 'manager' || mode === 'management') &&
                  (() => {
                    const st = criterionPairStatusForMode(row, mode)
                    return st === 'needsRating' || st === 'needsComments'
                  })()
                const active = step === c.index
                return (
                  <li key={c.index}>
                    <button
                      type="button"
                      className={`perf-studio-nav-btn ${active ? 'perf-studio-nav-btn-active' : ''} ${
                        partial && !active ? 'perf-studio-nav-btn-attention' : ''
                      }`}
                      onClick={() => setStep(c.index)}
                    >
                      <span className="perf-studio-nav-num">{c.index}</span>
                      <span className="min-w-0 flex-1 truncate text-left text-sm">{c.title}</span>
                      {done ? (
                        <span className="perf-studio-nav-done" aria-label="Complete">
                          ✓
                        </span>
                      ) : partial ? (
                        <span
                          className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-[0.65rem] font-bold text-amber-800"
                          title="Rating and comments both required"
                          aria-label="Incomplete pair"
                        >
                          ·
                        </span>
                      ) : null}
                    </button>
                  </li>
                )
              })}
              <li>
                <button
                  type="button"
                  className={`perf-studio-nav-btn ${step === 'overall' ? 'perf-studio-nav-btn-active' : ''} ${
                    overallNavAttention && step !== 'overall' ? 'perf-studio-nav-btn-attention' : ''
                  }`}
                  onClick={() => setStep('overall')}
                >
                  <span className="perf-studio-nav-num">★</span>
                  <span className="text-sm font-medium">Overall rating</span>
                  {overallPairStatus === 'complete' ? (
                    <span className="perf-studio-nav-done" aria-label="Complete">
                      ✓
                    </span>
                  ) : overallNavAttention ? (
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-[0.65rem] font-bold text-amber-800"
                      aria-hidden
                    >
                      ·
                    </span>
                  ) : null}
                </button>
              </li>
            </ul>
          </nav>

          <div className={`perf-studio-stage ${adminEmbed ? 'perf-studio-stage-embed' : ''}`}>
            {step !== 'overall' && activeCriterion && activeRow ? (
              <>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-brand)]">
                  {titleCol} {activeCriterion.index}
                  {adminEmbed ? (
                    <span className="font-normal normal-case text-[var(--color-warm-text)]">
                      {' '}
                      · Step {stepIndex + 1}/{stepIds.length}
                    </span>
                  ) : null}
                </p>
                <h2
                  className={`font-semibold leading-snug text-[var(--color-ink)] ${
                    adminEmbed ? 'mt-1 text-base' : 'mt-2 text-xl'
                  }`}
                >
                  {activeCriterion.title}
                </h2>
                <p
                  className={`text-[var(--color-warm-text)] ${
                    adminEmbed
                      ? 'mt-1 line-clamp-2 text-xs leading-snug'
                      : 'mt-3 text-sm leading-relaxed'
                  }`}
                >
                  {activeCriterion.description}
                </p>

                <div
                  className={
                    adminEmbed
                      ? 'mt-3 grid min-h-0 flex-1 gap-2 xl:grid-cols-3'
                      : 'mt-8 space-y-8'
                  }
                >
                  {showEmployeeColumn ? (
                  <section className="perf-studio-panel">
                    <h3 className="perf-studio-panel-title">{employeePanelTitle}</h3>
                    {employeeContentWithheld ? (
                      <p className="mt-3 text-sm leading-relaxed text-[var(--color-warm-text)]">
                        Self-assessment is in progress. Their ratings and comments appear here only
                        after they submit.
                      </p>
                    ) : (
                    <div className={`${adminEmbed ? 'mt-2 space-y-2' : 'mt-4 space-y-5'}`}>
                      <div>
                        <span className="field-label" id="emp-rating-label">
                          Rating
                        </span>
                        <div className="mt-1">
                          <RatingPicker
                            labelledBy="emp-rating-label"
                            value={activeRow.employeeRating}
                            readOnly={employeeReadOnly}
                            ratingScale={ratingScale}
                            compact={adminEmbed}
                            highlightMissing={
                              mode === 'employee' &&
                              !employeeReadOnly &&
                              activePairStatus === 'needsRating'
                            }
                            onChange={(v) => updateDraft(activeCriterion.index, { employeeRating: v })}
                          />
                        </div>
                      </div>
                      <CommentField
                        compact={adminEmbed}
                        label="Comments"
                        value={activeRow.employeeComments}
                        readOnly={employeeReadOnly}
                        highlightMissing={
                          mode === 'employee' &&
                          !employeeReadOnly &&
                          activePairStatus === 'needsComments'
                        }
                        onChange={(v) =>
                          updateDraft(activeCriterion.index, { employeeComments: v })
                        }
                      />
                      {mode === 'employee' &&
                      !employeeReadOnly &&
                      activePairStatus &&
                      activePairStatus !== 'empty' &&
                      activePairStatus !== 'complete' ? (
                        <PairFieldWarning status={activePairStatus} />
                      ) : null}
                    </div>
                    )}
                  </section>
                  ) : null}

                  {showManagerColumn ? (
                    <section className="perf-studio-panel">
                      <h3 className="perf-studio-panel-title">Manager review</h3>
                      {managerContentWithheld ? (
                        <p className="mt-3 text-sm leading-relaxed text-[var(--color-warm-text)]">
                          Manager review is in progress. Their ratings and comments appear here only
                          after they submit to management.
                        </p>
                      ) : (
                      <div className={`${adminEmbed ? 'mt-2 space-y-2' : 'mt-4 space-y-5'}`}>
                        <div>
                          <span className="field-label" id="mgr-rating-label">
                            Rating
                          </span>
                          <div className="mt-1">
                            <RatingPicker
                              labelledBy="mgr-rating-label"
                              value={activeRow.managerRating}
                              readOnly={readOnlyManager}
                              ratingScale={ratingScale}
                              compact={adminEmbed}
                              highlightMissing={
                                mode === 'manager' &&
                                !readOnlyManager &&
                                activePairStatus === 'needsRating'
                              }
                              onChange={(v) =>
                                updateDraft(activeCriterion.index, { managerRating: v })
                              }
                            />
                          </div>
                        </div>
                        <CommentField
                          compact={adminEmbed}
                          label="Comments"
                          value={activeRow.managerComments}
                          readOnly={readOnlyManager}
                          highlightMissing={
                            mode === 'manager' &&
                            !readOnlyManager &&
                            activePairStatus === 'needsComments'
                          }
                          onChange={(v) =>
                            updateDraft(activeCriterion.index, { managerComments: v })
                          }
                        />
                        {mode === 'manager' &&
                        !readOnlyManager &&
                        activePairStatus &&
                        activePairStatus !== 'empty' &&
                        activePairStatus !== 'complete' ? (
                          <PairFieldWarning status={activePairStatus} />
                        ) : null}
                      </div>
                      )}
                    </section>
                  ) : null}

                  {showManagementColumn ? (
                    <section className="perf-studio-panel">
                      <h3 className="perf-studio-panel-title">Management</h3>
                      <div className={`${adminEmbed ? 'mt-2 space-y-2' : 'mt-4 space-y-5'}`}>
                        <div>
                          <span className="field-label" id="mgmt-rating-label">
                            Rating
                          </span>
                          <div className="mt-1">
                            <RatingPicker
                              labelledBy="mgmt-rating-label"
                              value={activeRow.managementRating}
                              readOnly={readOnlyManagement}
                              ratingScale={ratingScale}
                              compact={adminEmbed}
                              highlightMissing={
                                mode === 'management' &&
                                !readOnlyManagement &&
                                activePairStatus === 'needsRating'
                              }
                              onChange={(v) =>
                                updateDraft(activeCriterion.index, { managementRating: v })
                              }
                            />
                          </div>
                        </div>
                        <CommentField
                          compact={adminEmbed}
                          label="Comments"
                          value={activeRow.managementComments}
                          readOnly={readOnlyManagement}
                          highlightMissing={
                            mode === 'management' &&
                            !readOnlyManagement &&
                            activePairStatus === 'needsComments'
                          }
                          onChange={(v) =>
                            updateDraft(activeCriterion.index, { managementComments: v })
                          }
                        />
                        {mode === 'management' &&
                        !readOnlyManagement &&
                        activePairStatus &&
                        activePairStatus !== 'empty' &&
                        activePairStatus !== 'complete' ? (
                          <PairFieldWarning status={activePairStatus} />
                        ) : null}
                      </div>
                    </section>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-brand)]">
                  Overall
                  {adminEmbed ? (
                    <span className="font-normal normal-case text-[var(--color-warm-text)]">
                      {' '}
                      · Step {stepIndex + 1}/{stepIds.length}
                    </span>
                  ) : null}
                </p>
                <h2
                  className={`font-semibold leading-snug text-[var(--color-ink)] ${
                    adminEmbed ? 'mt-1 text-base' : 'mt-2 text-xl'
                  }`}
                >
                  Overall rating
                </h2>
                <p
                  className={`text-[var(--color-warm-text)] ${
                    adminEmbed
                      ? 'mt-1 line-clamp-2 text-xs leading-snug'
                      : 'mt-3 text-sm leading-relaxed'
                  }`}
                >
                  Summary score for the full cycle, separate from individual{' '}
                  {titleCol.toLowerCase()} ratings.
                </p>

                <div
                  className={
                    adminEmbed
                      ? 'mt-3 grid min-h-0 flex-1 gap-2 xl:grid-cols-3'
                      : 'mt-8 space-y-8'
                  }
                >
                  {showEmployeeColumn ? (
                    <section className="perf-studio-panel">
                      <h3 className="perf-studio-panel-title">{employeePanelTitle}</h3>
                      {employeeContentWithheld ? (
                        <p className="mt-3 text-sm leading-relaxed text-[var(--color-warm-text)]">
                          Self-assessment is in progress. Their ratings and comments appear here only
                          after they submit.
                        </p>
                      ) : (
                      <div className={`${adminEmbed ? 'mt-2 space-y-2' : 'mt-4 space-y-5'}`}>
                        <div>
                          <span className="field-label" id="emp-overall-rating-label">
                            Rating
                          </span>
                          <div className="mt-1">
                            <RatingPicker
                              labelledBy="emp-overall-rating-label"
                              value={overallEmployee}
                              readOnly={employeeReadOnly}
                              ratingScale={ratingScale}
                              compact={adminEmbed}
                              highlightMissing={
                                mode === 'employee' &&
                                !employeeReadOnly &&
                                overallPairStatus === 'needsRating'
                              }
                              onChange={setOverallEmployee}
                            />
                          </div>
                        </div>
                        <CommentField
                          compact={adminEmbed}
                          label="Comments"
                          value={overallEmployeeComments}
                          readOnly={employeeReadOnly}
                          highlightMissing={
                            mode === 'employee' &&
                            !employeeReadOnly &&
                            overallPairStatus === 'needsComments'
                          }
                          onChange={setOverallEmployeeComments}
                        />
                        {mode === 'employee' &&
                        !employeeReadOnly &&
                        overallPairStatus &&
                        overallPairStatus !== 'empty' &&
                        overallPairStatus !== 'complete' ? (
                          <PairFieldWarning status={overallPairStatus} />
                        ) : null}
                      </div>
                      )}
                    </section>
                  ) : null}
                  {showManagerColumn ? (
                    <section className="perf-studio-panel">
                      <h3 className="perf-studio-panel-title">Manager review</h3>
                      {managerContentWithheld ? (
                        <p className="mt-3 text-sm leading-relaxed text-[var(--color-warm-text)]">
                          Manager review is in progress. Their ratings and comments appear here only
                          after they submit to management.
                        </p>
                      ) : (
                      <div className={`${adminEmbed ? 'mt-2 space-y-2' : 'mt-4 space-y-5'}`}>
                        <div>
                          <span className="field-label" id="mgr-overall-rating-label">
                            Rating
                          </span>
                          <div className="mt-1">
                            <RatingPicker
                              labelledBy="mgr-overall-rating-label"
                              value={overallManager}
                              readOnly={readOnlyManager}
                              ratingScale={ratingScale}
                              compact={adminEmbed}
                              highlightMissing={
                                mode === 'manager' &&
                                !readOnlyManager &&
                                overallPairStatus === 'needsRating'
                              }
                              onChange={setOverallManager}
                            />
                          </div>
                        </div>
                        <CommentField
                          compact={adminEmbed}
                          label="Comments"
                          value={overallManagerComments}
                          readOnly={readOnlyManager}
                          highlightMissing={
                            mode === 'manager' &&
                            !readOnlyManager &&
                            overallPairStatus === 'needsComments'
                          }
                          onChange={setOverallManagerComments}
                        />
                        {mode === 'manager' &&
                        !readOnlyManager &&
                        overallPairStatus &&
                        overallPairStatus !== 'empty' &&
                        overallPairStatus !== 'complete' ? (
                          <PairFieldWarning status={overallPairStatus} />
                        ) : null}
                      </div>
                      )}
                    </section>
                  ) : null}
                  {showManagementColumn ? (
                    <section className="perf-studio-panel">
                      <h3 className="perf-studio-panel-title">Management</h3>
                      <div className={`${adminEmbed ? 'mt-2 space-y-2' : 'mt-4 space-y-5'}`}>
                        <div>
                          <span className="field-label" id="mgmt-overall-rating-label">
                            Rating
                          </span>
                          <div className="mt-1">
                            <RatingPicker
                              labelledBy="mgmt-overall-rating-label"
                              value={overallManagement}
                              readOnly={readOnlyManagement}
                              ratingScale={ratingScale}
                              compact={adminEmbed}
                              highlightMissing={
                                mode === 'management' &&
                                !readOnlyManagement &&
                                overallPairStatus === 'needsRating'
                              }
                              onChange={setOverallManagement}
                            />
                          </div>
                        </div>
                        <CommentField
                          compact={adminEmbed}
                          label="Comments"
                          value={overallManagementComments}
                          readOnly={readOnlyManagement}
                          highlightMissing={
                            mode === 'management' &&
                            !readOnlyManagement &&
                            overallPairStatus === 'needsComments'
                          }
                          onChange={setOverallManagementComments}
                        />
                        {mode === 'management' &&
                        !readOnlyManagement &&
                        overallPairStatus &&
                        overallPairStatus !== 'empty' &&
                        overallPairStatus !== 'complete' ? (
                          <PairFieldWarning status={overallPairStatus} />
                        ) : null}
                      </div>
                    </section>
                  ) : null}
                </div>
              </>
            )}

            <div className={`perf-studio-steps ${adminEmbed ? 'perf-studio-steps-embed' : ''}`}>
              <button
                type="button"
                className="btn-secondary"
                disabled={stepIndex <= 0}
                onClick={goPrev}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={stepIndex >= stepIds.length - 1}
                onClick={goNext}
              >
                Next
              </button>
              {!adminEmbed && showToolbarActions ? (
                <div className="perf-studio-steps-actions">{formActionButtons}</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
