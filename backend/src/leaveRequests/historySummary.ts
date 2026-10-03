import { countDaysInRangeForYear } from "./balance.js";
import type { LeaveType } from "./service.js";

export type LeaveUsageBreakdown = Record<LeaveType, number>;

export type LeaveHistoryRequestCounts = {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  cancelled: number;
};

export type LeaveHistoryMonthBucket = {
  month: number;
  label: string;
  requestCount: number;
  days: number;
  daysByType: LeaveUsageBreakdown;
  pendingDays: number;
};

export type LeaveHistorySummary = {
  year: number;
  requestCounts: LeaveHistoryRequestCounts;
  /** Calendar days in year across non-cancelled requests. */
  daysApplied: LeaveUsageBreakdown;
  /** Subset of daysApplied that are still pending approval. */
  pendingDaysByType: LeaveUsageBreakdown;
  pendingDays: number;
  monthly: LeaveHistoryMonthBucket[];
};

type HistoryRequest = {
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  createdAt: string;
};

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function emptyBreakdown(): LeaveUsageBreakdown {
  return { pl: 0, sl: 0, cl: 0 };
}

function monthFromIso(iso: string): number {
  return Number.parseInt(iso.slice(5, 7), 10);
}

/** Count calendar days of a request that fall in a given month of `year`. */
function daysInMonthForRequest(
  startDate: string,
  endDate: string,
  year: number,
  month: number,
): number {
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const from = startDate.slice(0, 10) < monthStart ? monthStart : startDate.slice(0, 10);
  const to = endDate.slice(0, 10) > monthEnd ? monthEnd : endDate.slice(0, 10);
  if (from > to) return 0;
  return countDaysInRangeForYear(from, to, year);
}

export function buildLeaveHistorySummary(
  requests: HistoryRequest[],
  year: number,
): LeaveHistorySummary {
  const requestCounts: LeaveHistoryRequestCounts = {
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    cancelled: 0,
  };
  const daysApplied = emptyBreakdown();
  const pendingDaysByType = emptyBreakdown();
  let pendingDays = 0;

  const monthly: LeaveHistoryMonthBucket[] = MONTH_LABELS.map((label, i) => ({
    month: i + 1,
    label,
    requestCount: 0,
    days: 0,
    daysByType: emptyBreakdown(),
    pendingDays: 0,
  }));

  for (const req of requests) {
    if (Number(req.startDate.slice(0, 4)) > year && Number(req.endDate.slice(0, 4)) < year) {
      continue;
    }
    if (req.startDate.slice(0, 10) > `${year}-12-31` || req.endDate.slice(0, 10) < `${year}-01-01`) {
      continue;
    }

    requestCounts.total += 1;
    requestCounts[req.status] += 1;

    if (req.status === "cancelled") continue;

    const daysInYear = countDaysInRangeForYear(req.startDate, req.endDate, year);
    if (daysInYear <= 0) continue;

    daysApplied[req.leaveType] += daysInYear;
    if (req.status === "pending") {
      pendingDaysByType[req.leaveType] += daysInYear;
      pendingDays += daysInYear;
    }

    const startMonth = monthFromIso(req.startDate);
    if (Number(req.startDate.slice(0, 4)) === year && startMonth >= 1 && startMonth <= 12) {
      monthly[startMonth - 1].requestCount += 1;
    }

    for (let m = 1; m <= 12; m += 1) {
      const d = daysInMonthForRequest(req.startDate, req.endDate, year, m);
      if (d <= 0) continue;
      const bucket = monthly[m - 1];
      bucket.days += d;
      bucket.daysByType[req.leaveType] += d;
      if (req.status === "pending") bucket.pendingDays += d;
    }
  }

  return {
    year,
    requestCounts,
    daysApplied,
    pendingDaysByType,
    pendingDays,
    monthly,
  };
}
