import type pg from "pg";
import {
  calculateDailyStatus,
  deriveOutTime,
  eachIsoDateInclusive,
  hoursCountTowardWeek,
  isPaidLeaveToken,
  isPmPolicyCompany,
  isTimedAttendanceToken,
  isWeeklyFrozen,
  isWfhToken,
  LATE_GRACE_MINUTES,
  parseClockToMinutes,
  sanitizeLateFlag,
  sanitizeLateMinutes,
  requiredHoursForDays,
  weekBoundsContaining,
  weeklyDeductionRupees,
  type AttendanceOrigin,
  type DailyEditPatch,
} from "./helpers.js";
import { loadHolidayTypeMapForDates } from "../holidays/holidayAttendance.js";

type RawDay = {
  in_time: string | null;
  out_time: string | null;
  working_hours: number | null;
  late: number;
  late_minutes: number | null;
  source: string;
  status_token: string | null;
  daily_status: string | null;
  note: string | null;
};

function emptyDay(): RawDay {
  return {
    in_time: null,
    out_time: null,
    working_hours: null,
    late: 0,
    late_minutes: null,
    source: "pdf",
    status_token: null,
    daily_status: null,
    note: null,
  };
}

function applyPatch(raw: RawDay | null, patch: DailyEditPatch | null): RawDay {
  const next = { ...(raw ?? emptyDay()) };
  if (!patch) return next;
  if ("in_time" in patch) next.in_time = patch.in_time ?? null;
  if ("out_time" in patch) next.out_time = patch.out_time ?? null;
  if ("working_hours" in patch) {
    const n = patch.working_hours == null ? null : Number(patch.working_hours);
    next.working_hours = n != null && Number.isFinite(n) ? n : null;
  }
  if ("late" in patch) next.late = sanitizeLateFlag(patch.late);
  if ("late_minutes" in patch) next.late_minutes = sanitizeLateMinutes(patch.late_minutes);
  if ("status_token" in patch) next.status_token = patch.status_token ?? null;
  if ("note" in patch) next.note = patch.note ?? null;
  return next;
}

function finishCalculated(
  day: RawDay,
  shiftStart: string | null,
  dateIso: string,
  patch: DailyEditPatch | null,
  policyCompany: string | null | undefined,
): RawDay {
  const [yy, mm, dd] = dateIso.split("-").map((v) => Number.parseInt(v, 10));
  let late = sanitizeLateFlag(day.late);
  let lateMinutes = sanitizeLateMinutes(day.late_minutes);
  const token = day.status_token ?? "";
  const lateFromPatch = Boolean(patch && "late" in patch);
  if (
    !lateFromPatch &&
    isPmPolicyCompany(policyCompany) &&
    isTimedAttendanceToken(token) &&
    day.in_time &&
    shiftStart
  ) {
    const inMin = parseClockToMinutes(day.in_time);
    const shiftMin = parseClockToMinutes(shiftStart);
    if (inMin != null && shiftMin != null) {
      if (inMin > shiftMin + LATE_GRACE_MINUTES) {
        late = 1;
        lateMinutes = sanitizeLateMinutes(inMin - shiftMin);
      } else {
        late = 0;
        lateMinutes = 0;
      }
    }
  }
  late = sanitizeLateFlag(late);
  lateMinutes = sanitizeLateMinutes(lateMinutes);
  const dailyStatus = calculateDailyStatus({
    token,
    late: Boolean(late),
    inTime: day.in_time ?? "",
    year: Number.isFinite(yy) ? yy : 2000,
    month: Number.isFinite(mm) ? mm : 1,
    day: Number.isFinite(dd) ? dd : 1,
  });
  const outTime = deriveOutTime(day.in_time ?? "", day.out_time ?? "", day.working_hours) || day.out_time;
  return {
    ...day,
    late,
    late_minutes: lateMinutes,
    daily_status: dailyStatus,
    out_time: outTime || null,
  };
}

export async function upsertDailyEdit(
  client: pg.PoolClient,
  employeeId: number,
  dateIso: string,
  patch: DailyEditPatch,
  actor: string,
) {
  const existing = await client.query<{ patch: DailyEditPatch }>(
    `SELECT patch FROM daily_attendance_edits WHERE employee_id = $1 AND attendance_date = $2`,
    [employeeId, dateIso],
  );
  const merged: DailyEditPatch = { ...(existing.rows[0]?.patch ?? {}), ...patch };
  await client.query(
    `INSERT INTO daily_attendance_edits (employee_id, attendance_date, patch, actor, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, NOW())
     ON CONFLICT (employee_id, attendance_date) DO UPDATE SET
       patch = EXCLUDED.patch, actor = EXCLUDED.actor, updated_at = NOW()`,
    [employeeId, dateIso, JSON.stringify(merged), actor],
  );
}

