import type { HolidayDayType, HolidayEntry } from '../api/holidays'
import {
  dayBadgeFromIso,
  dayLabelFromIso,
  dayTypeLabel,
  groupRowsByMonth,
  holidayStats,
  monthHeatmap,
  monthTitleFromKey,
  shortDateFromIso,
  type HolidayDraftRow,
} from '../utils/holidayUi'

type Props = {
  year: number
  yearOptions: number[]
  onYearChange: (year: number) => void
  rows: HolidayEntry[]
  displayRows: HolidayDraftRow[]
  editing: boolean
  loading: boolean
  canEdit: boolean
  saving: boolean
  copySourceYear: number | null
  onStartEdit: () => void
  onCancelEdit: () => void
  onSave: () => void
  onCopyPrevious: () => void
  onAddRow: () => void
  onRemoveRow: (key: string) => void
  onUpdateRow: (key: string, patch: Partial<HolidayDraftRow>) => void
}

function DayTypePill({ dayType }: { dayType: HolidayDayType }) {
  const half = dayType === 'half'
  return (
    <span
      className={[
        'inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
        half
          ? 'bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-200'
          : 'bg-[var(--insight-attendance-soft)] text-emerald-900 ring-1 ring-inset ring-emerald-200',
      ].join(' ')}
    >
      {dayTypeLabel(dayType)}
    </span>
  )
}

function HolidayDateBadge({ iso }: { iso: string }) {
  const { day, month } = dayBadgeFromIso(iso)
  return (
    <div
      className="holiday-date-badge flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-[linear-gradient(145deg,var(--insight-attendance-soft),#fff)] ring-1 ring-[color-mix(in_srgb,var(--insight-attendance)_22%,transparent)]"
      aria-hidden
    >
      <span className="text-lg font-bold leading-none tabular-nums text-[var(--color-ink)]">{day}</span>
      <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-warm-text)]">
        {month}
      </span>
    </div>
  )
}

