import type { AuthUser } from "../auth/users.js";
import { isExecutiveLeaveApprover } from "../leaveRequests/approvers.js";

/** HR, admin, Devanshi, and Jiya - same operators as offer letters / year-end reminders. */
export function canManageCompanyHolidays(user: AuthUser | undefined): boolean {
  if (!user) return false;
  return isExecutiveLeaveApprover(user);
}

export function currentHolidayCalendarYear(): number {
  return new Date().getFullYear();
}

export function holidayYearOptionsForEditors(): number[] {
  const now = currentHolidayCalendarYear();
  return [now - 1, now, now + 1, now + 2];
}

export function assertCanViewHolidayYear(user: AuthUser | undefined, year: number): void {
  if (canManageCompanyHolidays(user)) return;
  const current = currentHolidayCalendarYear();
  if (year !== current) {
    throw Object.assign(
      new Error(`The holiday list is available for ${current} only.`),
      { status: 403 },
    );
  }
}

export function assertCanManageCompanyHolidays(user: AuthUser | undefined): void {
  if (canManageCompanyHolidays(user)) return;
  throw Object.assign(
    new Error("Only HR can update the holiday list."),
    { status: 403 },
  );
}