async function syncLeaveWfh(
  client: pg.PoolClient,
  employeeId: number,
  dateIso: string,
  token: string,
  wfhStatus = "approved",
) {
  if (isPaidLeaveToken(token)) {
    await client.query(
      `INSERT INTO leave_records (employee_id, date, leave_type, status, updated_at)
       VALUES ($1, $2, $3, 'approved', NOW())
       ON CONFLICT (employee_id, date) DO UPDATE SET
         leave_type = EXCLUDED.leave_type, updated_at = NOW()`,
      [employeeId, dateIso, token.trim().toUpperCase()],
    );
    await client.query(`DELETE FROM wfh_records WHERE employee_id = $1 AND date = $2`, [employeeId, dateIso]);
    return;
  }
  if (isWfhToken(token)) {
    await client.query(
      `INSERT INTO wfh_records (employee_id, date, status, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (employee_id, date) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()`,
      [employeeId, dateIso, wfhStatus],
    );
    await client.query(`DELETE FROM leave_records WHERE employee_id = $1 AND date = $2`, [employeeId, dateIso]);
    return;
  }
  await client.query(`DELETE FROM leave_records WHERE employee_id = $1 AND date = $2`, [employeeId, dateIso]);
  await client.query(`DELETE FROM wfh_records WHERE employee_id = $1 AND date = $2`, [employeeId, dateIso]);
}

export async function syncEmployeeWeek(
  client: pg.PoolClient,
  opts: {
    employeeId: number;
    weekStart: string;
    weekEnd: string;
    requiredHours?: number | null;
    hrDeduction?: number | null;
  },
): Promise<{ weeklyId: number | null; frozen: boolean }> {
  const existing = await client.query<{
    id: number;
    status: string;
    required_hours: number | null;
    hr_deduction: number | null;
  }>(
    `SELECT id, status, required_hours, hr_deduction FROM weekly_attendance
     WHERE employee_id = $1 AND week_start = $2 FOR UPDATE`,
    [opts.employeeId, opts.weekStart],
  );
  const weekRow = existing.rows[0];
  if (weekRow && isWeeklyFrozen(weekRow.status)) {
    return { weeklyId: weekRow.id, frozen: true };
  }

  const emp = await client.query<{ salary: number | null; shift_start: string | null; company: string | null }>(
    `SELECT salary, shift_start, company FROM employees WHERE id = $1`,
    [opts.employeeId],
  );
  const salary = emp.rows[0]?.salary ?? null;
  const shiftStart = emp.rows[0]?.shift_start ?? null;
  const policyCompany = emp.rows[0]?.company ?? null;
  const pmPolicy = isPmPolicyCompany(policyCompany);

  const rawRows = await client.query<RawDay & { attendance_date: string }>(
    `SELECT attendance_date, in_time, out_time, working_hours, late, late_minutes,
            source, status_token, daily_status, note
     FROM daily_attendance_raw
     WHERE employee_id = $1 AND attendance_date BETWEEN $2 AND $3`,
    [opts.employeeId, opts.weekStart, opts.weekEnd],
  );
  const editRows = await client.query<{ attendance_date: string; patch: DailyEditPatch }>(
    `SELECT attendance_date, patch FROM daily_attendance_edits
     WHERE employee_id = $1 AND attendance_date BETWEEN $2 AND $3`,
    [opts.employeeId, opts.weekStart, opts.weekEnd],
  );
  const rawByDate = new Map(rawRows.rows.map((r) => [String(r.attendance_date).slice(0, 10), r]));
  const editByDate = new Map(editRows.rows.map((r) => [String(r.attendance_date).slice(0, 10), r.patch]));

  let total = 0;
  let any = false;

  for (const dateIso of eachIsoDateInclusive(opts.weekStart, opts.weekEnd)) {
    const raw = rawByDate.get(dateIso) ?? null;
    const patch = editByDate.get(dateIso) ?? null;
    if (!raw && !patch) continue;
    const merged = finishCalculated(applyPatch(raw, patch), shiftStart, dateIso, patch, policyCompany);
    const origin: AttendanceOrigin = patch ? "hr_edit" : "calculated";
    const daySource = patch ? "hr_edit" : raw?.source || "pdf";

    await client.query(
      `INSERT INTO daily_attendance (
         employee_id, attendance_date, in_time, out_time, working_hours, late, late_minutes,
         source, status_token, daily_status, note, origin, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
       ON CONFLICT (employee_id, attendance_date) DO UPDATE SET
         in_time = EXCLUDED.in_time,
         out_time = EXCLUDED.out_time,
         working_hours = EXCLUDED.working_hours,
         late = EXCLUDED.late,
         late_minutes = EXCLUDED.late_minutes,
         source = EXCLUDED.source,
         status_token = EXCLUDED.status_token,
         daily_status = EXCLUDED.daily_status,
         note = EXCLUDED.note,
         origin = EXCLUDED.origin,
         updated_at = NOW()`,
      [
        opts.employeeId,
        dateIso,
        merged.in_time,
        merged.out_time,
        merged.working_hours,
        merged.late,
        merged.late_minutes,
        daySource,
        merged.status_token,
        merged.daily_status,
        merged.note,
        origin,
      ],
    );
    await syncLeaveWfh(
      client,
      opts.employeeId,
      dateIso,
      merged.status_token ?? "",
      !patch && raw?.note === "wfh_unverified" ? "unverified" : "approved",
    );
    const add = hoursCountTowardWeek(merged.status_token ?? "", merged.working_hours);
    if (add > 0) {
      total += add;
      any = true;
    } else if (merged.status_token || merged.working_hours != null) {
      any = true;
    }
  }

  const year = Number.parseInt(opts.weekStart.slice(0, 4), 10);
  const month = Number.parseInt(opts.weekStart.slice(5, 7), 10);
  const dayNums = eachIsoDateInclusive(opts.weekStart, opts.weekEnd).map((iso) =>
    Number.parseInt(iso.slice(8, 10), 10),
  );
  const weekIsos = eachIsoDateInclusive(opts.weekStart, opts.weekEnd);
  const holidayMap = pmPolicy ? await loadHolidayTypeMapForDates(weekIsos) : new Map<string, "full" | "half">();
  const calendarRequired = pmPolicy
    ? requiredHoursForDays(year, month, dayNums, policyCompany, holidayMap)
    : null;
  const required =
    opts.requiredHours != null && Number.isFinite(Number(opts.requiredHours))
      ? Number(opts.requiredHours)
      : weekRow?.required_hours != null
        ? Number(weekRow.required_hours)
        : calendarRequired;
  const deficit =
    pmPolicy && required != null && any ? Math.max(0, required - total) : null;
  const totalHours = any ? total : null;
  const hrDeduction = opts.hrDeduction !== undefined ? opts.hrDeduction : (weekRow?.hr_deduction ?? null);
  const calcDeduction = weeklyDeductionRupees(salary, deficit, policyCompany);
  const deduction = hrDeduction != null && Number.isFinite(Number(hrDeduction)) ? Number(hrDeduction) : calcDeduction;

  if (weekRow) {
    await client.query(
      `UPDATE weekly_attendance SET
         week_end = $1, total_hours = $2, required_hours = $3, deficit_hours = $4,
         deduction = $5, hr_deduction = $6, updated_at = NOW()
       WHERE id = $7 AND LOWER(TRIM(status)) NOT IN ('approved', 'locked')`,
      [opts.weekEnd, totalHours, required, deficit, deduction, hrDeduction, weekRow.id],
    );
    return { weeklyId: weekRow.id, frozen: false };
  }

  if (!any) return { weeklyId: null, frozen: false };

  const inserted = await client.query<{ id: number }>(
    `INSERT INTO weekly_attendance (
       employee_id, week_start, week_end, total_hours, required_hours, deficit_hours,
       deduction, hr_deduction, status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft')
     RETURNING id`,
    [opts.employeeId, opts.weekStart, opts.weekEnd, totalHours, required, deficit, deduction, hrDeduction],
  );
  return { weeklyId: inserted.rows[0].id, frozen: false };
}

