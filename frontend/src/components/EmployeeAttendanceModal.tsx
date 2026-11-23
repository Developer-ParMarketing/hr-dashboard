import { useEffect, useMemo, useRef, useState } from 'react'
import type {
    CompanyHolidayDay,
    DailyAttendanceRecord,
    NormalizedEmployee,
    WeeklyAttendanceRecord,
} from '../types/attendance'
import {
    cellClass,
    dailyRecordForEmployeeDay,
    decimalWorkedHoursToDurationHm,
    isoDateYmd,
    monthlyDayHoursDetail,
    monthlyHoursAndDeficitByCalendar,
} from '../utils/attendance'

type Props = {
    /** Rows in the same order as the table, for Prev / Next. */
    employees: NormalizedEmployee[]
    index: number
    onIndexChange: (index: number) => void
    onClose: () => void
    reportYear: number
    reportMonth: number
    dailyRecords: DailyAttendanceRecord[]
    weeklyRecords?: WeeklyAttendanceRecord[]
    companyHolidays?: CompanyHolidayDay[]
    policyCompany?: string | null
    /** Day of month to open on (from clicking a day cell in the grid). */
    focusDay?: number | null
}

type DayKind = 'present' | 'halfday' | 'absent' | 'wfh' | 'leave' | 'weeklyoff' | 'holiday' | 'none'
type FilterKey = 'all' | 'present' | 'absent' | 'late' | 'halfday' | 'wfh' | 'leave'

type DayRow = {
    day: number
    iso: string
    weekday: string
    isSunday: boolean
    isFuture: boolean
    kind: DayKind
    holidayName: string | null
    label: string
    cellToken: string
    punchIn: string | null
    punchOut: string | null
    hours: number | null
    late: boolean
    lateMinutes: number | null
    note: string | null
    wfhUnverified: boolean
    origin: string | null
    machineMark: string | null
    shiftStart: string | null
}

const LEAVE_MARKS = new Set(['PL', 'SL', 'CL', 'ML', 'LWP', 'LEAVE', 'CO', 'COMP OFF'])

