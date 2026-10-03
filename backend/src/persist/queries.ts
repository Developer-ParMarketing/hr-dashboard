import { query, queryOne, withTransaction } from "../db/index.js";
import { listHolidaysForMonth } from "../holidays/holidayAttendance.js";
import { loadNotificationStatusForMonth } from "../notify/service.js";
import {
  actorFrom,
  assertWeeklyNotFrozen,
  AttendanceLockedError,
  calculateDailyStatus,
  displayTokenFromDailyRow,
  isWeeklyFrozen,
  throwIfWeeklyLockViolation,
  cellStr,
  daysInMonth,
  isoDate,
  isPmPolicyCompany,
  LATE_GRACE_MINUTES,
  sanitizeLateFlag,
  sanitizeLateMinutes,
  markFromToken,
  parseClockToMinutes,
  parseHoursValue,
  deriveOutTime,
  tokenFromMark,
  weekBoundsContaining,
  type DailyEditPatch,
} from "./helpers.js";
import { stampApprovedWeek, syncEmployeeDate, syncEmployeeWeek, upsertDailyEdit } from "./sync.js";

type EmpRow = {
  id: number;
  employee_code: string;
  name: string;
  email: string | null;
  salary: number | null;
  company: string | null;
  status: string;
  department: string | null;
  shift_start: string | null;
  team_id: number | null;
  team_name: string | null;
  team_sort_order: number | null;
  team_manager_name: string | null;
};

function dedupeEmployeesById(emps: EmpRow[]): EmpRow[] {
  const byId = new Map<number, EmpRow>();
  for (const emp of emps) {
    if (!byId.has(emp.id)) byId.set(emp.id, emp);
  }
  return [...byId.values()];
}

const EMPLOYEE_WITH_TEAM = `
  SELECT e.*,
         t.name AS team_name,
         t.sort_order AS team_sort_order,
         mu.name AS team_manager_name
  FROM employees e
  LEFT JOIN teams t ON t.id = e.team_id
  LEFT JOIN users mu ON mu.id = t.manager_user_id
`;

type DailyRow = {
  id: number;
  employee_id: number;
  attendance_date: string;
  in_time: string | null;
  out_time: string | null;
  working_hours: number | null;
  late: number;
  late_minutes: number | null;
  source: string;
  status_token: string | null;
  daily_status: string | null;
  note: string | null;
  origin: string | null;
};

type WeeklyRow = {
  id: number;
  employee_id: number;
  week_start: string;
  week_end: string;
  total_hours: number | null;
  required_hours: number | null;
  deficit_hours: number | null;
  deduction: number | null;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  hr_deduction: number | null;
};

function dayNumber(attendanceDate: string): number {
  const iso = String(attendanceDate).slice(0, 10);
  return Number.parseInt(iso.slice(8, 10), 10);
}

