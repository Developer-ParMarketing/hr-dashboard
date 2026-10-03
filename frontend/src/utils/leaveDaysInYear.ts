/** Count inclusive calendar days between ISO dates, clipped to a calendar year. */
export function countDaysInRangeForYear(startDate: string, endDate: string, year: number): number {
  const yearStart = `${year}-01-01`
  const yearEnd = `${year}-12-31`
  const from = startDate.slice(0, 10) < yearStart ? yearStart : startDate.slice(0, 10)
  const to = endDate.slice(0, 10) > yearEnd ? yearEnd : endDate.slice(0, 10)
  if (from > to) return 0
  const start = parseIsoLocal(from)
  const end = parseIsoLocal(to)
  if (!start || !end) return 0
  let n = 0
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate())
  while (cursor <= last) {
    n += 1
    cursor.setDate(cursor.getDate() + 1)
  }
  return n
}

function parseIsoLocal(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return new Date(Number(m[1]), Number.parseInt(m[2], 10) - 1, Number.parseInt(m[3], 10))
}
