import type pg from "pg";
import { query } from "../db/index.js";
import { todayIsoInIndia } from "../portalPunch/windows.js";
import { isoDate, daysInMonth } from "../persist/helpers.js";
import type { LeaveType } from "./service.js";

/** Annual paid leave quota per calendar year (no carry to the next year). */
export const ANNUAL_LEAVE_ALLOWANCE: Record<LeaveType, number> = {
  pl: 12,
  sl: 6,
  cl: 6,
};

/** Credited each 1 January (Jan-Jun entitlement). */
export const FIRST_HALF_LEAVE_ALLOWANCE: Record<LeaveType, number> = {
  pl: 6,
  sl: 3,
  cl: 3,
};

/** Credited each 1 July (added to the Jul-Dec pool together with unused Jan-Jun). */
export const SECOND_HALF_LEAVE_ALLOWANCE: Record<LeaveType, number> = {
  pl: 6,
  sl: 3,
  cl: 3,
};

/** @deprecated alias */
export const HALF_YEAR_LEAVE_ALLOWANCE = FIRST_HALF_LEAVE_ALLOWANCE;

export type LeaveUsage = Record<LeaveType, number>;

export type LeaveBalanceSnapshot = {
  allowance: Record<LeaveType, number>;
  used: LeaveUsage;
  remaining: LeaveUsage;
};

function emptyUsage(): LeaveUsage {
  return { pl: 0, sl: 0, cl: 0 };
}

export function calendarHalfForDate(dateIso: string): 1 | 2 {
  const month = Number(dateIso.slice(5, 7));
  return month <= 6 ? 1 : 2;
}

