/**
 * Default cycle year when the API is called without an explicit `year` query
 * (server applies the real policy; this is only a client fallback).
 */
export const CYCLE_ROLLOUT_YEAR = 2026

export function activeCycleYear(now: Date = new Date()): number {
  return Math.max(now.getFullYear(), CYCLE_ROLLOUT_YEAR)
}

export function parseCycleYearParam(raw: string | null): number | null {
  if (!raw) return null
  const year = Number.parseInt(raw, 10)
  if (!Number.isFinite(year) || year < 2000 || year > 2100) return null
  return year
}