export function HolidayYearBoard({
  year,
  yearOptions,
  onYearChange,
  rows,
  displayRows,
  editing,
  loading,
  canEdit,
  saving,
  copySourceYear,
  onStartEdit,
  onCancelEdit,
  onSave,
  onCopyPrevious,
  onAddRow,
  onRemoveRow,
  onUpdateRow,
}: Props) {
  const stats = holidayStats(rows)
  const heatmap = monthHeatmap(year, rows)
  const monthGroups = groupRowsByMonth(displayRows)
  const monthNames = Array.from({ length: 12 }, (_, i) =>
    new Date(year, i, 1).toLocaleDateString('en-IN', { month: 'short' }),
  )

  return (
    <div className="space-y-6">
      <section className="holiday-hero overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--insight-attendance)_16%,transparent)] bg-[linear-gradient(145deg,var(--insight-attendance-soft)_0%,#fff_48%,color-mix(in_srgb,var(--color-brand-soft)_35%,#fff)_100%)] p-6 shadow-[var(--shadow-card)] sm:p-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-warm-text)]">
              Company calendar
            </p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-[var(--color-ink)]">{year}</h2>
            <p className="mt-2 max-w-lg text-sm text-[var(--color-warm-text)]">
              Full days have no expected hours; half days expect 4.5h on Mon-Sat in attendance.
            </p>

            <div className="seg mt-5 inline-flex flex-wrap" role="group" aria-label="Calendar year">
              {yearOptions.length > 1
                ? yearOptions.map((y) => (
                    <button
                      key={y}
                      type="button"
                      disabled={editing || saving}
                      className={`seg-btn ${year === y ? 'seg-btn-active' : ''}`}
                      onClick={() => onYearChange(y)}
                    >
                      {y}
                    </button>
                  ))
                : null}
            </div>
          </div>

          <div className="grid w-full max-w-md grid-cols-3 gap-2 sm:gap-3">
            <div className="rounded-xl bg-white/80 px-3 py-3 ring-1 ring-[color-mix(in_srgb,var(--insight-attendance)_15%,transparent)]">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-warm-text)]">
                Total
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--color-ink)]">{stats.total}</p>
            </div>
            <div className="rounded-xl bg-white/80 px-3 py-3 ring-1 ring-emerald-200/80">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800/80">Full</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-900">{stats.full}</p>
            </div>
            <div className="rounded-xl bg-white/80 px-3 py-3 ring-1 ring-amber-200/80">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-900/70">Half</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-amber-950">{stats.half}</p>
            </div>
          </div>
        </div>

        {stats.next && !editing ? (
          <div className="mt-6 flex flex-col gap-3 rounded-xl border border-[color-mix(in_srgb,var(--insight-attendance)_20%,transparent)] bg-white/70 p-4 sm:flex-row sm:items-center sm:gap-4">
            <HolidayDateBadge iso={stats.next.holidayDate} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--insight-attendance)]">
                Next holiday
              </p>
              <p className="mt-0.5 text-lg font-semibold text-[var(--color-ink)]">{stats.next.name}</p>
              <p className="text-sm text-[var(--color-warm-text)]">
                {stats.next.shortDateLabel ?? shortDateFromIso(stats.next.holidayDate)} ·{' '}
                {stats.next.dayLabel ?? dayLabelFromIso(stats.next.holidayDate)}
              </p>
            </div>
            <DayTypePill dayType={stats.next.dayType ?? 'full'} />
          </div>
        ) : null}

        <div className="mt-6">
          <p className="mb-2 text-xs font-medium text-[var(--color-warm-text)]">Holidays by month</p>
          <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-12">
            {monthNames.map((label, i) => {
              const n = heatmap[i]
              return (
                <div
                  key={label}
                  className={[
                    'rounded-lg px-1 py-2 text-center text-[10px] sm:text-xs',
                    n > 0
                      ? 'bg-[color-mix(in_srgb,var(--insight-attendance)_18%,#fff)] font-semibold text-emerald-900'
                      : 'bg-white/50 text-[var(--color-warm-text)]',
                  ].join(' ')}
                  title={`${label}: ${n} holiday${n === 1 ? '' : 's'}`}
                >
                  <span className="block">{label}</span>
                  {n > 0 ? (
                    <span className="mt-0.5 block text-[10px] tabular-nums opacity-80">{n}</span>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>

        {canEdit ? (
          <div className="mt-6 flex flex-wrap gap-2 border-t border-[color-mix(in_srgb,var(--insight-attendance)_12%,transparent)] pt-5">
            {editing ? (
              <>
                <button type="button" className="btn-ghost" disabled={saving} onClick={onCancelEdit}>
                  Cancel
                </button>
                {copySourceYear != null ? (
                  <button type="button" className="btn-secondary" disabled={saving} onClick={onCopyPrevious}>
                    Copy from {copySourceYear}
                  </button>
                ) : null}
                <button type="button" className="btn-secondary" disabled={saving} onClick={onAddRow}>
                  Add holiday
                </button>
                <button type="button" className="btn-primary" disabled={saving} onClick={onSave}>
                  {saving ? 'Saving…' : 'Save list'}
                </button>
              </>
            ) : (
              <>
                {rows.length === 0 && copySourceYear != null ? (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={loading || saving}
                    onClick={onCopyPrevious}
                  >
                    Copy from {copySourceYear}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={rows.length === 0 && copySourceYear != null ? 'btn-secondary' : 'btn-primary'}
                  disabled={loading}
                  onClick={onStartEdit}
                >
                  {rows.length === 0 ? 'Start empty list' : `Edit ${year} list`}
                </button>
              </>
            )}
          </div>
        ) : null}
      </section>

      <section className="space-y-5">
        {loading ? (
          <p className="text-sm text-[var(--color-warm-text)]">Loading holidays…</p>
        ) : displayRows.length === 0 ? (
          <div className="card border p-10 text-center text-sm text-[var(--color-warm-text)]">
            {canEdit ? (
              <>
                <p>No holidays for {year} yet.</p>
                {copySourceYear != null ? (
                  <p className="mt-2">
                    Copy the {copySourceYear} list (same dates and names, shifted to {year}), then edit
                    and save.
                  </p>
                ) : (
                  <p className="mt-2">Start a new list or pick a year that already has holidays.</p>
                )}
              </>
            ) : (
              `No holidays published for ${year} yet.`
            )}
          </div>
        ) : (
          monthGroups.map((group) => (
            <div key={group.key}>
              <h3 className="mb-3 text-sm font-semibold text-[var(--color-ink)]">
                {monthTitleFromKey(group.key)}
                <span className="ml-2 font-normal text-[var(--color-warm-text)]">
                  ({group.rows.length})
                </span>
              </h3>
              <ul className="space-y-2">
                {group.rows.map((row) =>
                  editing ? (
                    <li
                      key={row.key}
                      className="flex flex-col gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--color-warm-muted)_70%,transparent)] bg-[var(--color-surface)] p-4 sm:flex-row sm:items-end"
                    >
                      <label className="feature-field min-w-[10rem] flex-1">
                        <span>Date</span>
                        <input
                          type="date"
                          className="field w-full"
                          value={row.holidayDate}
                          onChange={(e) => onUpdateRow(row.key, { holidayDate: e.target.value })}
                        />
                      </label>
                      <label className="feature-field min-w-0 flex-[2]">
                        <span>Holiday name</span>
                        <input
                          type="text"
                          className="field w-full"
                          value={row.name}
                          placeholder="e.g. Diwali"
                          onChange={(e) => onUpdateRow(row.key, { name: e.target.value })}
                        />
                      </label>
                      <label className="feature-field w-full sm:w-36">
                        <span>Type</span>
                        <select
                          className="field w-full"
                          value={row.dayType}
                          onChange={(e) =>
                            onUpdateRow(row.key, { dayType: e.target.value as HolidayDayType })
                          }
                        >
                          <option value="full">Full day</option>
                          <option value="half">Half day</option>
                        </select>
                      </label>
                      <button
                        type="button"
                        className="btn-ghost shrink-0 text-red-700"
                        onClick={() => onRemoveRow(row.key)}
                      >
                        Remove
                      </button>
                    </li>
                  ) : (
                    <li
                      key={row.key}
                      className="flex items-center gap-4 rounded-2xl border border-[color-mix(in_srgb,var(--color-warm-muted)_55%,transparent)] bg-[var(--color-surface)] p-4 shadow-sm transition hover:border-[color-mix(in_srgb,var(--insight-attendance)_25%,transparent)]"
                    >
                      <HolidayDateBadge iso={row.holidayDate} />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-[var(--color-ink)]">{row.name}</p>
                        <p className="text-sm text-[var(--color-warm-text)]">{dayLabelFromIso(row.holidayDate)}</p>
                      </div>
                      <DayTypePill dayType={row.dayType} />
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  )
}
