import { todayIsoInIndia } from "../portalPunch/windows.js";
import { formatDisplayDate } from "../displayDate.js";

export type CycleWindowKind = "goal_sheet_january" | "appraisal_doj_anniversary";

/** First production cycle; earlier DB rows stay hidden until history UI opens. */
export const CYCLE_ROLLOUT_YEAR = 2026;

/** Goal sheet: no employee edit during probation; one month to fill after probation ends. */
export const GOAL_SHEET_PROBATION_MONTHS = 3;
export const GOAL_SHEET_POST_PROBATION_FILL_MONTHS = 1;

/** Past cycles appear in the year selector from this date (IST). */
export const CYCLE_HISTORY_UI_OPENS_ISO = "2027-01-01";

export function cycleHistoryUiEnabled(at = new Date()): boolean {
  return todayIsoInIndia(at) >= CYCLE_HISTORY_UI_OPENS_ISO;
}

export function filterHistoryCycleYears(
  activeCycleYear: number,
  dbYears: number[],
  at = new Date(),
): number[] {
  if (!cycleHistoryUiEnabled(at)) return [];
  return dbYears.filter((y) => y < activeCycleYear && y >= CYCLE_ROLLOUT_YEAR);
}

export function coerceCycleYearForView(
  requestedYear: number,
  activeCycleYear: number,
  at = new Date(),
): number {
  if (!cycleHistoryUiEnabled(at) && requestedYear !== activeCycleYear) {
    return activeCycleYear;
  }
  if (requestedYear < CYCLE_ROLLOUT_YEAR) {
    return activeCycleYear;
  }
  return requestedYear;
}

function parseDoj(doj: string | null | undefined): { month: number; day: number } | null {
  if (!doj || !/^\d{4}-\d{2}-\d{2}/.test(doj)) return null;
  const month = Number.parseInt(doj.slice(5, 7), 10);
  const day = Number.parseInt(doj.slice(8, 10), 10);
  if (!Number.isFinite(month) || !Number.isFinite(day) || month < 1 || month > 12) return null;
  return { month, day };
}

