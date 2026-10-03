import type { HolidayDayType, HolidayEntry } from '../api/holidays'
import { formatDisplayDate } from './displayDate'

export type HolidayDraftRow = {
  key: string
  holidayDate: string
  name: string
  dayType: HolidayDayType
}

export function draftFromCopyPreview(
  row: { holidayDate: string; name: string; dayType: HolidayDayType },
  index: number,
): HolidayDraftRow {
  return {
    key: `copy-${index}-${row.holidayDate}`,
    holidayDate: row.holidayDate,
    name: row.name,
    dayType: row.dayType ?? 'full',
  }
}

export function draftFromHoliday(row: HolidayEntry): HolidayDraftRow {
  return {
    key: `saved-${row.id}`,
    holidayDate: row.holidayDate,
    name: row.name,
    dayType: row.dayType ?? 'full',
  }
}

export function dayTypeLabel(dayType: HolidayDayType): string {
  return dayType === 'half' ? 'Half day' : 'Full day'
}

export function dayLabelFromIso(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '-'
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('en-IN', { weekday: 'long' })
}

export function shortDateFromIso(iso: string): string {
  return formatDisplayDate(iso) || iso
}

export function monthKeyFromIso(iso: string): string {
  return iso.slice(0, 7)
}

export function monthTitleFromKey(key: string): string {
  const [y, m] = key.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

export function dayBadgeFromIso(iso: string): { day: string; month: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return { day: '-', month: '-' }
  const d = new Date(`${iso}T12:00:00`)
  return {
    day: String(d.getDate()),
    month: d.toLocaleDateString('en-IN', { month: 'short' }),
  }
}

export function groupRowsByMonth<T extends { holidayDate: string }>(rows: T[]): Array<{ key: string; rows: T[] }> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const key = monthKeyFromIso(row.holidayDate)
    const list = map.get(key) ?? []
    list.push(row)
    map.set(key, list)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, monthRows]) => ({
      key,
      rows: [...monthRows].sort((a, b) => a.holidayDate.localeCompare(b.holidayDate)),
    }))
}

export function holidayStats(rows: HolidayEntry[]) {
  const full = rows.filter((r) => (r.dayType ?? 'full') === 'full').length
  const half = rows.length - full
  const today = new Date().toISOString().slice(0, 10)
  const upcoming = rows.filter((r) => r.holidayDate >= today).sort((a, b) => a.holidayDate.localeCompare(b.holidayDate))
  return { total: rows.length, full, half, upcoming, next: upcoming[0] ?? null }
}

export function monthHeatmap(year: number, rows: HolidayEntry[]): number[] {
  const counts = Array.from({ length: 12 }, () => 0)
  for (const row of rows) {
    if (!row.holidayDate.startsWith(String(year))) continue
    const m = Number.parseInt(row.holidayDate.slice(5, 7), 10)
    if (m >= 1 && m <= 12) counts[m - 1] += 1
  }
  return counts
}