function todayIso(): string {
    const d = new Date()
    return isoDateYmd(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

function hm(t: string | null | undefined): string | null {
    const s = String(t ?? '').trim()
    if (!s) return null
    const m = s.match(/(\d{1,2}):(\d{2})/)
    return m ? `${m[1]!.padStart(2, '0')}:${m[2]}` : s
}

function classify(compact: string, isSunday: boolean, holiday: boolean): DayKind {
    const u = compact.trim().toUpperCase()
    if (u === 'HD') return 'halfday'
    if (u === 'P') return 'present'
    if (u.startsWith('WFH')) return 'wfh'
    if (u === 'AB' || u === 'A') return 'absent'
    if (LEAVE_MARKS.has(u)) return 'leave'
    if (u === 'WO' || u === 'DA' || u === 'OFF') return 'weeklyoff'
    if (holiday) return 'holiday'
    if (isSunday) return 'weeklyoff'
    return 'none'
}

function buildRows(
    emp: NormalizedEmployee,
    year: number,
    month: number,
    dailyRecords: DailyAttendanceRecord[],
    holidays: CompanyHolidayDay[],
): DayRow[] {
    const today = todayIso()
    const holidayByDate = new Map(holidays.map((h) => [h.holidayDate.slice(0, 10), h]))
    const total = new Date(year, month, 0).getDate()
    const rows: DayRow[] = []
    for (let day = 1; day <= total; day++) {
        const i = day - 1
        const iso = isoDateYmd(year, month, day)
        const date = new Date(year, month - 1, day)
        const isSunday = date.getDay() === 0
        const dailyRow = dailyRecordForEmployeeDay(dailyRecords, emp.employeeCode, year, month, day)
        const detail = monthlyDayHoursDetail(emp, i, dailyRow)
        const holiday = holidayByDate.get(iso)
        const kind = classify(detail.compactMark, isSunday, Boolean(holiday))
        const hoursRaw =
            dailyRow?.workingHours != null && Number.isFinite(dailyRow.workingHours)
                ? dailyRow.workingHours
                : emp.dayWorkedHours[i] ?? null
        let label = detail.withHoursLabel && detail.withHoursLabel !== '-' ? detail.withHoursLabel : ''
        if (!label) {
            if (kind === 'weeklyoff') label = 'Weekly off'
            else if (kind === 'holiday') label = 'Holiday'
            else label = '-'
        }
        rows.push({
            day,
            iso,
            weekday: date.toLocaleDateString(undefined, { weekday: 'short' }),
            isSunday,
            isFuture: iso > today,
            kind,
            holidayName: holiday ? holiday.name || 'Holiday' : null,
            label,
            cellToken: kind === 'halfday' ? 'HD' : detail.compactMark,
            punchIn: hm(dailyRow?.checkInTime ?? dailyRow?.inTime ?? emp.dayInTimes[i]),
            punchOut: hm(dailyRow?.outTime),
            hours: hoursRaw != null && hoursRaw > 0 ? hoursRaw : null,
            late: Boolean(emp.dayLateFlags[i] || dailyRow?.late),
            lateMinutes: dailyRow?.lateMinutes ?? null,
            note: dailyRow?.note?.trim() || null,
            wfhUnverified: Boolean(emp.dayWfhUnverified[i]),
            origin: dailyRow?.origin ?? null,
            machineMark: dailyRow?.rawStatusToken?.trim() || null,
            shiftStart: hm(dailyRow?.shiftStart ?? emp.shiftStart) ?? null,
        })
    }
    return rows
}

function matchesFilter(row: DayRow, filter: FilterKey): boolean {
    switch (filter) {
        case 'all':
            return true
        case 'present':
            return row.kind === 'present' || row.kind === 'halfday'
        case 'absent':
            return row.kind === 'absent'
        case 'late':
            return row.late
        case 'halfday':
            return row.kind === 'halfday'
        case 'wfh':
            return row.kind === 'wfh'
        case 'leave':
            return row.kind === 'leave'
    }
}

const FILTER_LABEL: Record<FilterKey, string> = {
    all: 'All days',
    present: 'Present days',
    absent: 'Absent days',
    late: 'Late days',
    halfday: 'Half days',
    wfh: 'WFH days',
    leave: 'Leave days',
}

const KIND_LABEL: Record<DayKind, string> = {
    present: 'Present',
    halfday: 'Half day (under 5 hours)',
    absent: 'Absent',
    wfh: 'Work from home',
    leave: 'Leave',
    weeklyoff: 'Weekly off',
    holiday: 'Holiday',
    none: 'No record',
}

function originLabel(origin: string | null): string {
    switch ((origin ?? '').toLowerCase()) {
        case 'hr_edit':
            return 'HR edit (changed by HR)'
        case 'approved':
            return 'Approved by HR'
        case 'raw':
        case 'calculated':
            return 'Machine / upload'
        default:
            return origin ? origin : 'Machine / upload'
    }
}

function fmtH(n: number | null | undefined): string {
    return n == null || !Number.isFinite(n) ? '-' : decimalWorkedHoursToDurationHm(n)
}

/** Full month view for one employee: summary cards (click to filter) + every day. */
export function EmployeeAttendanceModal({
    employees,
    index,
    onIndexChange,
    onClose,
    reportYear,
    reportMonth,
    dailyRecords,
    weeklyRecords = [],
    companyHolidays = [],
    policyCompany,
    focusDay = null,
}: Props) {
    const emp = employees[index]
    const [filter, setFilter] = useState<FilterKey>('all')
    const [selectedDay, setSelectedDay] = useState<number | null>(focusDay)
    const selectedRowRef = useRef<HTMLTableRowElement | null>(null)

    useEffect(() => {
        setFilter('all')
    }, [index])

    useEffect(() => {
        setSelectedDay(focusDay)
    }, [focusDay])

    useEffect(() => {
        selectedRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, [selectedDay, index])

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1)
            if (e.key === 'ArrowRight' && index < employees.length - 1) onIndexChange(index + 1)
        }
        document.addEventListener('keydown', onKey)
        const prevOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => {
            document.removeEventListener('keydown', onKey)
            document.body.style.overflow = prevOverflow
        }
    }, [index, employees.length, onClose, onIndexChange])

    const rows = useMemo(
        () => (emp ? buildRows(emp, reportYear, reportMonth, dailyRecords, companyHolidays) : []),
        [emp, reportYear, reportMonth, dailyRecords, companyHolidays],
    )

    const totals = useMemo(() => {
        const past = rows.filter((r) => !r.isFuture)
        return {
            present: past.filter((r) => r.kind === 'present' || r.kind === 'halfday').length,
            absent: past.filter((r) => r.kind === 'absent').length,
            late: past.filter((r) => r.late).length,
            halfday: past.filter((r) => r.kind === 'halfday').length,
            wfh: past.filter((r) => r.kind === 'wfh').length,
            leave: past.filter((r) => r.kind === 'leave').length,
        }
    }, [rows])

    const hours = useMemo(
        () =>
            emp
                ? monthlyHoursAndDeficitByCalendar(
                    emp,
                    reportYear,
                    reportMonth,
                    policyCompany,
                    weeklyRecords,
                    companyHolidays,
                )
                : null,
        [emp, reportYear, reportMonth, policyCompany, weeklyRecords, companyHolidays],
    )

    if (!emp) return null

    const visibleRows = rows.filter((r) => matchesFilter(r, filter))
    const selected = selectedDay != null ? rows.find((r) => r.day === selectedDay) ?? null : null
    const monthShort = new Date(reportYear, reportMonth - 1, 1).toLocaleString(undefined, { month: 'short' })
    const periodLabel = new Date(reportYear, reportMonth - 1, 1).toLocaleString(undefined, {
        month: 'long',
        year: 'numeric',
    })
    const team = emp.teamName || emp.department || ''

    const cards: Array<{ key: FilterKey; label: string; value: number; unit: string; tone: string }> = [
        { key: 'present', label: 'Present', value: totals.present, unit: 'days', tone: 'text-emerald-700' },
        { key: 'absent', label: 'Absent', value: totals.absent, unit: 'days', tone: 'text-red-700' },
        { key: 'late', label: 'Late marks', value: totals.late, unit: 'times', tone: 'text-amber-700' },
        { key: 'halfday', label: 'Half days', value: totals.halfday, unit: 'days', tone: 'text-orange-700' },
        { key: 'wfh', label: 'WFH days', value: totals.wfh, unit: 'days', tone: 'text-sky-700' },
        { key: 'leave', label: 'Leaves', value: totals.leave, unit: 'days', tone: 'text-violet-700' },
    ]

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3 sm:p-6"
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) onClose()
            }}
            role="dialog"
            aria-modal="true"
            aria-label={`Attendance for ${emp.employeeName}`}
        >
            <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-[var(--color-surface)] shadow-2xl">
                {/* Header */}
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-warm-muted)] bg-[color-mix(in_srgb,var(--color-warm-page)_55%,#fff)] px-5 py-4 sm:px-6">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-md bg-[var(--color-brand)] px-2 py-0.5 font-mono text-xs font-semibold text-white">
                                {emp.employeeCode}
                            </span>
                            <h2 className="text-lg font-semibold text-[var(--color-ink)] sm:text-xl">{emp.employeeName}</h2>
                            {team ? (
                                <span className="rounded-full bg-[color-mix(in_srgb,var(--color-brand-muted)_70%,#fff)] px-2.5 py-0.5 text-xs text-[var(--color-warm-text)]">
                                    {team}
                                </span>
                            ) : null}
                        </div>
                        <p className="mt-1.5 text-xs text-[var(--color-warm-text)] sm:text-sm">
                            {team ? <>Team: {team} · </> : null}
                            {emp.teamManagerName ? (
                                <>
                                    Manager: <span className="font-medium text-emerald-700">{emp.teamManagerName}</span> ·{' '}
                                </>
                            ) : null}
                            Period: {periodLabel}
                            {emp.shiftStart ? <> · Shift: {emp.shiftStart}</> : null}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            className="btn-secondary px-3 py-1.5 text-sm"
                            disabled={index <= 0}
                            onClick={() => onIndexChange(index - 1)}
                        >
                            ← Prev
                        </button>
                        <button
                            type="button"
                            className="btn-secondary px-3 py-1.5 text-sm"
                            disabled={index >= employees.length - 1}
                            onClick={() => onIndexChange(index + 1)}
                        >
                            Next →
                        </button>
                        <button
                            type="button"
                            className="ml-1 rounded-lg px-2 py-1 text-xl leading-none text-[var(--color-warm-text)] hover:bg-black/5"
                            onClick={onClose}
                            aria-label="Close"
                        >
                            ×
                        </button>
                    </div>
                </div>

                <div className="overflow-y-auto px-5 py-4 sm:px-6">
                    {/* Summary cards: click to filter the day list */}
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-8">
                        {cards.map((c) => {
                            const active = filter === c.key
                            return (
                                <button
                                    key={c.key}
                                    type="button"
                                    onClick={() => setFilter(active ? 'all' : c.key)}
                                    className={`rounded-xl border px-3 py-2.5 text-left transition ${active
                                            ? 'border-[var(--color-brand)] bg-[color-mix(in_srgb,var(--color-brand-muted)_55%,#fff)] ring-2 ring-[color-mix(in_srgb,var(--color-brand)_35%,transparent)]'
                                            : 'border-[var(--color-warm-muted)] bg-[var(--color-surface)] hover:border-[var(--color-brand)]'
                                        }`}
                                    title={`Show ${FILTER_LABEL[c.key].toLowerCase()}`}
                                >
                                    <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--color-warm-text)]">
                                        {c.label}
                                    </p>
                                    <p className="mt-1">
                                        <span className={`text-xl font-semibold tabular-nums ${c.tone}`}>{c.value}</span>{' '}
                                        <span className="text-xs text-[var(--color-warm-text)]">{c.unit}</span>
                                    </p>
                                </button>
                            )
                        })}
                        <div className="rounded-xl border border-[var(--color-warm-muted)] px-3 py-2.5">
                            <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--color-warm-text)]">
                                Hours worked
                            </p>
                            <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--color-ink)]">
                                {fmtH(hours?.hours)}
                            </p>
                        </div>
                        <div className="rounded-xl border border-[var(--color-warm-muted)] px-3 py-2.5">
                            <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--color-warm-text)]">
                                Deficit
                            </p>
                            <p
                                className={`mt-1 text-xl font-semibold tabular-nums ${hours?.deficit ? 'text-red-700' : 'text-[var(--color-ink)]'
                                    }`}
                            >
                                {fmtH(hours?.deficit)}
                            </p>
                        </div>
                    </div>

                    {selected ? (
                        <div className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--color-brand)_35%,var(--color-warm-muted))] bg-[color-mix(in_srgb,var(--color-brand-muted)_30%,#fff)] p-4">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                    <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--color-brand)]">
                                        Day details
                                    </p>
                                    <p className="mt-0.5 text-base font-semibold text-[var(--color-ink)]">
                                        {new Date(reportYear, reportMonth - 1, selected.day).toLocaleDateString(undefined, {
                                            weekday: 'long',
                                            day: '2-digit',
                                            month: 'short',
                                            year: 'numeric',
                                        })}
                                    </p>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <button
                                        type="button"
                                        className="btn-secondary px-2.5 py-1 text-xs"
                                        disabled={selected.day <= 1}
                                        onClick={() => setSelectedDay(selected.day - 1)}
                                    >
                                        ← Day
                                    </button>
                                    <button
                                        type="button"
                                        className="btn-secondary px-2.5 py-1 text-xs"
                                        disabled={selected.day >= rows.length}
                                        onClick={() => setSelectedDay(selected.day + 1)}
                                    >
                                        Day →
                                    </button>
                                    <button
                                        type="button"
                                        className="btn-ghost px-2 py-1 text-xs"
                                        onClick={() => setSelectedDay(null)}
                                    >
                                        Hide
                                    </button>
                                </div>
                            </div>
                            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm sm:grid-cols-4">
                                <div>
                                    <dt className="text-[0.65rem] uppercase tracking-wide text-[var(--color-warm-text)]">Status</dt>
                                    <dd className="mt-0.5 flex items-center gap-1.5">
                                        <span
                                            className={`inline-block rounded-md px-2 py-0.5 text-xs ${cellClass(
                                                selected.cellToken,
                                                undefined,
                                                selected.wfhUnverified,
                                            )}`}
                                        >
                                            {selected.label}
                                        </span>
                                        <span className="text-xs text-[var(--color-warm-text)]">
                                            {selected.holidayName ?? KIND_LABEL[selected.kind]}
                                        </span>
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-[0.65rem] uppercase tracking-wide text-[var(--color-warm-text)]">Punch-in</dt>
                                    <dd className="mt-0.5 font-mono font-semibold tabular-nums text-[var(--color-ink)]">
                                        {selected.punchIn ?? '-'}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-[0.65rem] uppercase tracking-wide text-[var(--color-warm-text)]">Punch-out</dt>
                                    <dd className="mt-0.5 font-mono font-semibold tabular-nums text-[var(--color-ink)]">
                                        {selected.punchOut ?? (selected.punchIn ? 'No out punch' : '-')}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-[0.65rem] uppercase tracking-wide text-[var(--color-warm-text)]">Worked</dt>
                                    <dd className="mt-0.5 font-semibold tabular-nums text-[var(--color-ink)]">{fmtH(selected.hours)}</dd>
                                </div>
                                <div>
                                    <dt className="text-[0.65rem] uppercase tracking-wide text-[var(--color-warm-text)]">Shift start</dt>
                                    <dd className="mt-0.5 font-mono tabular-nums text-[var(--color-ink)]">{selected.shiftStart ?? '-'}</dd>
                                </div>
                                <div>
                                    <dt className="text-[0.65rem] uppercase tracking-wide text-[var(--color-warm-text)]">Late</dt>
                                    <dd className="mt-0.5">
                                        {selected.late ? (
                                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                                                Late{selected.lateMinutes ? ` by ${selected.lateMinutes} min` : ''}
                                            </span>
                                        ) : (
                                            <span className="text-[var(--color-ink)]">
                                                {selected.kind === 'present' || selected.kind === 'halfday' ? 'On time' : '-'}
                                            </span>
                                        )}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-[0.65rem] uppercase tracking-wide text-[var(--color-warm-text)]">Data from</dt>
                                    <dd className="mt-0.5 text-[var(--color-ink)]">
                                        {selected.isFuture ? 'Upcoming day' : originLabel(selected.origin)}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-[0.65rem] uppercase tracking-wide text-[var(--color-warm-text)]">Machine mark</dt>
                                    <dd className="mt-0.5 text-[var(--color-ink)]">
                                        {selected.machineMark && selected.origin === 'hr_edit'
                                            ? `${selected.machineMark} (before HR edit)`
                                            : selected.machineMark ?? '-'}
                                    </dd>
                                </div>
                            </dl>
                            {selected.note ? (
                                <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-xs text-[var(--color-warm-text)]">
                                    Note: {selected.note}
                                </p>
                            ) : null}
                        </div>
                    ) : null}

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm text-[var(--color-warm-text)]">
                            Showing <strong className="text-[var(--color-ink)]">{FILTER_LABEL[filter]}</strong> (
                            {visibleRows.length})
                            {filter !== 'all' ? <span className="ml-1 text-xs">· click a card again to see all</span> : null}
                        </p>
                        {filter !== 'all' ? (
                            <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setFilter('all')}>
                                Show all days
                            </button>
                        ) : null}
                    </div>

                    {/* Day list */}
                    <div className="mt-2 overflow-x-auto rounded-xl border border-[var(--color-warm-muted)]">
                        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                            <thead className="bg-[color-mix(in_srgb,var(--color-brand-muted)_45%,#fff)] text-[0.7rem] uppercase tracking-wide text-[var(--color-warm-text)]">
                                <tr>
                                    <th className="px-3 py-2.5">Date</th>
                                    <th className="px-3 py-2.5">Day</th>
                                    <th className="px-3 py-2.5 text-center">Status</th>
                                    <th className="px-3 py-2.5">Punch-in</th>
                                    <th className="px-3 py-2.5">Punch-out</th>
                                    <th className="px-3 py-2.5">Worked</th>
                                    <th className="px-3 py-2.5 text-center">Late</th>
                                    <th className="px-3 py-2.5">Notes</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visibleRows.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="px-3 py-6 text-center text-[var(--color-warm-text)]">
                                            No {FILTER_LABEL[filter].toLowerCase()} this month.
                                        </td>
                                    </tr>
                                ) : (
                                    visibleRows.map((r) => {
                                        const muted = r.kind === 'weeklyoff' || r.isFuture
                                        const isSelected = r.day === selectedDay
                                        return (
                                            <tr
                                                key={r.iso}
                                                ref={isSelected ? selectedRowRef : undefined}
                                                onClick={() => setSelectedDay(isSelected ? null : r.day)}
                                                title="Click to see this day's details"
                                                className={`cursor-pointer border-t border-[var(--color-warm-muted)] hover:bg-[color-mix(in_srgb,var(--color-brand-muted)_35%,transparent)] ${isSelected
                                                        ? 'bg-[color-mix(in_srgb,var(--color-brand-muted)_55%,#fff)] outline outline-2 -outline-offset-2 outline-[var(--color-brand)]'
                                                        : r.late
                                                            ? 'bg-amber-50/60'
                                                            : muted
                                                                ? 'bg-black/[0.015]'
                                                                : ''
                                                    }`}
                                            >
                                                <td className="whitespace-nowrap px-3 py-2 font-mono text-[var(--color-ink)]">
                                                    {String(r.day).padStart(2, '0')} {monthShort}
                                                </td>
                                                <td
                                                    className={`px-3 py-2 ${r.isSunday ? 'text-[var(--color-warm-text)]' : 'text-[var(--color-ink)]'
                                                        }`}
                                                >
                                                    {r.weekday}
                                                </td>
                                                <td className="px-3 py-2 text-center">
                                                    {r.kind === 'holiday' && r.cellToken === '-' ? (
                                                        <span className="rounded-md bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800">
                                                            {r.holidayName}
                                                        </span>
                                                    ) : r.kind === 'weeklyoff' && r.label === 'Weekly off' ? (
                                                        <span className="rounded-md bg-black/[0.05] px-2 py-0.5 text-xs text-[var(--color-warm-text)]">
                                                            Weekly off
                                                        </span>
                                                    ) : (
                                                        <span
                                                            className={`inline-block rounded-md px-2 py-0.5 text-xs ${cellClass(
                                                                r.cellToken,
                                                                undefined,
                                                                r.wfhUnverified,
                                                            )}`}
                                                        >
                                                            {r.isFuture && r.label === '-' ? '-' : r.label}
                                                        </span>
                                                    )}
                                                    {r.holidayName && r.cellToken !== '-' ? (
                                                        <span className="ml-1 rounded bg-indigo-100 px-1.5 py-0.5 text-[0.65rem] text-indigo-800">
                                                            Holiday
                                                        </span>
                                                    ) : null}
                                                </td>
                                                <td className="px-3 py-2 font-mono tabular-nums">{r.punchIn ?? '-'}</td>
                                                <td className="px-3 py-2 font-mono tabular-nums">{r.punchOut ?? '-'}</td>
                                                <td className="px-3 py-2 tabular-nums">{fmtH(r.hours)}</td>
                                                <td className="px-3 py-2 text-center">
                                                    {r.late ? (
                                                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                                                            LATE{r.lateMinutes ? ` ${r.lateMinutes}m` : ''}
                                                        </span>
                                                    ) : r.kind === 'present' || r.kind === 'halfday' ? (
                                                        <span className="text-xs text-[var(--color-warm-text)]">OK</span>
                                                    ) : (
                                                        <span className="text-xs text-[var(--color-warm-text)]">-</span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 text-xs text-[var(--color-warm-text)]">{r.note ?? '-'}</td>
                                            </tr>
                                        )
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-[var(--color-warm-muted)] px-5 py-3 text-sm text-[var(--color-warm-text)] sm:px-6">
                    <span>
                        Viewing <strong className="text-[var(--color-ink)]">{index + 1}</strong> of{' '}
                        <strong className="text-[var(--color-ink)]">{employees.length}</strong> employees · ← / → keys to
                        move · click a day for details
                    </span>
                    <button type="button" className="btn-secondary px-4 py-1.5" onClick={onClose}>
                        Close
                    </button>
                </div>
            </div>
        </div>
    )
}