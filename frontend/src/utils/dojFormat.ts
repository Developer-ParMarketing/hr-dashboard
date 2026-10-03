/** Display and input format for dates: DD-MM-YYYY (storage/API remains ISO YYYY-MM-DD). */

import {
  DISPLAY_DATE_PLACEHOLDER,
  formatDisplayDate,
  formatDisplayDateRange,
} from './displayDate'

export { formatDisplayDate, formatDisplayDateRange, DISPLAY_DATE_PLACEHOLDER }

/** @deprecated Use formatDisplayDate */
export function formatDojDdMmYyyy(iso: string | null | undefined): string {
  return formatDisplayDate(iso)
}

export function parseDojInput(text: string): string | null {
  const t = text.trim()
  if (!t) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t

  const dmY = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (dmY) {
    const day = Number.parseInt(dmY[1]!, 10)
    const month = Number.parseInt(dmY[2]!, 10)
    const year = Number.parseInt(dmY[3]!, 10)
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const dt = new Date(Date.UTC(year, month - 1, day))
    if (
      dt.getUTCFullYear() !== year ||
      dt.getUTCMonth() !== month - 1 ||
      dt.getUTCDate() !== day
    ) {
      return null
    }
    return iso
  }

  return null
}

export const DOJ_INPUT_PLACEHOLDER = DISPLAY_DATE_PLACEHOLDER