function isoFromParts(year: number, month: number, day: number): string {
  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const d = Math.min(day, dim);
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** One calendar month before DOJ anniversary in `anniversaryYear` (same day-of-month when possible). */
export function appraisalWindowOpensIso(doj: string, anniversaryYear: number): string {
  const parts = parseDoj(doj);
  if (!parts) return isoFromParts(anniversaryYear, 1, 1);
  const annIso = isoFromParts(anniversaryYear, parts.month, parts.day);
  const [y, m, d] = annIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCMonth(dt.getUTCMonth() - 1);
  return dt.toISOString().slice(0, 10);
}

export function resolveGoalSheetActiveCycleYear(at = new Date()): number {
  const today = todayIsoInIndia(at);
  const calendarYear = Number.parseInt(today.slice(0, 4), 10);
  return Math.max(calendarYear, CYCLE_ROLLOUT_YEAR);
}

export function resolveAppraisalCycleYear(doj: string | null | undefined, at = new Date()): number {
  const parts = parseDoj(doj);
  const today = todayIsoInIndia(at);
  const todayYear = Number.parseInt(today.slice(0, 4), 10);
  if (!parts) return todayYear;

  const joinYear = Number.parseInt(doj!.slice(0, 4), 10);
  for (let y = todayYear + 1; y >= joinYear; y--) {
    const open = appraisalWindowOpensIso(doj!, y);
    const nextOpen = appraisalWindowOpensIso(doj!, y + 1);
    if (today >= open && today < nextOpen) return y;
  }
  return Math.max(joinYear, todayYear);
}

export function resolveActiveCycleYearForPolicy(input: {
  kind: CycleWindowKind;
  doj: string | null;
  at?: Date;
}): number {
  if (input.kind === "goal_sheet_january") {
    return resolveGoalSheetActiveCycleYear(input.at);
  }
  const resolved = resolveAppraisalCycleYear(input.doj ?? undefined, input.at);
  if (!cycleHistoryUiEnabled(input.at)) {
    return Math.max(resolved, CYCLE_ROLLOUT_YEAR);
  }
  return resolved;
}

export function daysUntilIso(targetIso: string, fromIso: string): number {
  const a = new Date(`${fromIso}T12:00:00Z`).getTime();
  const b = new Date(`${targetIso}T12:00:00Z`).getTime();
  return Math.max(0, Math.ceil((b - a) / 86_400_000));
}

function addMonthsToDojIso(doj: string, months: number): string {
  const parts = parseDoj(doj);
  if (!parts) return doj.slice(0, 10);
  const joinYear = Number.parseInt(doj.slice(0, 4), 10);
  const base = isoFromParts(joinYear, parts.month, parts.day);
  const [y, m, d] = base.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCMonth(dt.getUTCMonth() + months);
  return dt.toISOString().slice(0, 10);
}

export function goalSheetProbationEndsIso(doj: string): string {
  return addMonthsToDojIso(doj, GOAL_SHEET_PROBATION_MONTHS);
}

export function goalSheetPostProbationFillDeadlineIso(doj: string): string {
  return addMonthsToDojIso(
    doj,
    GOAL_SHEET_PROBATION_MONTHS + GOAL_SHEET_POST_PROBATION_FILL_MONTHS,
  );
}

export function goalSheetOnProbation(doj: string | null | undefined, at = new Date()): boolean {
  if (!doj) return false;
  const today = todayIsoInIndia(at);
  return today < goalSheetProbationEndsIso(doj);
}

export function goalSheetPostProbationFillWindowOpen(
  doj: string,
  cycleYear: number,
  at = new Date(),
): boolean {
  const today = todayIsoInIndia(at);
  const open = goalSheetProbationEndsIso(doj);
  const close = goalSheetPostProbationFillDeadlineIso(doj);
  if (today < open || today >= close) return false;
  return cycleYear === resolveGoalSheetActiveCycleYear(at);
}

function goalSheetCalendarWindowOpen(cycleYear: number, at = new Date()): boolean {
  const today = todayIsoInIndia(at);
  const y = Number.parseInt(today.slice(0, 4), 10);
  const m = Number.parseInt(today.slice(5, 7), 10);
  // Rollout year: editable throughout calendar 2026; later cycles: January only.
  if (cycleYear === CYCLE_ROLLOUT_YEAR && y === CYCLE_ROLLOUT_YEAR) return true;
  return y === cycleYear && m === 1;
}

export function goalSheetEmployeeWindowOpen(
  doj: string | null | undefined,
  cycleYear: number,
  at = new Date(),
): boolean {
  if (doj) {
    if (goalSheetOnProbation(doj, at)) return false;
    if (goalSheetPostProbationFillWindowOpen(doj, cycleYear, at)) return true;
  }
  return goalSheetCalendarWindowOpen(cycleYear, at);
}

export function goalSheetEmployeeEditNote(input: {
  doj: string | null;
  cycleYear: number;
  employeeSubmitted: boolean;
  at?: Date;
}): string | null {
  if (input.employeeSubmitted) return null;
  const at = input.at;
  const { doj, cycleYear } = input;
  if (!doj) {
    return "Date of joining is required on your employee record before you can fill your goal sheet.";
  }
  if (goalSheetOnProbation(doj, at)) {
    const opens = formatDisplayDate(goalSheetProbationEndsIso(doj));
    return `You are on probation (3 months from joining). Goal sheet editing opens on ${opens} for a one-month period.`;
  }
  const today = todayIsoInIndia(at);
  const fillDeadline = goalSheetPostProbationFillDeadlineIso(doj);
  const probationEnd = goalSheetProbationEndsIso(doj);
  if (
    today >= probationEnd &&
    today < fillDeadline &&
    cycleYear === resolveGoalSheetActiveCycleYear(at)
  ) {
    return `Complete and submit your goal sheet by ${formatDisplayDate(fillDeadline)} (one month after probation).`;
  }
  if (!goalSheetEmployeeWindowOpen(doj, cycleYear, at)) {
    if (today >= fillDeadline && !goalSheetCalendarWindowOpen(cycleYear, at)) {
      return `Your one-month goal sheet window after probation ended on ${formatDisplayDate(fillDeadline)}. Contact HR if you need access.`;
    }
    if (cycleYear === CYCLE_ROLLOUT_YEAR) {
      return "Goal sheet editing for this cycle is available through calendar 2026, except during probation.";
    }
    return "Goal sheet editing opens each January for that calendar year (after probation, new joiners have one month from probation end).";
  }
  return null;
}

export function daysUntilGoalSheetWindow(
  doj: string | null | undefined,
  cycleYear: number,
  at = new Date(),
): number | null {
  const today = todayIsoInIndia(at);
  if (doj && goalSheetOnProbation(doj, at)) {
    return daysUntilIso(goalSheetProbationEndsIso(doj), today);
  }
  if (doj && goalSheetPostProbationFillWindowOpen(doj, cycleYear, at)) {
    return daysUntilIso(goalSheetPostProbationFillDeadlineIso(doj), today);
  }
  const y = Number.parseInt(today.slice(0, 4), 10);
  const m = Number.parseInt(today.slice(5, 7), 10);
  if (cycleYear === CYCLE_ROLLOUT_YEAR && y === CYCLE_ROLLOUT_YEAR) return 0;
  if (y === cycleYear && m === 1) return 0;
  if (y < cycleYear || (y === cycleYear && m > 1)) return null;
  return daysUntilIso(isoFromParts(cycleYear, 1, 1), today);
}

export function appraisalEmployeeWindowOpen(
  doj: string | null | undefined,
  cycleYear: number,
  at = new Date(),
): boolean {
  const parts = parseDoj(doj);
  if (!parts) return false;
  const today = todayIsoInIndia(at);
  const calendarYear = Number.parseInt(today.slice(0, 4), 10);
  if (
    !cycleHistoryUiEnabled(at) &&
    cycleYear === CYCLE_ROLLOUT_YEAR &&
    calendarYear === CYCLE_ROLLOUT_YEAR
  ) {
    return true;
  }
  const open = appraisalWindowOpensIso(doj!, cycleYear);
  const nextOpen = appraisalWindowOpensIso(doj!, cycleYear + 1);
  return today >= open && today < nextOpen;
}

export function daysUntilAppraisalWindow(
  doj: string | null | undefined,
  at = new Date(),
  viewingCycleYear?: number,
): number | null {
  const parts = parseDoj(doj);
  if (!parts) return null;
  const today = todayIsoInIndia(at);
  const calendarYear = Number.parseInt(today.slice(0, 4), 10);
  if (
    viewingCycleYear === CYCLE_ROLLOUT_YEAR &&
    !cycleHistoryUiEnabled(at) &&
    calendarYear === CYCLE_ROLLOUT_YEAR
  ) {
    return 0;
  }
  const cycleYear = resolveActiveCycleYearForPolicy({
    kind: "appraisal_doj_anniversary",
    doj: doj ?? null,
    at,
  });
  const open = appraisalWindowOpensIso(doj!, cycleYear);
  if (today >= open) return 0;
  return daysUntilIso(open, today);
}

export function employeeWindowOpenForPolicy(input: {
  kind: CycleWindowKind;
  doj: string | null;
  cycleYear: number;
  at?: Date;
}): boolean {
  if (input.kind === "goal_sheet_january") {
    return goalSheetEmployeeWindowOpen(input.doj, input.cycleYear, input.at);
  }
  return appraisalEmployeeWindowOpen(input.doj, input.cycleYear, input.at);
}

export function daysUntilEmployeeWindowForPolicy(input: {
  kind: CycleWindowKind;
  doj: string | null;
  cycleYear: number;
  at?: Date;
}): number | null {
  if (input.kind === "goal_sheet_january") {
    return daysUntilGoalSheetWindow(input.doj, input.cycleYear, input.at);
  }
  return daysUntilAppraisalWindow(input.doj, input.at, input.cycleYear);
}

export function defaultCycleYearForPolicy(input: {
  kind: CycleWindowKind;
  doj: string | null;
  at?: Date;
}): number {
  return resolveActiveCycleYearForPolicy(input);
}
