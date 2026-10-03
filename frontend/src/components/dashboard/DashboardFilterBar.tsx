import { useEffect, useState } from 'react'
import type { DashboardFilterState } from '../../utils/dashboardFilter'
import { DASHBOARD_PRESET_LABELS } from '../../utils/dashboardFilterHelpers'
import type { DashboardRangePreset } from '../../types/dashboard'
import type { DashboardEmployeeOption } from '../../api/dashboard'
import { loadDashboardEmployeeOptions } from '../../api/dashboard'
import { DashboardEmployeeFilter } from './DashboardEmployeeFilter'
import type { UploadCompanyCode } from '../../constants/companies'
import { UPLOAD_COMPANY_CODES } from '../../constants/companies'

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

type Props = {
  filter: DashboardFilterState
  company: UploadCompanyCode
  showCompany: boolean
  onApply: (next: DashboardFilterState, company: UploadCompanyCode) => void
  onShiftMonth?: (delta: number) => void
}

export function DashboardFilterBar({
  filter,
  company,
  showCompany,
  onApply,
  onShiftMonth,
}: Props) {
  const [draft, setDraft] = useState(filter)
  const [draftCompany, setDraftCompany] = useState(company)
  const [employees, setEmployees] = useState<DashboardEmployeeOption[]>([])
  const [employeesLoading, setEmployeesLoading] = useState(true)

  useEffect(() => {
    setDraft(filter)
  }, [filter])

  useEffect(() => {
    setDraftCompany(company)
  }, [company])

  useEffect(() => {
    let cancelled = false
    setEmployeesLoading(true)
    loadDashboardEmployeeOptions(company)
      .then((list) => {
        if (!cancelled) setEmployees(list)
      })
      .catch(() => {
        if (!cancelled) setEmployees([])
      })
      .finally(() => {
        if (!cancelled) setEmployeesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [company])

  function setPreset(preset: DashboardRangePreset) {
    setDraft((prev) => ({ ...prev, preset }))
  }

  return (
    <div className="dashboard-filter-bar">
      <div className="dashboard-filter-row">
        <label className="dashboard-filter-field">
          <span className="field-label">Period</span>
          <select
            className="field field-compact"
            value={draft.preset}
            onChange={(e) => setPreset(e.target.value as DashboardRangePreset)}
          >
            {(Object.keys(DASHBOARD_PRESET_LABELS) as DashboardRangePreset[]).map((key) => (
              <option key={key} value={key}>
                {DASHBOARD_PRESET_LABELS[key]}
              </option>
            ))}
          </select>
        </label>

        <label className="dashboard-filter-field">
          <span className="field-label">Year</span>
          <input
            type="number"
            className="field field-compact dashboard-filter-year"
            min={2020}
            max={2100}
            value={draft.year}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, year: Number.parseInt(e.target.value, 10) || prev.year }))
            }
          />
        </label>

        {draft.preset === 'monthly' ? (
          <label className="dashboard-filter-field">
            <span className="field-label">Month</span>
            <select
              className="field field-compact"
              value={draft.month}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  month: Number.parseInt(e.target.value, 10),
                  quarter: Math.ceil(Number.parseInt(e.target.value, 10) / 3),
                }))
              }
            >
              {MONTHS_SHORT.map((label, i) => (
                <option key={label} value={i + 1}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {draft.preset === 'quarterly' ? (
          <label className="dashboard-filter-field">
            <span className="field-label">Quarter</span>
            <select
              className="field field-compact"
              value={draft.quarter}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, quarter: Number.parseInt(e.target.value, 10) }))
              }
            >
              <option value={1}>Q1 (Jan-Mar)</option>
              <option value={2}>Q2 (Apr-Jun)</option>
              <option value={3}>Q3 (Jul-Sep)</option>
              <option value={4}>Q4 (Oct-Dec)</option>
            </select>
          </label>
        ) : null}

        {draft.preset === 'custom' ? (
          <>
            <label className="dashboard-filter-field">
              <span className="field-label">From</span>
              <input
                type="date"
                className="field field-compact"
                value={draft.dateFrom}
                onChange={(e) => setDraft((prev) => ({ ...prev, dateFrom: e.target.value }))}
              />
            </label>
            <label className="dashboard-filter-field">
              <span className="field-label">To</span>
              <input
                type="date"
                className="field field-compact"
                value={draft.dateTo}
                onChange={(e) => setDraft((prev) => ({ ...prev, dateTo: e.target.value }))}
              />
            </label>
          </>
        ) : null}

        {showCompany ? (
          <label className="dashboard-filter-field">
            <span className="field-label">Company</span>
            <select
              className="field field-compact"
              value={draftCompany}
              onChange={(e) => setDraftCompany(e.target.value as UploadCompanyCode)}
            >
              {UPLOAD_COMPANY_CODES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {draft.preset === 'monthly' && onShiftMonth ? (
          <div className="dashboard-filter-nav">
            <button type="button" className="btn-secondary" onClick={() => onShiftMonth(-1)}>
              ← Prev
            </button>
            <button type="button" className="btn-secondary" onClick={() => onShiftMonth(1)}>
              Next →
            </button>
          </div>
        ) : null}

        <button
          type="button"
          className="btn-primary dashboard-filter-apply"
          onClick={() => onApply(draft, draftCompany)}
        >
          Apply filters
        </button>
      </div>

      <DashboardEmployeeFilter
        employees={employees}
        selectedIds={draft.employeeIds}
        loading={employeesLoading}
        onChange={(employeeIds) => setDraft((prev) => ({ ...prev, employeeIds }))}
      />
    </div>
  )
}
