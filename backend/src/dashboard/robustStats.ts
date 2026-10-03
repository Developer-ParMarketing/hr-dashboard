/** Robust statistics for attendance anomaly detection (median + MAD, resistant to outliers). */

export const BASELINE_MIN_SAMPLES = 3;
export const BASELINE_MAX_HISTORY_MONTHS = 6;

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function mad(values: number[], med: number): number {
  if (values.length === 0) return 0;
  const devs = values.map((v) => Math.abs(v - med));
  return median(devs);
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/** Lower-than-usual vs personal history (e.g. pay days). */
export function detectLowOutlier(
  current: number,
  history: number[],
  minSamples = BASELINE_MIN_SAMPLES,
): { message: string; severity: number } | null {
  if (history.length < minSamples || !Number.isFinite(current)) return null;
  const med = median(history);
  const spread = mad(history, med);
  const threshold = med - Math.max(spread * 2, 1);
  if (current >= threshold) return null;
  const gap = med - current;
  const severity = Math.min(100, Math.round(40 + gap * 8 + spread * 5));
  return {
    message: `Unusually low vs recent months (about ${Math.round(med)} typical, now ${current})`,
    severity,
  };
}

/** Higher-than-usual vs personal history (e.g. late marks, WFH, absences). */
export function detectHighOutlier(
  current: number,
  history: number[],
  label: string,
  minSamples = BASELINE_MIN_SAMPLES,
): { message: string; severity: number } | null {
  if (history.length < minSamples || !Number.isFinite(current)) return null;
  const med = median(history);
  const spread = mad(history, med);
  const threshold = med + Math.max(spread * 2, 1);
  if (current <= threshold) return null;
  const gap = current - med;
  const severity = Math.min(100, Math.round(35 + gap * 10 + spread * 4));
  return {
    message: `Unusually high ${label} vs recent months (about ${Math.round(med)} typical, now ${current})`,
    severity,
  };
}
