/**
 * When Computex register rows are AB/empty (no leave/WFH Excel merge), apply approved
 * portal leave and in/out (WFH) requests onto daily attendance via daily_attendance_edits.
 */
import type pg from "pg";
import {
  cellStr,
  daysInMonth,
  isAbsentToken,
  isPaidLeaveToken,
  isPresentToken,
  isWeeklyFrozen,
  isWfhToken,
  isoDate,
  LATE_GRACE_MINUTES,
  parseClockToMinutes,
  tokenFromMark,
} from "./helpers.js";
import type { DailyEditPatch } from "./helpers.js";
import { upsertDailyEdit, syncEmployeeDate } from "./sync.js";

const PORTAL_ACTOR = "portal";

type RawRegisterRow = {
  status_token: string | null;
  in_time: string | null;
  out_time: string | null;
};

export function registerDayEligibleForPortalOverlay(raw: RawRegisterRow | null | undefined): boolean {
  if (!raw) return true;
  const token = cellStr(raw.status_token);
  if (!token && !cellStr(raw.in_time) && !cellStr(raw.out_time)) return true;
  if (isAbsentToken(token)) return true;
  return false;
}

async function weekFrozen(client: pg.PoolClient, employeeId: number, dateIso: string): Promise<boolean> {
  const week = await client.query<{ status: string }>(
    `SELECT status FROM weekly_attendance
     WHERE employee_id = $1 AND $2::date BETWEEN week_start AND week_end
     ORDER BY id DESC LIMIT 1`,
    [employeeId, dateIso],
  );
  return week.rows[0] ? isWeeklyFrozen(week.rows[0].status) : false;
}

async function loadRawRegister(
  client: pg.PoolClient,
  employeeId: number,
  dateIso: string,
): Promise<RawRegisterRow | null> {
  const row = await client.query<RawRegisterRow>(
    `SELECT status_token, in_time, out_time FROM daily_attendance_raw
     WHERE employee_id = $1 AND attendance_date = $2::date`,
    [employeeId, dateIso],
  );
  return row.rows[0] ?? null;
}

export async function applyPortalLeaveDayIfNeeded(
  client: pg.PoolClient,
  input: { employeeId: number; dateIso: string; leaveType: string; actor?: string },
): Promise<boolean> {
  const { employeeId, dateIso } = input;
  const token = cellStr(input.leaveType).toUpperCase();
  if (!isPaidLeaveToken(token)) return false;
  if (await weekFrozen(client, employeeId, dateIso)) return false;

  const raw = await loadRawRegister(client, employeeId, dateIso);
  if (!registerDayEligibleForPortalOverlay(raw)) return false;

  const actor = input.actor ?? PORTAL_ACTOR;
  await upsertDailyEdit(
    client,
    employeeId,
    dateIso,
    { status_token: token, note: "portal_leave" },
    actor,
  );
  await syncEmployeeDate(client, employeeId, dateIso);
  return true;
}

export async function applyPortalLeaveRange(
  client: pg.PoolClient,
  input: {
    employeeId: number;
    startDate: string;
    endDate: string;
    leaveType: string;
    actor?: string;
  },
): Promise<number> {
  const start = input.startDate.slice(0, 10);
  const end = input.endDate.slice(0, 10);
  const rows = await client.query<{ d: string }>(
    `SELECT d::text AS d FROM generate_series($1::date, $2::date, '1 day'::interval) AS d`,
    [start, end],
  );
  let applied = 0;
  for (const { d } of rows.rows) {
    const dateIso = d.slice(0, 10);
    if (await applyPortalLeaveDayIfNeeded(client, { ...input, dateIso })) applied += 1;
  }
  return applied;
}