async function history(
  entityType: string,
  entityId: number,
  action: string,
  actor: string,
  before: unknown,
  after: unknown,
  note?: string,
) {
  await query(
    `INSERT INTO change_history (entity_type, entity_id, action, actor, before_json, after_json, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entityType,
      entityId,
      action,
      actor,
      before == null ? null : JSON.stringify(before),
      after == null ? null : JSON.stringify(after),
      note ?? null,
    ],
  );
}

export async function listEmployees(company?: string) {
  if (company) {
    return query(`SELECT * FROM employees WHERE company = $1 ORDER BY employee_code`, [company]);
  }
  return query(`SELECT * FROM employees ORDER BY employee_code`);
}

export type SavedPeriodRow = {
  year: number;
  month: number;
  company: string | null;
  employee_count: number;
  last_updated: string;
  approved_weeks: number;
};

/** Distinct year/month/company combinations with saved daily attendance. */
export async function listSavedPeriods(limit = 60): Promise<SavedPeriodRow[]> {
  const capped = Math.min(Math.max(limit, 1), 200);
  return query<SavedPeriodRow>(
    `WITH periods AS (
       SELECT
         EXTRACT(YEAR FROM d.attendance_date)::int AS year,
         EXTRACT(MONTH FROM d.attendance_date)::int AS month,
         NULLIF(TRIM(e.company), '') AS company,
         COUNT(DISTINCT e.id)::int AS employee_count,
         MAX(GREATEST(d.updated_at, d.created_at)) AS last_updated
       FROM daily_attendance d
       INNER JOIN employees e ON e.id = d.employee_id
       GROUP BY 1, 2, 3
     )
     SELECT
       p.year,
       p.month,
       p.company,
       p.employee_count,
       p.last_updated,
       COALESCE((
         SELECT COUNT(DISTINCT w.week_start)::int
         FROM weekly_attendance w
         INNER JOIN employees e2 ON e2.id = w.employee_id
         WHERE EXTRACT(YEAR FROM w.week_start) = p.year
           AND EXTRACT(MONTH FROM w.week_start) = p.month
           AND (
             (p.company IS NULL AND (e2.company IS NULL OR TRIM(e2.company) = ''))
             OR e2.company = p.company
           )
           AND LOWER(TRIM(w.status)) IN ('approved', 'locked')
       ), 0) AS approved_weeks
     FROM periods p
     ORDER BY p.year DESC, p.month DESC, COALESCE(p.company, '') ASC
     LIMIT $1`,
    [capped],
  );
}

export type UploadHistoryRow = {
  id: number;
  request_id: string | null;
  file_name: string;
  file_size: number | null;
  report_type: string;
  report_year: number;
  report_month: number;
  company: string | null;
  actor: string | null;
  employee_count: number | null;
  daily_upserted: number | null;
  processed_at: string;
};

export type UploadHistoryRunRow = {
  id: number;
  requestId: string | null;
  actor: string | null;
  employeeCount: number | null;
  dailyUpserted: number | null;
  fileSize: number | null;
  reportDay: number | null;
  processedAt: string;
};

export type GroupedUploadHistoryRow = {
  id: number;
  file_name: string;
  file_size: number | null;
  report_type: string;
  report_year: number;
  report_month: number;
  company: string | null;
  report_day: number | null;
  last_processed_at: string;
  run_count: number;
  runs: UploadHistoryRunRow[] | string;
};

export async function recordUploadHistory(opts: {
  requestId?: string;
  fileName: string;
  fileSize?: number;
  reportType: "daily" | "weekly" | "monthly";
  reportYear: number;
  reportMonth: number;
  reportDay?: number | null;
  company?: string | null;
  actor?: string;
  employeeCount?: number;
  dailyUpserted?: number;
}) {
  await query(
    `INSERT INTO upload_history (
       request_id, file_name, file_size, report_type, report_year, report_month,
       report_day, company, actor, employee_count, daily_upserted
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      opts.requestId ?? null,
      opts.fileName || "register",
      opts.fileSize ?? null,
      opts.reportType,
      opts.reportYear,
      opts.reportMonth,
      opts.reportDay ?? null,
      opts.company?.trim() ? opts.company.trim() : null,
      opts.actor ?? null,
      opts.employeeCount ?? null,
      opts.dailyUpserted ?? null,
    ],
  );
}

