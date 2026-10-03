import { daysInMonth, isoDate } from "../persist/helpers.js";
import { formatDisplayDateRange } from "../displayDate.js";

export type DashboardRangePreset = "monthly" | "quarterly" | "yearly" | "custom";

export type ResolvedDashboardPeriod = {
  preset: DashboardRangePreset;
  year: number;
  month: number;
  quarter: number | null;
  dateFrom: string;
  dateTo: string;
  label: string;
  /** True when the range is exactly one calendar month (payroll checklist applies). */
  isSingleCalendarMonth: boolean;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(s: string): string | null {
  const t = s.trim();
  if (!ISO_DATE.test(t)) return null;
  const [y, m, d] = t.split("-").map((x) => Number.parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return t;
}

function quarterBounds(year: number, quarter: number): { from: string; to: string } {
  const q = Math.min(4, Math.max(1, quarter));
  const startMonth = (q - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  return {
    from: isoDate(year, startMonth, 1),
    to: isoDate(year, endMonth, daysInMonth(year, endMonth)),
  };
}

function isSameCalendarMonth(from: string, to: string): boolean {
  return from.slice(0, 7) === to.slice(0, 7);
}

export function parseDashboardRangePreset(raw: string | undefined): DashboardRangePreset {
  const v = (raw ?? "monthly").trim().toLowerCase();
  if (v === "quarterly" || v === "yearly" || v === "custom") return v;
  return "monthly";
}

export function parseEmployeeIdFilter(raw: string | undefined): number[] | null {
  if (raw == null || raw.trim() === "") return null;
  const ids = raw
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return ids.length > 0 ? [...new Set(ids)] : null;
}

export function mergeEmployeeScope(
  scopeIds: number[] | null,
  filterIds: number[] | null,
): number[] | null {
  if (filterIds == null || filterIds.length === 0) return scopeIds;
  if (scopeIds == null) return filterIds;
  const allowed = new Set(filterIds);
  return scopeIds.filter((id) => allowed.has(id));
}

export function resolveDashboardPeriod(input: {
  preset: DashboardRangePreset;
  year: number;
  month: number;
  quarter?: number;
  dateFrom?: string;
  dateTo?: string;
}): ResolvedDashboardPeriod | { error: string } {
  const year = input.year;
  const month = Math.min(12, Math.max(1, input.month));

  if (input.preset === "monthly") {
    const dim = daysInMonth(year, month);
    const dateFrom = isoDate(year, month, 1);
    const dateTo = isoDate(year, month, dim);
    const monthName = new Date(year, month - 1, 1).toLocaleString("en-IN", { month: "long" });
    return {
      preset: "monthly",
      year,
      month,
      quarter: null,
      dateFrom,
      dateTo,
      label: `${monthName} ${year}`,
      isSingleCalendarMonth: true,
    };
  }

  if (input.preset === "quarterly") {
    const quarter = Math.min(4, Math.max(1, input.quarter ?? Math.ceil(month / 3)));
    const { from, to } = quarterBounds(year, quarter);
    return {
      preset: "quarterly",
      year,
      month,
      quarter,
      dateFrom: from,
      dateTo: to,
      label: `Q${quarter} ${year} (${formatDisplayDateRange(from, to)})`,
      isSingleCalendarMonth: false,
    };
  }

  if (input.preset === "yearly") {
    const dateFrom = isoDate(year, 1, 1);
    const dateTo = isoDate(year, 12, 31);
    return {
      preset: "yearly",
      year,
      month,
      quarter: null,
      dateFrom,
      dateTo,
      label: `Calendar ${year}`,
      isSingleCalendarMonth: false,
    };
  }

  const from = parseIsoDate(input.dateFrom ?? "");
  const to = parseIsoDate(input.dateTo ?? "");
  if (!from || !to) {
    return { error: "Custom range requires valid dateFrom and dateTo (YYYY-MM-DD)" };
  }
  if (from > to) {
    return { error: "dateFrom must be on or before dateTo" };
  }
  const start = new Date(from + "T12:00:00Z");
  const end = new Date(to + "T12:00:00Z");
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  if (days > 366) {
    return { error: "Custom range cannot exceed 366 days" };
  }

  return {
    preset: "custom",
    year: Number.parseInt(from.slice(0, 4), 10),
    month: Number.parseInt(from.slice(5, 7), 10),
    quarter: null,
    dateFrom: from,
    dateTo: to,
    label: formatDisplayDateRange(from, to),
    isSingleCalendarMonth: isSameCalendarMonth(from, to),
  };
}

/** Previous calendar month (full month bounds). */
function previousCalendarMonth(dateFrom: string): { dateFrom: string; dateTo: string } {
  const y = Number.parseInt(dateFrom.slice(0, 4), 10);
  const m = Number.parseInt(dateFrom.slice(5, 7), 10);
  const d = new Date(y, m - 2, 1);
  const py = d.getFullYear();
  const pm = d.getMonth() + 1;
  const dim = daysInMonth(py, pm);
  return { dateFrom: isoDate(py, pm, 1), dateTo: isoDate(py, pm, dim) };
}

/**
 * Prior period used for pattern comparison.
 * Single calendar month → full previous calendar month (matches payroll months).
 * Quarter / year / custom → immediately preceding range of the same day count.
 */
export function priorPeriodForPatternComparison(
  dateFrom: string,
  dateTo: string,
  isSingleCalendarMonth: boolean,
): { dateFrom: string; dateTo: string } {
  if (isSingleCalendarMonth) {
    return previousCalendarMonth(dateFrom);
  }
  return priorDashboardPeriodRange(dateFrom, dateTo);
}

/** Immediately preceding range of the same length (for dashboard period-over-period pattern). */
export function priorDashboardPeriodRange(
  dateFrom: string,
  dateTo: string,
): { dateFrom: string; dateTo: string } {
  const startMs = Date.parse(`${dateFrom}T12:00:00Z`);
  const endMs = Date.parse(`${dateTo}T12:00:00Z`);
  const dayCount = Math.round((endMs - startMs) / 86400000) + 1;
  const priorEndMs = startMs - 86400000;
  const priorStartMs = priorEndMs - (dayCount - 1) * 86400000;
  const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { dateFrom: toIso(priorStartMs), dateTo: toIso(priorEndMs) };
}

export function dashboardPatternCompareLabel(
  period: Pick<ResolvedDashboardPeriod, "dateFrom" | "dateTo" | "isSingleCalendarMonth" | "preset">,
): string {
  const prior = priorPeriodForPatternComparison(
    period.dateFrom,
    period.dateTo,
    period.isSingleCalendarMonth,
  );
  if (period.isSingleCalendarMonth) {
    const y = Number.parseInt(prior.dateFrom.slice(0, 4), 10);
    const m = Number.parseInt(prior.dateFrom.slice(5, 7), 10);
    return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
  }
  return formatDisplayDateRange(prior.dateFrom, prior.dateTo);
}