export async function syncEmployeeDate(client: pg.PoolClient, employeeId: number, dateIso: string) {
  const { weekStart, weekEnd } = weekBoundsContaining(dateIso);
  return syncEmployeeWeek(client, { employeeId, weekStart, weekEnd });
}

export async function stampApprovedWeek(
  client: pg.PoolClient,
  employeeId: number,
  weekStart: string,
  weekEnd: string,
) {
  const days = await client.query(
    `SELECT attendance_date, status_token, working_hours, origin, in_time, out_time, late, late_minutes
     FROM daily_attendance
     WHERE employee_id = $1 AND attendance_date BETWEEN $2 AND $3
     ORDER BY attendance_date`,
    [employeeId, weekStart, weekEnd],
  );
  const weekly = await client.query(
    `SELECT total_hours, required_hours, deficit_hours, deduction, hr_deduction
     FROM weekly_attendance WHERE employee_id = $1 AND week_start = $2`,
    [employeeId, weekStart],
  );
  await client.query(
    `UPDATE weekly_attendance SET approved_snapshot = $1::jsonb, updated_at = NOW()
     WHERE employee_id = $2 AND week_start = $3`,
    [JSON.stringify({ totals: weekly.rows[0] ?? null, days: days.rows }), employeeId, weekStart],
  );
  await client.query(
    `UPDATE daily_attendance SET origin = 'approved', updated_at = NOW()
     WHERE employee_id = $1 AND attendance_date BETWEEN $2 AND $3`,
    [employeeId, weekStart, weekEnd],
  );
}