export async function countRecentUploads(): Promise<number> {
  const row = await queryOne<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM (
       SELECT 1 FROM upload_history
       GROUP BY file_name, report_type, report_year, report_month, company
     ) grouped`,
  );
  return row?.total ?? 0;
}

function parseUploadHistoryRuns(raw: GroupedUploadHistoryRow["runs"]): UploadHistoryRunRow[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as UploadHistoryRunRow[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function listRecentUploads(
  limit = 20,
  offset = 0,
): Promise<{ rows: GroupedUploadHistoryRow[]; total: number }> {
  const capped = Math.min(Math.max(limit, 1), 100);
  const skip = Math.max(offset, 0);
  const [total, rows] = await Promise.all([
    countRecentUploads(),
    query<GroupedUploadHistoryRow>(
      `SELECT
         (array_agg(id ORDER BY processed_at DESC))[1] AS id,
         file_name,
         (array_agg(file_size ORDER BY processed_at DESC))[1] AS file_size,
         report_type,
         report_year,
         report_month,
         company,
         (array_agg(report_day ORDER BY processed_at DESC))[1] AS report_day,
         MAX(processed_at) AS last_processed_at,
         COUNT(*)::int AS run_count,
         json_agg(
           json_build_object(
             'id', id,
             'requestId', request_id,
             'actor', actor,
             'employeeCount', employee_count,
             'dailyUpserted', daily_upserted,
             'fileSize', file_size,
             'reportDay', report_day,
             'processedAt', processed_at
           )
           ORDER BY processed_at DESC
         ) AS runs
       FROM upload_history
       GROUP BY file_name, report_type, report_year, report_month, company
       ORDER BY last_processed_at DESC
       LIMIT $1 OFFSET $2`,
      [capped, skip],
    ),
  ]);
  return {
    rows: rows.map((row) => ({
      ...row,
      runs: parseUploadHistoryRuns(row.runs),
    })),
    total,
  };
}

/** Scoped employees have saved rows for the upload's calendar month (and day for daily files). */
const BROWSE_UPLOAD_SCOPE_SQL = `
  EXISTS (
    SELECT 1 FROM daily_attendance d
    WHERE d.employee_id = ANY($1::int[])
      AND EXTRACT(YEAR FROM d.attendance_date)::int = uh.report_year
      AND EXTRACT(MONTH FROM d.attendance_date)::int = uh.report_month
      AND (
        uh.report_type <> 'daily'
        OR uh.report_day IS NULL
        OR EXTRACT(DAY FROM d.attendance_date)::int = uh.report_day
      )
  )
`;

/** Distinct attendance periods visible to scoped employees (by processed register type, not file names). */
export async function listBrowsePeriodsForScope(
  reportType: "daily" | "weekly" | "monthly",
  restrictToEmployeeIds: number[],
  limit = 90,
): Promise<{
  periods: Array<
    | { kind: "daily"; date: string; lastUpdated: string }
    | { kind: "weekly"; weekStart: string; weekEnd: string; lastUpdated: string }
    | { kind: "monthly"; year: number; month: number; lastUpdated: string }
  >;
  total: number;
}> {
  if (restrictToEmployeeIds.length === 0) {
    return { periods: [], total: 0 };
  }
  const capped = Math.min(Math.max(limit, 1), 120);

  if (reportType === "daily") {
    const rows = await query<{ report_year: number; report_month: number; report_day: number; last_updated: Date }>(
      `SELECT uh.report_year,
              uh.report_month,
              uh.report_day,
              MAX(uh.processed_at) AS last_updated
       FROM upload_history uh
       WHERE uh.report_type = 'daily'
         AND uh.report_day IS NOT NULL
         AND ${BROWSE_UPLOAD_SCOPE_SQL}
       GROUP BY uh.report_year, uh.report_month, uh.report_day
       ORDER BY uh.report_year DESC, uh.report_month DESC, uh.report_day DESC
       LIMIT $2`,
      [restrictToEmployeeIds, capped],
    );
    const periods = rows.map((row) => ({
      kind: "daily" as const,
      date: isoDate(row.report_year, row.report_month, row.report_day),
      lastUpdated: new Date(row.last_updated).toISOString(),
    }));
    return { periods, total: periods.length };
  }

  if (reportType === "weekly") {
    const rows = await query<{
      report_year: number;
      report_month: number;
      report_day: number | null;
      last_updated: Date;
    }>(
      `SELECT uh.report_year,
              uh.report_month,
              uh.report_day,
              MAX(uh.processed_at) AS last_updated
       FROM upload_history uh
       WHERE uh.report_type = 'weekly'
         AND ${BROWSE_UPLOAD_SCOPE_SQL}
       GROUP BY uh.report_year, uh.report_month, uh.report_day
       ORDER BY uh.report_year DESC, uh.report_month DESC, uh.report_day DESC NULLS LAST
       LIMIT $2`,
      [restrictToEmployeeIds, capped],
    );
    const seen = new Set<string>();
    const periods: Array<{
      kind: "weekly";
      weekStart: string;
      weekEnd: string;
      lastUpdated: string;
    }> = [];
    for (const row of rows) {
      let weekStart: string;
      let weekEnd: string;
      if (row.report_day != null && row.report_day >= 1 && row.report_day <= 31) {
        const bounds = weekBoundsContaining(isoDate(row.report_year, row.report_month, row.report_day));
        weekStart = bounds.weekStart;
        weekEnd = bounds.weekEnd;
      } else {
        continue;
      }
      const key = `${weekStart}:${weekEnd}`;
      if (seen.has(key)) continue;
      seen.add(key);
      periods.push({
        kind: "weekly",
        weekStart,
        weekEnd,
        lastUpdated: new Date(row.last_updated).toISOString(),
      });
    }
    return { periods, total: periods.length };
  }

  const rows = await query<{ report_year: number; report_month: number; last_updated: Date }>(
    `SELECT uh.report_year,
            uh.report_month,
            MAX(uh.processed_at) AS last_updated
     FROM upload_history uh
     WHERE uh.report_type = 'monthly'
       AND ${BROWSE_UPLOAD_SCOPE_SQL}
     GROUP BY uh.report_year, uh.report_month
     ORDER BY uh.report_year DESC, uh.report_month DESC
     LIMIT $2`,
    [restrictToEmployeeIds, capped],
  );
  const periods = rows.map((row) => ({
    kind: "monthly" as const,
    year: row.report_year,
    month: row.report_month,
    lastUpdated: new Date(row.last_updated).toISOString(),
  }));
  return { periods, total: periods.length };
}

export async function loadMonthSnapshot(
  year: number,
  month: number,
  company?: string,
  restrictToEmployeeIds?: number[],
) {
  const dim = daysInMonth(year, month);
  const from = isoDate(year, month, 1);
  const to = isoDate(year, month, dim);
  const monthKey = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;

  let emps: EmpRow[];
  if (restrictToEmployeeIds !== undefined) {
    if (restrictToEmployeeIds.length === 0) {
      return {
        year,
        month,
        employees: [],
        daily: [],
        weekly: [],
        leave: [],
        wfh: [],
        salary: [],
        notifications: [],
        holidays: [],
      };
    }
    emps = company
      ? await query<EmpRow>(
          `${EMPLOYEE_WITH_TEAM}
           WHERE e.id = ANY($1::int[])
             AND (e.company = $2 OR e.company IS NULL OR e.company = '')
           ORDER BY e.employee_code`,
          [restrictToEmployeeIds, company],
        )
      : await query<EmpRow>(
          `${EMPLOYEE_WITH_TEAM}
           WHERE e.id = ANY($1::int[])
           ORDER BY e.employee_code`,
          [restrictToEmployeeIds],
        );
  } else if (company) {
    emps = await query<EmpRow>(
        `${EMPLOYEE_WITH_TEAM}
         WHERE e.id IN (
           SELECT DISTINCT d.employee_id
           FROM daily_attendance d
           WHERE d.attendance_date BETWEEN $1 AND $2
         )
           AND e.company = $3
         ORDER BY e.employee_code`,
        [from, to, company],
      );
  } else {
    emps = await query<EmpRow>(
        `${EMPLOYEE_WITH_TEAM}
         WHERE e.id IN (
           SELECT DISTINCT d.employee_id
           FROM daily_attendance d
           WHERE d.attendance_date BETWEEN $1 AND $2
         )
         ORDER BY e.employee_code`,
        [from, to],
      );
  }

  emps = dedupeEmployeesById(emps);

  if (restrictToEmployeeIds !== undefined) {
    const allowed = new Set(restrictToEmployeeIds);
    emps = emps.filter((e) => allowed.has(e.id));
  }

  const allowedEmployeeIds = new Set(emps.map((e) => e.id));
  const dailyByEmp = new Map<number, DailyRow[]>();
  const dailyRows = await query<
    DailyRow & {
      raw_working_hours: number | null;
      raw_status_token: string | null;
      raw_in_time: string | null;
    }
  >(
    `SELECT d.*, r.working_hours AS raw_working_hours, r.status_token AS raw_status_token,
            r.in_time AS raw_in_time
     FROM daily_attendance d
     LEFT JOIN daily_attendance_raw r
       ON r.employee_id = d.employee_id AND r.attendance_date = d.attendance_date
     WHERE d.attendance_date BETWEEN $1 AND $2
     ORDER BY d.attendance_date`,
    [from, to],
  );
  for (const row of dailyRows) {
    if (!allowedEmployeeIds.has(row.employee_id)) continue
    const list = dailyByEmp.get(row.employee_id) ?? [];
    list.push(row);
    dailyByEmp.set(row.employee_id, list);
  }

  const weeklyRows = await query<WeeklyRow>(
    `SELECT * FROM weekly_attendance WHERE week_start BETWEEN $1 AND $2 ORDER BY week_start`,
    [from, to],
  );
  const leaveRows = await query(`SELECT * FROM leave_records WHERE date BETWEEN $1 AND $2 ORDER BY date`, [
    from,
    to,
  ]);
  const wfhRows = await query(`SELECT * FROM wfh_records WHERE date BETWEEN $1 AND $2 ORDER BY date`, [
    from,
    to,
  ]);
  const salaryRows = await query(`SELECT * FROM salary_records WHERE month = $1`, [monthKey]);
  const empById = new Map(emps.map((e) => [e.id, e]));
  const daily = dailyRows
    .filter((row) => empById.has(row.employee_id))
    .map((row) => {
      const emp = empById.get(row.employee_id)!;
      const inTime = row.in_time ?? "";
      const workingHours = row.working_hours;
      const outTime = deriveOutTime(inTime, row.out_time ?? "", workingHours);
      return {
        id: row.id,
        employeeId: emp.id,
        employeeCode: emp.employee_code,
        employeeName: emp.name,
        shiftStart: emp.shift_start ?? "",
        attendanceDate: String(row.attendance_date).slice(0, 10),
        inTime: inTime || null,
        checkInTime: inTime || null,
        outTime: outTime || null,
        workingHours,
        late: Boolean(row.late),
        lateMinutes: row.late_minutes,
        dailyStatus: row.daily_status,
        statusToken: row.status_token,
        note: row.note,
        origin: row.origin ?? "calculated",
        rawWorkingHours: row.raw_working_hours,
        rawStatusToken: row.raw_status_token,
        rawInTime: row.raw_in_time,
      };
    })
    .sort((a, b) => {
      const code = a.employeeCode.localeCompare(b.employeeCode, undefined, { numeric: true });
      if (code !== 0) return code;
      return a.attendanceDate.localeCompare(b.attendanceDate);
    });

  const employees = emps.map((emp) => {
    const days: string[] = Array.from({ length: 31 }, () => "");
    const dayInTimes: string[] = Array.from({ length: 31 }, () => "");
    const dayLateFlags: boolean[] = Array.from({ length: 31 }, () => false);
    const dayWorkedHours: (number | null)[] = Array.from({ length: 31 }, () => null);
    const dayWfhUnverified: boolean[] = Array.from({ length: 31 }, () => false);
    const notes: Record<string, string> = {};
    for (const row of dailyByEmp.get(emp.id) ?? []) {
      const day = dayNumber(row.attendance_date);
      if (day < 1 || day > 31) continue;
      const i = day - 1;
      days[i] = displayTokenFromDailyRow(row);
      dayInTimes[i] = row.in_time ?? "";
      dayLateFlags[i] = Boolean(row.late);
      dayWorkedHours[i] = row.working_hours;
      if (row.note) notes[`${emp.employee_code}\u001f${emp.name}\u001f${day}`] = row.note;
    }
    return {
      id: emp.id,
      employeeCode: emp.employee_code,
      employeeName: emp.name,
      department: emp.department ?? "",
      teamId: emp.team_id,
      teamName: emp.team_name ?? "",
      teamSortOrder: emp.team_sort_order ?? 9999,
      teamManagerName: emp.team_manager_name ?? "",
      shiftStart: emp.shift_start ?? "",
      inTime: "",
      days,
      dayInTimes,
      dayLateFlags,
      dayWorkedHours,
      dayWfhUnverified,
      week1: null,
      week2: null,
      week3: null,
      week4: null,
      week5: null,
      week1Deficit: null,
      week2Deficit: null,
      week3Deficit: null,
      week4Deficit: null,
      week5Deficit: null,
      totalHours: null,
      deficitHours: null,
      notes,
    };
  });

  return {
    year,
    month,
    employees,
    daily,
    weekly: weeklyRows
      .filter((w) => allowedEmployeeIds.has(w.employee_id))
      .map((w) => {
      const emp = emps.find((e) => e.id === w.employee_id);
      const weekStart = String(w.week_start).slice(0, 10);
      const weekEnd = String(w.week_end).slice(0, 10);
      const frozen = isWeeklyFrozen(w.status);
      const edited = dailyRows.some((d) => {
        if (d.employee_id !== w.employee_id) return false;
        const dt = String(d.attendance_date).slice(0, 10);
        return dt >= weekStart && dt <= weekEnd && (d.origin === "hr_edit" || d.origin === "approved");
      });
      const layer = frozen ? "approved" : w.hr_deduction != null || edited ? "hr_edit" : "calculated";
      return {
        id: w.id,
        employeeId: w.employee_id,
        employeeCode: emp?.employee_code ?? "",
        employeeName: emp?.name ?? "",
        salary: emp?.salary ?? null,
        weekStart,
        weekEnd,
        totalHours: w.total_hours,
        requiredHours: w.required_hours,
        deficitHours: w.deficit_hours,
        deduction: w.deduction,
        status: w.status,
        approvedBy: w.approved_by,
        approvedAt: w.approved_at,
        layer,
        hrDeduction: w.hr_deduction,
      };
    }),
    leave: leaveRows.filter((row) => allowedEmployeeIds.has(row.employee_id)),
    wfh: wfhRows.filter((row) => allowedEmployeeIds.has(row.employee_id)),
    salary: salaryRows.filter((row) => allowedEmployeeIds.has(row.employee_id)),
    notifications: (await loadNotificationStatusForMonth(year, month, company)).filter((entry) =>
      allowedEmployeeIds.has(entry.employeeId),
    ),
    holidays: await listHolidaysForMonth(year, month),
  };
}

export async function patchDailyAttendance(
  id: number,
  patch: Record<string, unknown>,
  actorRaw: unknown,
) {
  const actor = actorFrom(actorRaw);
  const existing = await queryOne<DailyRow>(`SELECT * FROM daily_attendance WHERE id = $1`, [id]);
  if (!existing) return null;

  const emp = await queryOne<EmpRow>(`SELECT * FROM employees WHERE id = $1`, [existing.employee_id]);
  const dateIso = String(existing.attendance_date).slice(0, 10);
  await assertEmployeeDateEditable(existing.employee_id, dateIso);

  const editPatch: Record<string, unknown> = {};
  if (patch.in_time !== undefined) editPatch.in_time = cellStr(patch.in_time) || null;
  if (patch.out_time !== undefined) editPatch.out_time = cellStr(patch.out_time) || null;
  if (patch.status_token !== undefined) editPatch.status_token = cellStr(patch.status_token) || null;
  if (patch.note !== undefined) editPatch.note = cellStr(patch.note) || null;
  if (patch.working_hours !== undefined) {
    editPatch.working_hours =
      patch.working_hours == null || patch.working_hours === ""
        ? null
        : Number(patch.working_hours);
  }
  if (patch.late !== undefined) editPatch.late = sanitizeLateFlag(patch.late);
  if (patch.late_minutes !== undefined) {
    editPatch.late_minutes = sanitizeLateMinutes(patch.late_minutes);
  } else if (
    editPatch.in_time &&
    emp?.shift_start &&
    !("late" in editPatch) &&
    isPmPolicyCompany(emp.company)
  ) {
    const inMin = parseClockToMinutes(String(editPatch.in_time));
    const shiftMin = parseClockToMinutes(emp.shift_start);
    if (inMin != null && shiftMin != null) {
      if (inMin > shiftMin + LATE_GRACE_MINUTES) {
        editPatch.late = 1;
        editPatch.late_minutes = sanitizeLateMinutes(inMin - shiftMin);
      } else {
        editPatch.late = 0;
        editPatch.late_minutes = 0;
      }
    }
  }

  try {
    await withTransaction(async (client) => {
      await upsertDailyEdit(
        client,
        existing.employee_id,
        dateIso,
        editPatch as DailyEditPatch,
        actor,
      );
      await syncEmployeeDate(client, existing.employee_id, dateIso);
    });
  } catch (e) {
    throwIfWeeklyLockViolation(e);
  }
  const after = await queryOne(`SELECT * FROM daily_attendance WHERE id = $1`, [id]);
  await history("daily_attendance", id, "update", actor, existing, after, "hr edit overlay");
  return after;
}

export type WeeklyStatus =
  | "draft"
  | "pending"
  | "approved"
  | "locked"
  | "rejected";

async function assertEmployeeDateEditable(employeeId: number, dateIso: string) {
  const week = await queryOne<{ status: string }>(
    `SELECT status FROM weekly_attendance
     WHERE employee_id = $1 AND $2::date BETWEEN week_start AND week_end
     ORDER BY id DESC LIMIT 1`,
    [employeeId, dateIso],
  );
  assertWeeklyNotFrozen(week?.status);
}

export async function setWeeklyStatus(id: number, status: WeeklyStatus, actorRaw: unknown) {
  const actor = actorFrom(actorRaw);
  const existing = await queryOne<WeeklyRow>(`SELECT * FROM weekly_attendance WHERE id = $1`, [id]);
  if (!existing) return null;
  const next: WeeklyStatus = status === "locked" ? "approved" : status;
  if (isWeeklyFrozen(existing.status)) {
    if (isWeeklyFrozen(next)) return existing;
    throw new AttendanceLockedError();
  }
  const freeze = isWeeklyFrozen(next);
  const approvedBy = freeze ? actor : null;
  const weekStart = String(existing.week_start).slice(0, 10);
  const weekEnd = String(existing.week_end).slice(0, 10);
  try {
    await withTransaction(async (client) => {
      if (freeze) {
        await syncEmployeeWeek(client, {
          employeeId: existing.employee_id,
          weekStart,
          weekEnd,
        });
      }
      await client.query(
        `UPDATE weekly_attendance SET
           status = $1,
           approved_by = COALESCE($2, approved_by),
           approved_at = CASE
             WHEN $1 IN ('approved', 'locked') THEN COALESCE(approved_at, NOW())
             ELSE NULL
           END,
           updated_at = NOW()
         WHERE id = $3`,
        [next, approvedBy, id],
      );
      if (freeze) {
        await stampApprovedWeek(client, existing.employee_id, weekStart, weekEnd);
      }
    });
  } catch (e) {
    throwIfWeeklyLockViolation(e);
  }
  const after = await queryOne(`SELECT * FROM weekly_attendance WHERE id = $1`, [id]);
  await history("weekly_attendance", id, next, actor, existing, after, `weekly ${next}`);
  return after;
}

export type WeeklyDayEdit = {
  date: string;
  mark: string;
  hours: number | null | string;
};

export async function saveWeeklyEdit(
  id: number,
  body: {
    days?: WeeklyDayEdit[];
    deduction?: number | null;
    requiredHours?: number | null;
    actor?: unknown;
  },
) {
  const actor = actorFrom(body.actor);
  const existing = await queryOne<WeeklyRow>(`SELECT * FROM weekly_attendance WHERE id = $1`, [id]);
  if (!existing) return null;
  assertWeeklyNotFrozen(existing.status);
  const emp = await queryOne<EmpRow>(`SELECT * FROM employees WHERE id = $1`, [existing.employee_id]);
  if (!emp) return null;

  const weekStart = String(existing.week_start).slice(0, 10);
  const weekEnd = String(existing.week_end).slice(0, 10);
  const daysIn = Array.isArray(body.days) ? body.days : [];
  const hrDeduction =
    body.deduction !== undefined
      ? Number.isFinite(Number(body.deduction))
        ? Number(body.deduction)
        : null
      : undefined;
  const requiredHours =
    body.requiredHours != null && Number.isFinite(Number(body.requiredHours))
      ? Number(body.requiredHours)
      : undefined;

  try {
    await withTransaction(async (client) => {
      const locked = await client.query<WeeklyRow>(
        `SELECT * FROM weekly_attendance WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const current = locked.rows[0];
      if (!current) return;
      assertWeeklyNotFrozen(current.status);

      for (const raw of daysIn) {
        const date = cellStr(raw.date).slice(0, 10);
        if (!date || date < weekStart || date > weekEnd) continue;
        const hours = parseHoursValue(raw.hours);
        const mark = markFromToken(cellStr(raw.mark)) || (hours ? "P" : "AB");
        const token = tokenFromMark(mark, hours);
        const [yy, mm, dd] = date.split("-").map((v) => Number.parseInt(v, 10));
        const dailyStatus = calculateDailyStatus({
          token,
          late: false,
          inTime: "",
          year: Number.isFinite(yy) ? yy : 2000,
          month: Number.isFinite(mm) ? mm : 1,
          day: Number.isFinite(dd) ? dd : 1,
        });
        await upsertDailyEdit(
          client,
          emp.id,
          date,
          {
            status_token: token || null,
            working_hours: hours,
            daily_status: dailyStatus,
          },
          actor,
        );
      }

      const synced = await syncEmployeeWeek(client, {
        employeeId: emp.id,
        weekStart,
        weekEnd,
        requiredHours,
        hrDeduction,
      });
      if (synced.frozen) throw new AttendanceLockedError();
      await client.query(
        `INSERT INTO change_history (entity_type, entity_id, action, actor, before_json, after_json, note)
         VALUES ('weekly_attendance', $1, 'update', $2, $3, $4, 'weekly hr overlay')`,
        [
          id,
          actor,
          JSON.stringify(existing),
          JSON.stringify({ requiredHours, hrDeduction, days: daysIn.length }),
        ],
      );
    });
  } catch (e) {
    throwIfWeeklyLockViolation(e);
  }

  return queryOne(`SELECT * FROM weekly_attendance WHERE id = $1`, [id]);
}

