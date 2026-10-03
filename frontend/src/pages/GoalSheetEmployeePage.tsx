import { useEffect, useState } from 'react'
import axios from 'axios'
import { useParams, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { PerformanceAppraisalForm } from '../components/PerformanceAppraisalForm'
import { PerformanceRatingScale } from '../components/PerformanceRatingScale'
import {
  fetchGoalSheetForEmployee,
  fetchGoalSheetMeta,
  saveGoalSheet,
  type GoalSheetSubmission,
} from '../api/goalSheet'
import { toastSuccess } from '../utils/toastBridge'
import type { RatingScaleEntry } from '../api/performance'
import { activeCycleYear, parseCycleYearParam } from '../utils/cycleYear'
import type { GoalSheetReviewMode } from '../utils/goalSheetNavigation'

function errorMessage(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    return (e.response?.data as { message?: string })?.message ?? e.message ?? fallback
  }
  return e instanceof Error ? e.message : fallback
}

function parseMode(raw: string | null): GoalSheetReviewMode {
  if (raw === 'manager' || raw === 'management' || raw === 'view') return raw
  return 'view'
}

const MODE_LABELS: Record<GoalSheetReviewMode, string> = {
  view: 'Read-only review',
  manager: 'Manager review',
  management: 'Management review',
}

const FORM_MODE: Record<GoalSheetReviewMode, 'manager' | 'management' | 'view'> = {
  view: 'view',
  manager: 'manager',
  management: 'management',
}

export function GoalSheetEmployeePage() {
  const { employeeId: rawId } = useParams()
  const [searchParams] = useSearchParams()
  const employeeId = Number.parseInt(String(rawId ?? ''), 10)
  const cycleYear =
    parseCycleYearParam(searchParams.get('year')) ?? activeCycleYear()
  const mode = parseMode(searchParams.get('mode'))

  const [ratingScale, setRatingScale] = useState<RatingScaleEntry[]>([])
  const [submission, setSubmission] = useState<GoalSheetSubmission | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void fetchGoalSheetMeta()
      .then((meta) => setRatingScale(meta.ratingScale))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!Number.isFinite(employeeId) || employeeId <= 0) {
      setError('Invalid employee')
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchGoalSheetForEmployee(employeeId, cycleYear)
      .then((sub) => {
        if (!cancelled) setSubmission(sub)
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e, 'Could not load goal sheet'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [employeeId, cycleYear])

  const backTab = mode === 'manager' ? 'team' : mode === 'management' ? 'management' : 'admin'
  const backHref = `/goal-sheet?tab=${backTab}`

  return (
    <AppShell
      active="goalSheet"
      maxWidth="full"
      wayfinding={{
        title: submission?.employeeName ?? 'Employee goal sheet',
        backTo: backHref,
        backLabel: 'Goal sheet',
      }}
    >
      <main className="app-page workspace-page space-y-5">
        <header className="offer-hero">
          <p className="page-kicker">Goal sheet</p>
          {loading ? (
            <h1 className="offer-hero-title">Loading…</h1>
          ) : submission ? (
            <>
              <h1 className="offer-hero-title">{submission.employeeName}</h1>
              <p className="mt-1 text-sm text-[var(--color-warm-text)]">
                {submission.employeeCode}
                {submission.teamName ? ` · ${submission.teamName}` : ''}
                {' · '}
                {MODE_LABELS[mode]}
              </p>
            </>
          ) : (
            <h1 className="offer-hero-title">Employee goal sheet</h1>
          )}
        </header>

        {error ? <p className="alert-error">{error}</p> : null}

        {!loading && submission ? (
          <>
            <PerformanceRatingScale ratingScale={ratingScale} />
            <PerformanceAppraisalForm
              submission={submission}
              ratingScale={ratingScale}
              mode={FORM_MODE[mode]}
              saveSubmission={saveGoalSheet}
              formLabel="goal sheet"
              onSaved={(sub) => {
                setSubmission(sub)
                toastSuccess(
                  mode === 'manager' && sub.managerSubmittedAt
                    ? 'Manager review submitted to management.'
                    : mode === 'management' && sub.managementSubmittedAt
                      ? 'Management review submitted.'
                      : mode === 'manager'
                        ? 'Progress saved. You can return later to finish this review.'
                        : mode === 'management'
                          ? 'Progress saved. You can return later to finish management review.'
                          : 'Progress saved.',
                )
                setError(null)
              }}
              onError={setError}
            />
          </>
        ) : null}
      </main>
    </AppShell>
  )
}