export async function applyApprovedPortalPunchIfNeeded(
  client: pg.PoolClient,
  input: {
    employeeId: number;
    dateIso: string;
    inTime: string;
    outTime: string;
    shiftStart: string | null;
    actor?: string;
  },
): Promise<boolean> {
  const { employeeId, dateIso, inTime, outTime } = input;
  if (await weekFrozen(client, employeeId, dateIso)) return false;

  const leaveBlock = await client.query(
    `SELECT 1 FROM leave_records
     WHERE employee_id = $1 AND date = $2::date AND status = 'approved' LIMIT 1`,
    [employeeId, dateIso],
  );
  if (leaveBlock.rowCount) return false;

  const raw = await loadRawRegister(client, employeeId, dateIso);
  const rawToken = cellStr(raw?.status_token);
  const hasRegisterPunch =
    Boolean(cellStr(raw?.in_time)) &&
    !isAbsentToken(rawToken) &&
    (isPresentToken(rawToken) || isWfhToken(rawToken));
  if (hasRegisterPunch) return false;

  const inMin = parseClockToMinutes(inTime);
  const outMin = parseClockToMinutes(outTime);
  if (inMin == null || outMin == null || outMin < inMin) return false;

  const hours = Math.round(((outMin - inMin) / 60) * 100) / 100;
  const editPatch: DailyEditPatch = {
    in_time: inTime,
    out_time: outTime,
    working_hours: hours,
    note: "portal_wfh",
  };
  if (!raw || isAbsentToken(rawToken) || !rawToken) {
    editPatch.status_token = tokenFromMark("WFH", hours);
  }

  const shiftMin = parseClockToMinutes(input.shiftStart ?? "");
  if (shiftMin != null && inMin != null) {
    if (inMin > shiftMin + LATE_GRACE_MINUTES) {
      editPatch.late = 1;
      editPatch.late_minutes = inMin - shiftMin;
    } else {
      editPatch.late = 0;
      editPatch.late_minutes = 0;
    }
  }

  const actor = input.actor ?? PORTAL_ACTOR;
  await upsertDailyEdit(client, employeeId, dateIso, editPatch, actor);
  await syncEmployeeDate(client, employeeId, dateIso);
  return true;
}

/** Reconcile approved portal leave + punches for one employee in a calendar month. */
export async function reconcilePortalAttendanceForEmployeeMonth(
  client: pg.PoolClient,
  employeeId: number,
  year: number,
  month: number,
  actor?: string,
): Promise<{ leaveDays: number; punchDays: number }> {
  const dim = daysInMonth(year, month);
  const from = isoDate(year, month, 1);
  const to = isoDate(year, month, dim);
  const who = actor ?? PORTAL_ACTOR;

  const leaveRows = await client.query<{ date: string; leave_type: string }>(
    `SELECT date::text AS date, leave_type FROM leave_records
     WHERE employee_id = $1 AND date BETWEEN $2::date AND $3::date AND status = 'approved'`,
    [employeeId, from, to],
  );
  let leaveDays = 0;
  for (const row of leaveRows.rows) {
    const dateIso = String(row.date).slice(0, 10);
    if (
      await applyPortalLeaveDayIfNeeded(client, {
        employeeId,
        dateIso,
        leaveType: row.leave_type,
        actor: who,
      })
    ) {
      leaveDays += 1;
    }
  }

  const punchRows = await client.query<{
    attendance_date: string;
    in_time: string;
    out_time: string;
    shift_start_snapshot: string | null;
    shift_start: string | null;
  }>(
    `SELECT p.attendance_date::text AS attendance_date, p.in_time, p.out_time,
            p.shift_start_snapshot, e.shift_start
     FROM portal_punch_days p
     JOIN employees e ON e.id = p.employee_id
     WHERE p.employee_id = $1
       AND p.attendance_date BETWEEN $2::date AND $3::date
       AND p.in_status = 'approved' AND p.out_status = 'approved'
       AND p.in_time IS NOT NULL AND p.out_time IS NOT NULL`,
    [employeeId, from, to],
  );
  let punchDays = 0;
  for (const row of punchRows.rows) {
    const dateIso = String(row.attendance_date).slice(0, 10);
    if (
      await applyApprovedPortalPunchIfNeeded(client, {
        employeeId,
        dateIso,
        inTime: row.in_time,
        outTime: row.out_time,
        shiftStart: row.shift_start_snapshot ?? row.shift_start,
        actor: who,
      })
    ) {
      punchDays += 1;
    }
  }

  return { leaveDays, punchDays };
}
