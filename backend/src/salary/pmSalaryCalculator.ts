/**
 * PM salary sheet logic (columns A-P = upload, Q-AE = computed from attendance).
 * Mirrors "salary calculation PM.xlsx" formulas.
 */
import {
  cellStr,
  daysInMonth,
  isAbsentToken,
  isPaidLeaveToken,
  isPresentToken,
  isWeeklyOffToken,
  isWfhToken,
} from "../persist/helpers.js";

export type PmSalaryInput = {
  employeeCode: string;
  employeeName: string;
  inHand: number;
  pfEmployee: number;
  esiEmployee: number;
  pt: number;
  gratuity: number;
  employerPf: number;
  employerPfArr: number;
  employerEsi: number;
  otherEarning: number;
  increment: number;
};

export type PmAttendanceInput = {
  payDays: number;
  wfhDays: number;
  lateMarkCount: number;
};

export type PmSalaryBreakdown = {
  grossCtc: number;
  /** Calendar days in payroll month (EOMONTH equivalent). */
  calendarDays: number;
  /** Rounded for display/export only - never multiply this for gross pay or deductions. */
  perDay: number;
  payDays: number;
  grossPay: number;
  gratuity: number;
  pt: number;
  pfEmployee: number;
  pfEmployer: number;
  esicEmployer: number;
  esicEmployee: number;
  otherEarning: number;
  wfhDeduction: number;
  lateMarkDeduction: number;
  increment: number;
  netPay: number;
  wfhDays: number;
  lateMarkCount: number;
  lateDeductionDays: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Maharashtra-style PM PT: ₹200/month, ₹300 in February. */
export const PM_PT_STANDARD = 200;
export const PM_PT_FEBRUARY = 300;

export function pmProfessionalTaxForMonth(month: number): number {
  if (!Number.isFinite(month)) return PM_PT_STANDARD;
  return month === 2 ? PM_PT_FEBRUARY : PM_PT_STANDARD;
}

/** Prorate monthly CTC by calendar days; round once on the final amount (not on per-day rate). */
export function ctcProratedRupees(grossCtc: number, calendarDays: number, units: number): number {
  if (!Number.isFinite(grossCtc) || grossCtc <= 0 || units <= 0) return 0;
  const divisor = calendarDays > 0 ? calendarDays : 30;
  return round2((grossCtc / divisor) * units);
}

/** Treat "-", blank, and non-numeric as zero for statutory columns. */
export function parsePmAmount(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = cellStr(v).replace(/[,₹]/g, "");
  if (!s || s === "-") return 0;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Late marks → salary deduction days.
 * First 3 late marks in the month: no pay cut.
 * From the 4th late onward, the 3rd late and each later one costs 0.5 day pay
 * (e.g. 4 lates → 0.5 + 0.5 = 1.0 day; 5 lates → 1.5 days).
 */
export function lateMarkToDeductionDays(lateMarkCount: number): number {
  if (!Number.isFinite(lateMarkCount) || lateMarkCount <= 3) return 0;
  return (lateMarkCount - 2) * 0.5;
}

/** WFH deduction = 20% of prorated WFH-day salary from CTC (single final round). */
export function wfhDeductionRupees(
  wfhDays: number,
  grossCtc: number,
  calendarDays: number,
): number {
  const base = ctcProratedRupees(grossCtc, calendarDays, wfhDays);
  if (base <= 0) return 0;
  return round2(base * 0.2);
}

export function payDaysFromDailyTokens(
  rows: { status_token: string | null; late: number | null }[],
): { payDays: number; wfhDays: number; lateMarkCount: number } {
  let payDays = 0;
  let wfhDays = 0;
  let lateMarkCount = 0;

  for (const row of rows) {
    const token = cellStr(row.status_token).toUpperCase();
    if (!token) continue;

    if (isWfhToken(token)) wfhDays += 1;

    if (isWeeklyOffToken(token)) continue;

    if (
      isPresentToken(token) ||
      isWfhToken(token) ||
      isPaidLeaveToken(token)
    ) {
      payDays += 1;
    } else if (!isAbsentToken(token) && token !== "AB") {
      // Other paid codes (e.g. PL/CL/SL/DA variants) still count if not absent.
      payDays += 1;
    }

    if (row.late === 1 || (row.late != null && Number(row.late) > 0)) {
      lateMarkCount += 1;
    }
  }

  return { payDays, wfhDays, lateMarkCount };
}

export function calculatePmSalary(
  input: PmSalaryInput,
  attendance: PmAttendanceInput,
  year: number,
  month: number,
): PmSalaryBreakdown {
  const calendarDays = daysInMonth(year, month);
  const divisor = calendarDays > 0 ? calendarDays : 30;

  const pt = pmProfessionalTaxForMonth(month);
  const grossCtc = round2(input.inHand + pt);
  const perDay = round2(grossCtc / divisor);
  const payDays = attendance.payDays;
  const grossPay = ctcProratedRupees(grossCtc, divisor, payDays);

  const gratuity =
    input.gratuity > 0 ? round2((input.gratuity / 30) * payDays) : 0;
  const pfEmployee = input.pfEmployee;
  const pfEmployer = input.employerPf;
  const esicEmployer =
    input.employerEsi > 0 ? round2((input.employerEsi / 30) * payDays) : 0;
  const esicEmployee =
    input.esiEmployee > 0 ? round2((input.esiEmployee / 30) * payDays) : 0;

  const lateDeductionDays = lateMarkToDeductionDays(attendance.lateMarkCount);
  const wfhDed = wfhDeductionRupees(attendance.wfhDays, grossCtc, divisor);
  const lateDed = ctcProratedRupees(grossCtc, divisor, lateDeductionDays);

  const otherEarning = input.otherEarning;
  const increment = input.increment;

  const netPay = round2(
    grossPay -
      gratuity -
      pt -
      pfEmployee -
      pfEmployer -
      esicEmployer -
      esicEmployee +
      otherEarning -
      wfhDed -
      lateDed +
      increment,
  );

  return {
    grossCtc,
    calendarDays: divisor,
    perDay,
    payDays,
    grossPay,
    gratuity,
    pt,
    pfEmployee,
    pfEmployer,
    esicEmployer,
    esicEmployee,
    otherEarning,
    wfhDeduction: wfhDed,
    lateMarkDeduction: lateDed,
    increment,
    netPay: Math.max(0, netPay),
    wfhDays: attendance.wfhDays,
    lateMarkCount: attendance.lateMarkCount,
    lateDeductionDays,
  };
}
