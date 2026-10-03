// Writes parsed ESSL rows into Postgres (daily + weekly). Called after pdf_to_json / merge.

import type pg from "pg";
import { withTransaction } from "../db/index.js";
import {
  calendarWeeksForMonth,
  calculateDailyStatus,
  cellStr,
  displayTokenFromDailyRow,
  daysInMonth,
  employeeCodeOf,
  employeeNameOf,
  extractWorkedHours,
  isoDate,
  isPaidLeaveToken,
  isPmPolicyCompany,
  isPresentToken,
  isTimedAttendanceToken,
  isTruthyLate,
  isWeeklyOffToken,
  isWfhToken,
  LATE_GRACE_MINUTES,
  markFromToken,
  normalizeStatusTokenForDisplay,
  parseClockToMinutes,
  sanitizeLateFlag,
  sanitizeLateMinutes,
  deriveOutTime,
  hoursCountTowardWeek,
  tokenFromMark,
  isWeeklyFrozen,
  requiredHoursForDays,
  type RawIngestEmployee,
} from "./helpers.js";
import { loadHolidayTypeMapForMonth } from "../holidays/holidayAttendance.js";
import { reconcilePortalAttendanceForEmployeeMonth } from "./portalAttendanceOverlay.js";
import { syncEmployeeWeek } from "./sync.js";

export type PersistSummary = {
  employeesUpserted: number;
  dailyUpserted: number;
  weeklyUpserted: number;
  leaveUpserted: number;
  wfhUpserted: number;
  salaryUpserted: number;
  skippedApprovedWeeks: number;
};