export async function patchEmployee(id: number, patch: Record<string, unknown>, actorRaw: unknown) {
  const actor = actorFrom(actorRaw);
  const existing = await queryOne<EmpRow>(`SELECT * FROM employees WHERE id = $1`, [id]);
  if (!existing) return null;
  const name = patch.name !== undefined ? cellStr(patch.name) : existing.name;
  const email = patch.email !== undefined ? cellStr(patch.email) || null : existing.email;
  const company = patch.company !== undefined ? cellStr(patch.company) || null : existing.company;
  const status = patch.status !== undefined ? cellStr(patch.status) || existing.status : existing.status;
  const salary =
    patch.salary !== undefined
      ? patch.salary == null || patch.salary === ""
        ? null
        : Number(patch.salary)
      : existing.salary;
  await query(
    `UPDATE employees SET name = $1, email = $2, company = $3, status = $4, salary = $5, updated_at = NOW()
     WHERE id = $6`,
    [name, email, company, status, salary, id],
  );
  const after = await queryOne(`SELECT * FROM employees WHERE id = $1`, [id]);
  await history("employee", id, "update", actor, existing, after, "employee edit");
  return after;
}

export async function listHistory(opts: {
  entityType?: string;
  entityId?: number;
  limit?: number;
}) {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  if (opts.entityType && opts.entityId != null) {
    return query(
      `SELECT * FROM change_history WHERE entity_type = $1 AND entity_id = $2 ORDER BY id DESC LIMIT $3`,
      [opts.entityType, opts.entityId, limit],
    );
  }
  if (opts.entityType) {
    return query(`SELECT * FROM change_history WHERE entity_type = $1 ORDER BY id DESC LIMIT $2`, [
      opts.entityType,
      limit,
    ]);
  }
  return query(`SELECT * FROM change_history ORDER BY id DESC LIMIT $1`, [limit]);
}
