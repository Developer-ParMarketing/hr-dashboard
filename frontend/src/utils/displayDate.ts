/** User-facing calendar dates: DD-MM-YYYY (storage/API stays ISO YYYY-MM-DD). */

export function formatDisplayDate(iso: string | null | undefined): string {
  if (!iso?.trim()) return ''
  const s = iso.trim().slice(0, 10)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return s
  return `${m[3]}-${m[2]}-${m[1]}`
}

export function formatDisplayDateTime(value: string | null | undefined): string {
  if (!value?.trim()) return ''
  const text = value.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const date = formatDisplayDate(text)
    if (text.length >= 16) {
      const time = text.slice(11, 16).replace('T', ' ')
      return `${date} ${time}`
    }
    return date
  }
  const d = new Date(text)
  if (Number.isNaN(d.getTime())) return text
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${formatDisplayDate(iso)} ${time}`
}

export function formatDisplayDateRange(start: string, end: string): string {
  const a = formatDisplayDate(start)
  const b = formatDisplayDate(end)
  if (!a) return b || end
  if (!b || a === b) return a
  return `${a} - ${b}`
}

export const DISPLAY_DATE_PLACEHOLDER = 'DD-MM-YYYY'

export function isoFromYmd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
