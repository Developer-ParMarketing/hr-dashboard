import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { DashboardEmployeeOption } from '../../api/dashboard'

function matchesEmployee(emp: DashboardEmployeeOption, query: string): boolean {
  if (!query.trim()) return true
  const q = query.trim().toLowerCase()
  return (
    emp.name.toLowerCase().includes(q) ||
    (emp.code?.toLowerCase().includes(q) ?? false)
  )
}

type Props = {
  employees: DashboardEmployeeOption[]
  selectedIds: number[]
  loading: boolean
  onChange: (ids: number[]) => void
}

export function DashboardEmployeeFilter({ employees, selectedIds, loading, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const triggerId = useId()

  const filtered = useMemo(
    () => employees.filter((emp) => matchesEmployee(emp, search)),
    [employees, search],
  )

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  const selectedEmployees = useMemo(
    () => employees.filter((emp) => selectedSet.has(emp.id)),
    [employees, selectedSet],
  )

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => searchRef.current?.focus(), 0)
    let listening = false
    function onDocClick(e: MouseEvent) {
      if (!listening) return
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        setSearch('')
      }
    }
    const listenTimer = window.setTimeout(() => {
      listening = true
    }, 0)
    document.addEventListener('click', onDocClick, true)
    document.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(t)
      window.clearTimeout(listenTimer)
      document.removeEventListener('click', onDocClick, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function toggleId(id: number) {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange([...next])
  }

  function selectAllFiltered() {
    const next = new Set(selectedIds)
    for (const emp of filtered) next.add(emp.id)
    onChange([...next])
  }

  function clearSelection() {
    onChange([])
  }

  function removeId(id: number) {
    onChange(selectedIds.filter((x) => x !== id))
  }

  const triggerLabel =
    selectedIds.length === 0
      ? `All employees${employees.length > 0 ? ` (${employees.length})` : ''}`
      : `${selectedIds.length} selected`

  return (
    <div className="dashboard-filter-employee-picker" ref={rootRef}>
      <div className="dashboard-filter-employee-picker-head">
        <span className="field-label" id={triggerId}>
          Employees
        </span>
        <button
          type="button"
          className="dashboard-filter-employee-trigger field field-compact"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-labelledby={triggerId}
          disabled={loading || employees.length === 0}
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => {
              if (v) setSearch('')
              return !v
            })
          }}
        >
          <span className="dashboard-filter-employee-trigger-label">{loading ? 'Loading…' : triggerLabel}</span>
          <span className="dashboard-filter-employee-trigger-chevron" aria-hidden>
            ▾
          </span>
        </button>
      </div>

      {loading ? null : employees.length === 0 ? (
        <p className="text-sm text-[var(--color-warm-text)]">No employees in your scope.</p>
      ) : null}

      {open && !loading && employees.length > 0 ? (
        <div className="dashboard-filter-employee-dropdown">
          <input
            ref={searchRef}
            type="search"
            className="field field-compact dashboard-filter-employee-search"
            placeholder="Search name or employee code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-controls={listId}
            aria-label="Search employees"
          />
          <div className="dashboard-filter-employee-dropdown-actions">
            <button type="button" className="btn-ghost text-xs" onClick={selectAllFiltered}>
              Add all {search.trim() ? 'shown' : ''}
            </button>
            <button type="button" className="btn-ghost text-xs" onClick={clearSelection}>
              Clear (all company)
            </button>
          </div>
          <ul
            id={listId}
            className="dashboard-filter-employee-list"
            role="listbox"
            aria-multiselectable="true"
            aria-label="Employees"
          >
            {filtered.length === 0 ? (
              <li className="dashboard-filter-employee-empty">No employees match your search.</li>
            ) : (
              filtered.map((emp) => {
                const checked = selectedSet.has(emp.id)
                return (
                  <li key={emp.id} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={checked}
                      className={`dashboard-filter-employee-option${checked ? ' dashboard-filter-employee-option-selected' : ''}`}
                      onClick={() => toggleId(emp.id)}
                    >
                      <span className="dashboard-filter-employee-option-check" aria-hidden>
                        {checked ? '✓' : ''}
                      </span>
                      <span className="dashboard-filter-employee-option-text">
                        <span className="dashboard-filter-employee-option-name">{emp.name}</span>
                        {emp.code ? (
                          <span className="dashboard-filter-employee-option-code">{emp.code}</span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        </div>
      ) : null}

      {selectedEmployees.length > 0 ? (
        <div className="dashboard-filter-employee-selected">
          {selectedEmployees.map((emp) => (
            <span key={emp.id} className="dashboard-filter-chip dashboard-filter-chip-active">
              {emp.name}
              {emp.code ? ` (${emp.code})` : ''}
              <button
                type="button"
                className="dashboard-filter-chip-remove"
                aria-label={`Remove ${emp.name}`}
                onClick={() => removeId(emp.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="dashboard-filter-employee-hint text-xs text-[var(--color-warm-text)]">
          Leave unselected to include everyone in your scope.
        </p>
      )}
    </div>
  )
}