export function* enumerateInclusiveDates(startDate: string, endDate: string): Generator<string> {
  const start = startDate.slice(0, 10);
  const end = endDate.slice(0, 10);
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  let d = Number(start.slice(8, 10));
  const endY = Number(end.slice(0, 4));
  const endM = Number(end.slice(5, 7));
  const endD = Number(end.slice(8, 10));

  while (y < endY || (y === endY && m < endM) || (y === endY && m === endM && d <= endD)) {
    yield isoDate(y, m, d);
    d += 1;
    const dim = daysInMonth(y, m);
    if (d > dim) {
      d = 1;
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  }
}

export function countDaysInRange(startDate: string, endDate: string): number {
  let n = 0;
  for (const _ of enumerateInclusiveDates(startDate, endDate)) n += 1;
  return n;
}

export function countDaysInRangeForYear(
  startDate: string,
  endDate: string,
  year: number,
): number {
  const yearStart = isoDate(year, 1, 1);
  const yearEnd = isoDate(year, 12, 31);
  const from = startDate.slice(0, 10) < yearStart ? yearStart : startDate.slice(0, 10);
  const to = endDate.slice(0, 10) > yearEnd ? yearEnd : endDate.slice(0, 10);
  if (from > to) return 0;
  return countDaysInRange(from, to);
}

function addUsageForRequest(
  usage: LeaveUsage,
  halfUsage: { h1: LeaveUsage; h2: LeaveUsage },
  leaveType: LeaveType,
  startDate: string,
  endDate: string,
  year: number,
) {
  for (const day of enumerateInclusiveDates(startDate, endDate)) {
    if (Number(day.slice(0, 4)) !== year) continue;
    usage[leaveType] += 1;
    if (calendarHalfForDate(day) === 1) {
      halfUsage.h1[leaveType] += 1;
    } else {
      halfUsage.h2[leaveType] += 1;
    }
  }
}

export function buildBalanceSnapshot(used: LeaveUsage): LeaveBalanceSnapshot {
  const remaining: LeaveUsage = {
    pl: Math.max(0, ANNUAL_LEAVE_ALLOWANCE.pl - used.pl),
    sl: Math.max(0, ANNUAL_LEAVE_ALLOWANCE.sl - used.sl),
    cl: Math.max(0, ANNUAL_LEAVE_ALLOWANCE.cl - used.cl),
  };
  return {
    allowance: { ...ANNUAL_LEAVE_ALLOWANCE },
    used: { ...used },
    remaining,
  };
}

function halfRemainingFromUsed(halfUsed: LeaveUsage): LeaveUsage {
  return {
    pl: Math.max(0, FIRST_HALF_LEAVE_ALLOWANCE.pl - halfUsed.pl),
    sl: Math.max(0, FIRST_HALF_LEAVE_ALLOWANCE.sl - halfUsed.sl),
    cl: Math.max(0, FIRST_HALF_LEAVE_ALLOWANCE.cl - halfUsed.cl),
  };
}

export function isSecondHalfCreditedForYear(year: number, now = new Date()): boolean {
  const today = todayIsoInIndia(now);
  const todayYear = Number(today.slice(0, 4));
  if (todayYear > year) return true;
  if (todayYear < year) return false;
  return Number(today.slice(5, 7)) >= 7;
}

function julDecPoolRemaining(usedH1: LeaveUsage, usedH2: LeaveUsage): LeaveUsage {
  return {
    pl: Math.max(0, ANNUAL_LEAVE_ALLOWANCE.pl - usedH1.pl - usedH2.pl),
    sl: Math.max(0, ANNUAL_LEAVE_ALLOWANCE.sl - usedH1.sl - usedH2.sl),
    cl: Math.max(0, ANNUAL_LEAVE_ALLOWANCE.cl - usedH1.cl - usedH2.cl),
  };
}

export type LeaveBalancePayload = {
  year: number;
  allowance: Record<LeaveType, number>;
  /** Jan-Jun credit (6 / 3 / 3). */
  halfAllowance: Record<LeaveType, number>;
  /** Days from approved requests (deducted from balance). */
  used: LeaveUsage;
  /** Days from pending requests (not deducted until approved). */
  requested: LeaveUsage;
  remaining: LeaveUsage;
  halfUsed: { janJun: LeaveUsage; julDec: LeaveUsage };
  halfRequested: { janJun: LeaveUsage; julDec: LeaveUsage };
  /** Unused Jan-Jun entitlement (can be used in Jul-Dec, same year). */
  carryToSecondHalf: LeaveUsage;
  /** Still bookable for leave dates in Jan-Jun. */
  janJunRemaining: LeaveUsage;
  /** Bookable for Jul-Dec dates (includes carry); null before 1 July. */
  julDecPoolRemaining: LeaveUsage | null;
  secondHalfCredited: boolean;
};

async function loadLeaveUsageForEmployeeByStatus(
  employeeId: number,
  year: number,
  status: "approved" | "pending",
): Promise<{ annual: LeaveUsage; half: { h1: LeaveUsage; h2: LeaveUsage } }> {
  const yearStart = isoDate(year, 1, 1);
  const yearEnd = isoDate(year, 12, 31);
  const rows = await query<ApprovedLeaveRow>(
    `SELECT leave_type, start_date::text AS start_date, end_date::text AS end_date
     FROM leave_requests
     WHERE employee_id = $1
       AND status = $2
       AND start_date <= $4::date
       AND end_date >= $3::date`,
    [employeeId, status, yearStart, yearEnd],
  );

  const annual = emptyUsage();
  const half = { h1: emptyUsage(), h2: emptyUsage() };
  for (const row of rows) {
    const type = row.leave_type;
    if (type !== "pl" && type !== "sl" && type !== "cl") continue;
    addUsageForRequest(annual, half, type, row.start_date, row.end_date, year);
  }
  return { annual, half };
}

export async function loadLeaveBalancePayload(
  employeeId: number,
  year: number,
): Promise<LeaveBalancePayload> {
  const [{ annual, half }, pending] = await Promise.all([
    loadLeaveUsageForEmployeeByStatus(employeeId, year, "approved"),
    loadLeaveUsageForEmployeeByStatus(employeeId, year, "pending"),
  ]);
  const snapshot = buildBalanceSnapshot(annual);
  const janJunRemaining = halfRemainingFromUsed(half.h1);
  const carryToSecondHalf = { ...janJunRemaining };
  const secondHalfCredited = isSecondHalfCreditedForYear(year);
  return {
    year,
    allowance: { ...ANNUAL_LEAVE_ALLOWANCE },
    halfAllowance: { ...FIRST_HALF_LEAVE_ALLOWANCE },
    used: snapshot.used,
    requested: pending.annual,
    remaining: snapshot.remaining,
    halfUsed: { janJun: { ...half.h1 }, julDec: { ...half.h2 } },
    halfRequested: { janJun: { ...pending.half.h1 }, julDec: { ...pending.half.h2 } },
    carryToSecondHalf,
    janJunRemaining,
    julDecPoolRemaining: secondHalfCredited ? julDecPoolRemaining(half.h1, half.h2) : null,
    secondHalfCredited,
  };
}

type ApprovedLeaveRow = {
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
};

export async function loadApprovedLeaveUsageForEmployee(
  employeeId: number,
  year: number,
): Promise<{ annual: LeaveUsage; half: { h1: LeaveUsage; h2: LeaveUsage } }> {
  return loadLeaveUsageForEmployeeByStatus(employeeId, year, "approved");
}

export async function loadApprovedLeaveUsageForEmployees(
  employeeIds: number[],
  year: number,
): Promise<Map<number, LeaveUsage>> {
  const map = new Map<number, LeaveUsage>();
  if (employeeIds.length === 0) return map;
  for (const id of employeeIds) {
    map.set(id, emptyUsage());
  }

  const yearStart = isoDate(year, 1, 1);
  const yearEnd = isoDate(year, 12, 31);
  const rows = await query<{ employee_id: number; leave_type: LeaveType; start_date: string; end_date: string }>(
    `SELECT employee_id, leave_type, start_date::text AS start_date, end_date::text AS end_date
     FROM leave_requests
     WHERE employee_id = ANY($1::int[])
       AND status = 'approved'
       AND start_date <= $3::date
       AND end_date >= $2::date`,
    [employeeIds, yearStart, yearEnd],
  );

  const halfScratch = { h1: emptyUsage(), h2: emptyUsage() };
  for (const row of rows) {
    const usage = map.get(row.employee_id) ?? emptyUsage();
    map.set(row.employee_id, usage);
    halfScratch.h1 = emptyUsage();
    halfScratch.h2 = emptyUsage();
    addUsageForRequest(usage, halfScratch, row.leave_type, row.start_date, row.end_date, year);
  }
  return map;
}

function countNewDaysByHalf(
  startDate: string,
  endDate: string,
  year: number,
): { annual: number; h1: number; h2: number } {
  let annual = 0;
  let h1 = 0;
  let h2 = 0;
  for (const day of enumerateInclusiveDates(startDate, endDate)) {
    if (Number(day.slice(0, 4)) !== year) continue;
    annual += 1;
    if (calendarHalfForDate(day) === 1) h1 += 1;
    else h2 += 1;
  }
  return { annual, h1, h2 };
}

export async function assertLeaveBalanceForApproval(input: {
  employeeId: number;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  asOf?: Date;
}): Promise<void> {
  const year = Number(input.startDate.slice(0, 4));
  const { annual: used, half } = await loadApprovedLeaveUsageForEmployee(input.employeeId, year);
  const incoming = countNewDaysByHalf(input.startDate, input.endDate, year);
  const type = input.leaveType;
  const asOf = input.asOf ?? new Date();

  const annualCap = ANNUAL_LEAVE_ALLOWANCE[type];
  const firstHalfCap = FIRST_HALF_LEAVE_ALLOWANCE[type];

  if (used[type] + incoming.annual > annualCap) {
    const remaining = Math.max(0, annualCap - used[type]);
    throw Object.assign(
      new Error(
        `Not enough ${type.toUpperCase()} balance for ${year} (${remaining} day(s) left of ${annualCap}; this request needs ${incoming.annual}).`,
      ),
      { status: 400 },
    );
  }

  if (incoming.h1 > 0 && half.h1[type] + incoming.h1 > firstHalfCap) {
    const remaining = Math.max(0, firstHalfCap - half.h1[type]);
    throw Object.assign(
      new Error(
        `Not enough ${type.toUpperCase()} for Jan-Jun ${year} (${remaining} day(s) left of ${firstHalfCap}; ${incoming.h1} day(s) fall in Jan-Jun).`,
      ),
      { status: 400 },
    );
  }

  if (incoming.h2 > 0) {
    if (!isSecondHalfCreditedForYear(year, asOf)) {
      throw Object.assign(
        new Error(
          `Jul-Dec leave for ${year} can only be booked from 1 July (6 ${type.toUpperCase()} credited then, plus any unused Jan-Jun).`,
        ),
        { status: 400 },
      );
    }
    const poolLeft = ANNUAL_LEAVE_ALLOWANCE[type] - half.h1[type] - half.h2[type];
    if (incoming.h2 > poolLeft) {
      throw Object.assign(
        new Error(
          `Not enough ${type.toUpperCase()} for Jul-Dec ${year} (${Math.max(0, poolLeft)} day(s left in the Jul-Dec pool including unused Jan-Jun; ${incoming.h2} requested in Jul-Dec).`,
        ),
        { status: 400 },
      );
    }
  }
}

export async function syncApprovedLeaveRequestDays(
  client: pg.PoolClient,
  input: { employeeId: number; leaveType: LeaveType; startDate: string; endDate: string },
): Promise<void> {
  const token = input.leaveType.trim().toUpperCase();
  for (const day of enumerateInclusiveDates(input.startDate, input.endDate)) {
    await client.query(
      `INSERT INTO leave_records (employee_id, date, leave_type, status, updated_at)
       VALUES ($1, $2::date, $3, 'approved', NOW())
       ON CONFLICT (employee_id, date) DO UPDATE SET
         leave_type = EXCLUDED.leave_type,
         status = 'approved',
         updated_at = NOW()`,
      [input.employeeId, day, token],
    );
  }
}