async function recordHistory(
  client: pg.PoolClient,
  entityType: string,
  entityId: number,
  action: string,
  actor: string,
  before: unknown,
  after: unknown,
  note?: string,
) {
  await client.query(
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

function dayField(raw: RawIngestEmployee, day: number, suffix: string): unknown {
  return raw[`day${day}${suffix}`];
}

function isMonthlyGridRow(raw: RawIngestEmployee): boolean {
  return Object.prototype.hasOwnProperty.call(raw, "day1");
}

function maxParsedDayInRow(raw: RawIngestEmployee, dim: number): number {
  let max = 0;
  for (let d = 1; d <= dim; d++) {
    if (!Object.prototype.hasOwnProperty.call(raw, `day${d}`)) continue;
    const token = cellStr(dayField(raw, d, ""));
    const inTime = cellStr(dayField(raw, d, "InTime"));
    const hoursRaw = dayField(raw, d, "Hours");
    if (token || inTime || (hoursRaw != null && cellStr(hoursRaw))) max = d;
  }
  return max;
}

export async function persistProcessedAttendance(opts: {
  employees: unknown[];
  year: number;
  month: number;
  company: string;
  source: string;
  actor: string;
  requestId?: string;
  reportType?: "daily" | "weekly" | "monthly";
  reportDay?: number | null;
}): Promise<PersistSummary> {
  const { year, month, actor } = opts;
  const company = cellStr(opts.company) || "PM";
  const source = cellStr(opts.source) || "pdf";
  const reportType = opts.reportType ?? "monthly";
  const reportDayCap =
    typeof opts.reportDay === "number" && opts.reportDay >= 1 && opts.reportDay <= 31
      ? opts.reportDay
      : null;
  const dim = daysInMonth(year, month);
  const weeks = calendarWeeksForMonth(year, month);
  const monthKey = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
  const monthlyGridIngest =
    reportType === "monthly" ||
    source === "pdf" ||
    opts.employees.some((row) => row && typeof row === "object" && isMonthlyGridRow(row as RawIngestEmployee));
  let batchMaxParsedDay = 0;
  if (monthlyGridIngest) {
    for (const row of opts.employees) {
      if (!row || typeof row !== "object") continue;
      batchMaxParsedDay = Math.max(batchMaxParsedDay, maxParsedDayInRow(row as RawIngestEmployee, dim));
    }
  }
  const gridFillCap = Math.max(reportDayCap ?? 0, batchMaxParsedDay) || dim;

  const summary: PersistSummary = {
    employeesUpserted: 0,
    dailyUpserted: 0,
    weeklyUpserted: 0,
    leaveUpserted: 0,
    wfhUpserted: 0,
    salaryUpserted: 0,
    skippedApprovedWeeks: 0,
  };

  return withTransaction(async (client) => {
    for (const row of opts.employees) {
      if (!row || typeof row !== "object") continue;
      const raw = row as RawIngestEmployee;
      const code = employeeCodeOf(raw);
      if (!code) continue;
      const name = employeeNameOf(raw);
      const department = cellStr(raw.department ?? raw.dept);
      const shiftStart = cellStr(raw.shiftStart);
      const rowInTime = cellStr(raw.inTime);

      const empRes = await client.query<{ id: number; salary: number | null; company: string | null }>(
        `INSERT INTO employees (employee_code, name, company, department, shift_start, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'active', NOW())
         ON CONFLICT (employee_code) DO UPDATE SET
           name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE employees.name END,
           company = CASE WHEN EXCLUDED.company <> '' THEN EXCLUDED.company ELSE employees.company END,
           department = CASE WHEN EXCLUDED.department <> '' THEN EXCLUDED.department ELSE employees.department END,
           shift_start = CASE WHEN EXCLUDED.shift_start <> '' THEN EXCLUDED.shift_start ELSE employees.shift_start END,
           updated_at = NOW()
         RETURNING id, salary, company`,
        [code, name, company, department, shiftStart],
      );
      const emp = empRes.rows[0];
      const pmPolicy = isPmPolicyCompany(emp.company);
      summary.employeesUpserted += 1;
      await recordHistory(
        client,
        "employee",
        emp.id,
        "ingest",
        actor,
        null,
        { code, name, company, department, shiftStart },
        opts.requestId ? `ingest ${opts.requestId}` : "ingest",
      );

      const approvedWeekStarts = new Set<string>();
      for (const days of weeks) {
        if (days.length === 0) continue;
        const weekStart = isoDate(year, month, days[0]);
        const existing = await client.query<{ status: string }>(
          `SELECT status FROM weekly_attendance WHERE employee_id = $1 AND week_start = $2`,
          [emp.id, weekStart],
        );
        if (isWeeklyFrozen(existing.rows[0]?.status)) approvedWeekStarts.add(weekStart);
      }

      let workingDays = 0;
      let monthWorked = 0;

      for (let d = 1; d <= dim; d++) {
        let token = cellStr(dayField(raw, d, ""));
        let inTime = cellStr(dayField(raw, d, "InTime"));
        if (!inTime && rowInTime && token) inTime = rowInTime;
        let outTime = cellStr(dayField(raw, d, "OutTime"));
        const hoursRaw = dayField(raw, d, "Hours");
        let workingHours: number | null = null;
        if (typeof hoursRaw === "number" && Number.isFinite(hoursRaw)) workingHours = hoursRaw;
        else if (cellStr(hoursRaw)) {
          const n = Number(cellStr(hoursRaw));
          if (Number.isFinite(n)) workingHours = n;
        }
        if (workingHours == null) workingHours = extractWorkedHours(token);
        if (!outTime) outTime = deriveOutTime(inTime, "", workingHours);
        const lateFlag = isTruthyLate(dayField(raw, d, "IsLate"));
        const dow = new Date(year, month - 1, d).getDay();
        let hasSignal = Boolean(token || inTime || outTime || workingHours != null);
        if (
          !hasSignal &&
          dow !== 0 &&
          monthlyGridIngest &&
          Object.prototype.hasOwnProperty.call(raw, `day${d}`)
        ) {
          if (d <= gridFillCap) {
            token = "AB";
            hasSignal = true;
          }
        }
        if (!hasSignal && dow !== 0) continue;

        const date = isoDate(year, month, d);
        const inMin = parseClockToMinutes(inTime);
        const shiftMin = parseClockToMinutes(shiftStart);
        let late: 0 | 1 = pmPolicy && lateFlag ? 1 : 0;
        let lateMinutes: number | null = null;
        const lateMinutesRaw = dayField(raw, d, "LateMinutes");
        if (lateMinutesRaw != null && cellStr(lateMinutesRaw)) {
          lateMinutes = sanitizeLateMinutes(lateMinutesRaw);
        }
        if (pmPolicy && isTimedAttendanceToken(token) && inMin != null && shiftMin != null) {
          if (inMin > shiftMin + LATE_GRACE_MINUTES) {
            late = 1;
            lateMinutes = sanitizeLateMinutes(inMin - shiftMin);
          } else if (lateMinutes == null) {
            late = 0;
            lateMinutes = 0;
          }
        }
        late = sanitizeLateFlag(late);
        if (lateMinutes != null) lateMinutes = sanitizeLateMinutes(lateMinutes);

        let daySource = source;
        if (isPaidLeaveToken(token)) daySource = "leave";
        else if (isWfhToken(token)) daySource = "wfh";
        else if (isWeeklyOffToken(token) || (!hasSignal && dow === 0)) daySource = "calendar";

        const dailyStatus = calculateDailyStatus({
          token,
          late: Boolean(late),
          inTime,
          year,
          month,
          day: d,
        });
        const wfhUnverified = isWfhToken(token) && isTruthyLate(dayField(raw, d, "WfhUnverified"));
        const rawNote = wfhUnverified ? "wfh_unverified" : null;

        let statusToken =
          token || displayTokenFromDailyRow({ status_token: token, daily_status: dailyStatus });
        if (dailyStatus === "wfh" && !isWfhToken(statusToken)) {
          statusToken = tokenFromMark("WFH", workingHours);
        } else if (dailyStatus === "weekly_off" && !isWeeklyOffToken(statusToken)) {
          statusToken = "WO";
        } else if (dailyStatus === "leave" && !isPaidLeaveToken(statusToken)) {
          statusToken = markFromToken(token) || token || "SL";
        } else if (statusToken) {
          statusToken = normalizeStatusTokenForDisplay(statusToken);
        }

        const prev = await client.query(
          `SELECT * FROM daily_attendance_raw WHERE employee_id = $1 AND attendance_date = $2`,
          [emp.id, date],
        );
        const after = await client.query<{ id: number }>(
          `INSERT INTO daily_attendance_raw (
             employee_id, attendance_date, in_time, out_time, working_hours, late, late_minutes,
             source, status_token, daily_status, note, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
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
             updated_at = NOW()
           RETURNING id`,
          [
            emp.id,
            date,
            inTime || null,
            outTime || null,
            workingHours,
            late,
            lateMinutes,
            daySource,
            statusToken,
            dailyStatus,
            rawNote,
          ],
        );
        summary.dailyUpserted += 1;
        await recordHistory(
          client,
          "daily_attendance_raw",
          after.rows[0].id,
          prev.rows[0] ? "update" : "create",
          actor,
          prev.rows[0] ?? null,
          { date, token, workingHours },
          "ingest",
        );
      }

      await reconcilePortalAttendanceForEmployeeMonth(client, emp.id, year, month, actor);

      for (const days of weeks) {
        if (days.length === 0) continue;
        const weekStart = isoDate(year, month, days[0]);
        const weekEnd = isoDate(year, month, days[days.length - 1]);
        if (approvedWeekStarts.has(weekStart)) {
          summary.skippedApprovedWeeks += 1;
          continue;
        }
        await syncEmployeeWeek(client, { employeeId: emp.id, weekStart, weekEnd });
        summary.weeklyUpserted += 1;
      }

      const effectiveMonth = await client.query<{
        status_token: string | null;
        working_hours: number | null;
      }>(
        `SELECT status_token, working_hours FROM daily_attendance
         WHERE employee_id = $1 AND attendance_date BETWEEN $2 AND $3`,
        [emp.id, isoDate(year, month, 1), isoDate(year, month, dim)],
      );
      for (const row of effectiveMonth.rows) {
        const token = row.status_token ?? "";
        const add = hoursCountTowardWeek(token, row.working_hours);
        monthWorked += add;
        if (token && (isPresentToken(token) || isWfhToken(token))) workingDays += 1;
      }

      const salaryExisting = await client.query<{
        id: number;
        status: string;
        gross_salary: number | null;
      }>(`SELECT id, status, gross_salary FROM salary_records WHERE employee_id = $1 AND month = $2`, [
        emp.id,
        monthKey,
      ]);
      const salaryRow = salaryExisting.rows[0];
      const monthRequired = pmPolicy
        ? requiredHoursForDays(
            year,
            month,
            Array.from({ length: dim }, (_, i) => i + 1),
            emp.company,
            await loadHolidayTypeMapForMonth(year, month),
          )
        : 0;
      const monthDeficit =
        pmPolicy && (workingDays > 0 || monthWorked > 0)
          ? Math.max(0, monthRequired - monthWorked)
          : null;
      if (salaryRow?.status === "approved") continue;
      if (salaryRow) {
        await client.query(
          `UPDATE salary_records SET
             working_days = $1::integer,
             attendance_adjustment = $2::numeric,
             deduction = $3::numeric,
             final_salary = CASE WHEN gross_salary IS NOT NULL THEN gross_salary - COALESCE($4::numeric, 0) ELSE final_salary END,
             updated_at = NOW()
           WHERE id = $5 AND status <> 'approved'`,
          [workingDays, monthDeficit, monthDeficit, monthDeficit, salaryRow.id],
        );
        summary.salaryUpserted += 1;
        await recordHistory(
          client,
          "salary",
          salaryRow.id,
          "update",
          actor,
          salaryRow,
          { month: monthKey, workingDays, deduction: monthDeficit },
          "ingest",
        );
      } else {
        const gross = emp.salary;
        const finalSal =
          gross != null && monthDeficit != null ? Math.max(0, gross - monthDeficit) : gross;
        const inserted = await client.query<{ id: number }>(
          `INSERT INTO salary_records (
             employee_id, month, gross_salary, working_days, attendance_adjustment, deduction, final_salary, status
           ) VALUES ($1, $2, $3::numeric, $4::integer, $5::numeric, $6::numeric, $7::numeric, 'draft')
           RETURNING id`,
          [emp.id, monthKey, gross, workingDays, monthDeficit, monthDeficit, finalSal],
        );
        summary.salaryUpserted += 1;
        await recordHistory(
          client,
          "salary",
          inserted.rows[0].id,
          "create",
          actor,
          null,
          { month: monthKey, workingDays, deduction: monthDeficit },
          "ingest",
        );
      }
    }
    return summary;
  });
}
