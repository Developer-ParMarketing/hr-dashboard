import { query, withTransaction } from "../db/index.js";
import { syncEmployeeWeek } from "../persist/sync.js";
import { parseHolidayDayType } from "./holidayAttendance.js";
import type { HolidayDayType } from "./types.js";

export { parseHolidayDayType, loadHolidayTypeMapForDates, loadHolidayTypeMapForMonth, listHolidaysForMonth } from "./holidayAttendance.js";

/** Recalculate required/deficit on open weekly rows after holiday list changes. */
export async function resyncOpenWeeksForYear(year: number): Promise<number> {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const rows = await query<{ employee_id: number; week_start: string; week_end: string }>(
    `SELECT employee_id, week_start::text AS week_start, week_end::text AS week_end
     FROM weekly_attendance
     WHERE week_start <= $2::date
       AND week_end >= $1::date
       AND LOWER(TRIM(status)) NOT IN ('approved', 'locked')`,
    [from, to],
  );
  if (rows.length === 0) return 0;

  await withTransaction(async (client) => {
    for (const row of rows) {
      await syncEmployeeWeek(client, {
        employeeId: row.employee_id,
        weekStart: String(row.week_start).slice(0, 10),
        weekEnd: String(row.week_end).slice(0, 10),
      });
    }
  });
  return rows.length;
}

export type { HolidayDayType };
