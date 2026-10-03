/**
 * Bulk attendance alert emails (late arrival, weekly hours). Off unless NOTIFICATIONS_ENABLED is set.
 * Uses daily_attendance / weekly_attendance and notification_log for idempotency.
 */
import { query } from "../db/index.js";
import { formatDisplayDate } from "../displayDate.js";
import { isExemptFromAttendanceAlertEmails } from "../performance/leadership.js";
import { WEEKLY_HOURS_THRESHOLD, daysInMonth, isoDate } from "../persist/helpers.js";
import { attendanceEmailAlertsEnabled } from "./config.js";
import { sendSmtpMail } from "./smtp.js";

export type NotificationKind = "late" | "weekly_hours" | "weekly_data_review";

const WEEKLY_HR_DATA_REVIEW_LINE = `Please check your weekly data. If any changes are required, please contact HR.`;

export type NotificationRunSummary = {
  kind: NotificationKind;
  sent: number;
  skippedNoEmail: number;
  skippedAlreadySent: number;
  skippedDisabled: number;
  failed: number;
  errors: string[];
};

type LateCandidate = {
  employee_id: number;
  employee_code: string;
  name: string;
  email: string | null;
  attendance_date: string;
  in_time: string | null;
  late_minutes: number | null;
  shift_start: string | null;
};

type WeeklyCandidate = {
  employee_id: number;
  employee_code: string;
  name: string;
  email: string | null;
  week_start: string;
  week_end: string;
  total_hours: number | null;
  required_hours: number | null;
};

const TZ = process.env.NOTIFICATIONS_TZ?.trim() || "Asia/Kolkata";

export function calendarDateInTimeZone(at = new Date(), timeZone = TZ): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map((v) => Number.parseInt(v, 10));
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function emptySummary(kind: NotificationKind): NotificationRunSummary {
  return {
    kind,
    sent: 0,
    skippedNoEmail: 0,
    skippedAlreadySent: 0,
    skippedDisabled: 0,
    failed: 0,
    errors: [],
  };
}

function formatHours(hours: number | null): string {
  if (hours == null || !Number.isFinite(hours)) return "-";
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function periodKeyIso(value: string): string {
  return String(value).slice(0, 10);
}

async function alreadySent(kind: NotificationKind, employeeId: number, periodKey: string) {
  const rows = await query<{ id: number }>(
    `SELECT id FROM notification_log WHERE kind = $1 AND employee_id = $2 AND period_key = $3 AND status = 'sent' LIMIT 1`,
    [kind, employeeId, periodKey],
  );
  return rows.length > 0;
}

async function recordNotification(
  kind: NotificationKind,
  employeeId: number,
  periodKey: string,
  toEmail: string | null,
  status: "sent" | "failed",
  error?: string | null,
) {
  await query(
    `INSERT INTO notification_log (kind, employee_id, period_key, to_email, status, error)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (kind, employee_id, period_key) DO UPDATE SET
       to_email = EXCLUDED.to_email,
       status = EXCLUDED.status,
       error = EXCLUDED.error,
       sent_at = NOW()`,
    [kind, employeeId, periodKey, toEmail, status, error ?? null],
  );
}

async function recordSent(
  kind: NotificationKind,
  employeeId: number,
  periodKey: string,
  toEmail: string,
) {
  await recordNotification(kind, employeeId, periodKey, toEmail, "sent", null);
}

function lateBody(row: LateCandidate): { subject: string; body: string } {
  const date = formatDisplayDate(periodKeyIso(row.attendance_date));
  const minutes =
    row.late_minutes != null && Number.isFinite(row.late_minutes) ? String(row.late_minutes) : "-";
  return {
    subject: `Attendance alert: late on ${date}`,
    body: `Hi ${row.name || row.employee_code},

Our records show you were marked late on ${date}.

Employee: ${row.name} (${row.employee_code})
Shift start: ${row.shift_start || "-"}
Check-in: ${row.in_time || "-"}
Late minutes: ${minutes}

Please ensure timely login going forward.

Regards,
HR Team`,
  };
}

function weeklyBody(row: WeeklyCandidate): { subject: string; body: string } {
  const start = formatDisplayDate(periodKeyIso(row.week_start));
  const end = formatDisplayDate(periodKeyIso(row.week_end));
  return {
    subject: `Attendance alert: weekly hours below ${WEEKLY_HOURS_THRESHOLD}`,
    body: `Hi ${row.name || row.employee_code},

Our records show a shortfall in your weekly working hours.

Employee: ${row.name} (${row.employee_code})
Week: ${start} to ${end}
Hours worked: ${formatHours(row.total_hours)}
Required: ${WEEKLY_HOURS_THRESHOLD}:00

Please ensure completion of the required weekly hours.

${WEEKLY_HR_DATA_REVIEW_LINE}

Regards,
HR Team`,
  };
}

function weeklyDataReviewBody(row: WeeklyCandidate): { subject: string; body: string } {
  const start = formatDisplayDate(periodKeyIso(row.week_start));
  const end = formatDisplayDate(periodKeyIso(row.week_end));
  return {
    subject: `Weekly attendance review: ${start} to ${end}`,
    body: `Hi ${row.name || row.employee_code},

Your weekly attendance for ${start} to ${end} has been recorded.

Employee: ${row.name} (${row.employee_code})
Hours worked: ${formatHours(row.total_hours)}
Weekly target: ${WEEKLY_HOURS_THRESHOLD}:00

${WEEKLY_HR_DATA_REVIEW_LINE}

Regards,
HR Team`,
  };
}

/**
 * Daily late mail from stored daily_attendance (not weekly). Sent the day after the late date.
 */
export async function sendLateNotification(opts?: {
  forDate?: string;
  asOf?: string;
}): Promise<NotificationRunSummary> {
  const summary = emptySummary("late");
  if (!attendanceEmailAlertsEnabled()) {
    summary.skippedDisabled = 1;
    return summary;
  }
  const today = opts?.asOf?.slice(0, 10) || calendarDateInTimeZone();
  const forDate = opts?.forDate?.slice(0, 10);
  // Daily job: only the previous calendar day (alert the day after a late mark).
  const targetDate = forDate ?? addDaysIso(today, -1);

  const rows = await query<LateCandidate>(
    `SELECT d.employee_id, e.employee_code, e.name, e.email, d.attendance_date::text AS attendance_date,
            d.in_time, d.late_minutes, e.shift_start
     FROM daily_attendance d
     JOIN employees e ON e.id = d.employee_id
     WHERE d.late = 1
       AND (d.daily_status IS NULL OR d.daily_status = 'late' OR d.daily_status = 'present')
       AND (TRIM(COALESCE(e.company, '')) = '' OR UPPER(TRIM(e.company)) = 'PM')
       AND d.attendance_date = $1::date
     ORDER BY d.attendance_date, e.employee_code`,
    [targetDate],
  );

  for (const row of rows) {
    const periodKey = periodKeyIso(row.attendance_date);
    if (await alreadySent("late", row.employee_id, periodKey)) {
      summary.skippedAlreadySent += 1;
      continue;
    }
    const email = row.email?.trim();
    if (!email) {
      summary.skippedNoEmail += 1;
      continue;
    }
    if (isExemptFromAttendanceAlertEmails(email)) {
      continue;
    }
    const { subject, body } = lateBody(row);
    try {
      const result = await sendSmtpMail({ to: email, subject, body });
      if (result.skipped) {
        summary.skippedDisabled += 1;
        continue;
      }
      await recordSent("late", row.employee_id, periodKey, email);
      summary.sent += 1;
      console.log(`[notify] late mail sent to ${row.name} <${email}> for ${periodKey}`);
    } catch (err) {
      summary.failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      summary.errors.push(`${row.employee_code} ${periodKey}: ${msg}`);
      try {
        await recordNotification("late", row.employee_id, periodKey, email, "failed", msg);
      } catch {
        /* ignore log write failure */
      }
      console.error(`[notify] late mail failed for ${row.employee_code}`, err);
    }
  }
  return summary;
}

// Weekly short-hours mail when a completed week is below 54h (PM employees).
export async function sendWeeklyHoursNotification(opts?: {
  asOf?: string;
}): Promise<NotificationRunSummary> {
  const summary = emptySummary("weekly_hours");
  if (!attendanceEmailAlertsEnabled()) {
    summary.skippedDisabled = 1;
    return summary;
  }
  const today = opts?.asOf?.slice(0, 10) || calendarDateInTimeZone();
  const recentWeekEndFrom = addDaysIso(today, -14);
  const rows = await query<WeeklyCandidate>(
    `SELECT w.employee_id, e.employee_code, e.name, e.email,
            w.week_start::text AS week_start, w.week_end::text AS week_end,
            w.total_hours, w.required_hours
     FROM weekly_attendance w
     JOIN employees e ON e.id = w.employee_id
     WHERE w.total_hours IS NOT NULL
       AND w.total_hours < $1
       AND w.week_end < $2::date
       AND w.week_end >= $3::date
       AND (w.required_hours IS NULL OR w.required_hours >= $1)
       AND (TRIM(COALESCE(e.company, '')) = '' OR UPPER(TRIM(e.company)) = 'PM')
     ORDER BY w.week_start, e.employee_code`,
    [WEEKLY_HOURS_THRESHOLD, today, recentWeekEndFrom],
  );

  for (const row of rows) {
    const periodKey = periodKeyIso(row.week_start);
    if (await alreadySent("weekly_hours", row.employee_id, periodKey)) {
      summary.skippedAlreadySent += 1;
      continue;
    }
    const email = row.email?.trim();
    if (!email) {
      summary.skippedNoEmail += 1;
      continue;
    }
    if (isExemptFromAttendanceAlertEmails(email)) {
      continue;
    }
    const { subject, body } = weeklyBody(row);
    try {
      const result = await sendSmtpMail({ to: email, subject, body });
      if (result.skipped) {
        summary.skippedDisabled += 1;
        continue;
      }
      await recordSent("weekly_hours", row.employee_id, periodKey, email);
      summary.sent += 1;
      console.log(`[notify] weekly hours mail sent to ${row.name} <${email}> for week ${periodKey}`);
    } catch (err) {
      summary.failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      summary.errors.push(`${row.employee_code} ${periodKey}: ${msg}`);
      try {
        await recordNotification("weekly_hours", row.employee_id, periodKey, email, "failed", msg);
      } catch {
        /* ignore log write failure */
      }
      console.error(`[notify] weekly hours mail failed for ${row.employee_code}`, err);
    }
  }
  return summary;
}

/** Weekly review mail for completed weeks at or above 54h (employees/managers not in the shortfall alert). */
export async function sendWeeklyDataReviewNotification(opts?: {
  asOf?: string;
}): Promise<NotificationRunSummary> {
  const summary = emptySummary("weekly_data_review");
  if (!attendanceEmailAlertsEnabled()) {
    summary.skippedDisabled = 1;
    return summary;
  }
  const today = opts?.asOf?.slice(0, 10) || calendarDateInTimeZone();
  const recentWeekEndFrom = addDaysIso(today, -14);
  const rows = await query<WeeklyCandidate>(
    `SELECT w.employee_id, e.employee_code, e.name, e.email,
            w.week_start::text AS week_start, w.week_end::text AS week_end,
            w.total_hours, w.required_hours
     FROM weekly_attendance w
     JOIN employees e ON e.id = w.employee_id
     WHERE w.total_hours IS NOT NULL
       AND w.total_hours >= $1
       AND w.week_end < $2::date
       AND w.week_end >= $3::date
       AND (w.required_hours IS NULL OR w.required_hours >= $1)
       AND (TRIM(COALESCE(e.company, '')) = '' OR UPPER(TRIM(e.company)) = 'PM')
     ORDER BY w.week_start, e.employee_code`,
    [WEEKLY_HOURS_THRESHOLD, today, recentWeekEndFrom],
  );

  for (const row of rows) {
    const periodKey = periodKeyIso(row.week_start);
    if (await alreadySent("weekly_data_review", row.employee_id, periodKey)) {
      summary.skippedAlreadySent += 1;
      continue;
    }
    if (await alreadySent("weekly_hours", row.employee_id, periodKey)) {
      summary.skippedAlreadySent += 1;
      continue;
    }
    const email = row.email?.trim();
    if (!email) {
      summary.skippedNoEmail += 1;
      continue;
    }
    if (isExemptFromAttendanceAlertEmails(email)) {
      continue;
    }
    const { subject, body } = weeklyDataReviewBody(row);
    try {
      const result = await sendSmtpMail({ to: email, subject, body });
      if (result.skipped) {
        summary.skippedDisabled += 1;
        continue;
      }
      await recordSent("weekly_data_review", row.employee_id, periodKey, email);
      summary.sent += 1;
      console.log(
        `[notify] weekly data review mail sent to ${row.name} <${email}> for week ${periodKey}`,
      );
    } catch (err) {
      summary.failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      summary.errors.push(`${row.employee_code} ${periodKey}: ${msg}`);
      try {
        await recordNotification("weekly_data_review", row.employee_id, periodKey, email, "failed", msg);
      } catch {
        /* ignore log write failure */
      }
      console.error(`[notify] weekly data review mail failed for ${row.employee_code}`, err);
    }
  }
  return summary;
}

export async function runScheduledNotifications(asOf?: string) {
  const late = await sendLateNotification({ asOf });
  const weekly = await sendWeeklyHoursNotification({ asOf });
  const weeklyReview = await sendWeeklyDataReviewNotification({ asOf });
  return { late, weekly, weeklyReview };
}

export type NotificationStatusEntry = {
  kind: NotificationKind;
  employeeId: number;
  employeeCode: string;
  periodKey: string;
  status: "pending" | "sent" | "failed";
  error?: string | null;
};

function notificationKey(kind: NotificationKind, employeeId: number, periodKey: string): string {
  return `${kind}:${employeeId}:${periodKey}`;
}

// Dashboard status for late + weekly mail in a given month.
export async function loadNotificationStatusForMonth(
  year: number,
  month: number,
  company?: string,
): Promise<NotificationStatusEntry[]> {
  const dim = daysInMonth(year, month);
  const from = isoDate(year, month, 1);
  const to = isoDate(year, month, dim);
  const today = calendarDateInTimeZone();
  const companyNorm = company?.trim().toUpperCase() ?? "";

  const logs = await query<{
    kind: NotificationKind;
    employee_id: number;
    employee_code: string;
    period_key: string;
    status: string;
    error: string | null;
  }>(
    `SELECT n.kind, n.employee_id, e.employee_code, n.period_key, n.status, n.error
     FROM notification_log n
     JOIN employees e ON e.id = n.employee_id
     WHERE n.period_key BETWEEN $1 AND $2
       AND ($3 = '' OR UPPER(TRIM(COALESCE(e.company, ''))) = $3 OR TRIM(COALESCE(e.company, '')) = '')
     ORDER BY n.period_key, e.employee_code`,
    [from, to, companyNorm],
  );

  const logByKey = new Map<string, (typeof logs)[0]>();
  for (const row of logs) {
    logByKey.set(notificationKey(row.kind, row.employee_id, periodKeyIso(row.period_key)), row);
  }

  const out: NotificationStatusEntry[] = [];

  const lateRows = await query<{
    employee_id: number;
    employee_code: string;
    attendance_date: string;
  }>(
    `SELECT d.employee_id, e.employee_code, d.attendance_date::text AS attendance_date
     FROM daily_attendance d
     JOIN employees e ON e.id = d.employee_id
     WHERE d.attendance_date BETWEEN $1 AND $2
       AND d.late = 1
       AND (TRIM(COALESCE(e.company, '')) = '' OR UPPER(TRIM(e.company)) = 'PM')
       AND ($3 = '' OR UPPER(TRIM(COALESCE(e.company, ''))) = $3 OR TRIM(COALESCE(e.company, '')) = '')
     ORDER BY d.attendance_date, e.employee_code`,
    [from, to, companyNorm],
  );

  for (const row of lateRows) {
    const periodKey = periodKeyIso(row.attendance_date);
    const hit = logByKey.get(notificationKey("late", row.employee_id, periodKey));
    let status: NotificationStatusEntry["status"] = "pending";
    if (hit?.status === "sent") status = "sent";
    else if (hit?.status === "failed") status = "failed";
    out.push({
      kind: "late",
      employeeId: row.employee_id,
      employeeCode: row.employee_code,
      periodKey,
      status,
      error: hit?.error ?? null,
    });
  }

  const weeklyRows = await query<{
    employee_id: number;
    employee_code: string;
    week_start: string;
    week_end: string;
    total_hours: number | null;
  }>(
    `SELECT w.employee_id, e.employee_code, w.week_start::text AS week_start, w.week_end::text AS week_end,
            w.total_hours
     FROM weekly_attendance w
     JOIN employees e ON e.id = w.employee_id
     WHERE w.week_start BETWEEN $1 AND $2
       AND w.total_hours IS NOT NULL
       AND w.total_hours < $3
       AND (TRIM(COALESCE(e.company, '')) = '' OR UPPER(TRIM(e.company)) = 'PM')
       AND ($4 = '' OR UPPER(TRIM(COALESCE(e.company, ''))) = $4 OR TRIM(COALESCE(e.company, '')) = '')
     ORDER BY w.week_start, e.employee_code`,
    [from, to, WEEKLY_HOURS_THRESHOLD, companyNorm],
  );

  for (const row of weeklyRows) {
    const periodKey = periodKeyIso(row.week_start);
    if (periodKeyIso(row.week_end) >= today) continue;
    const hit = logByKey.get(notificationKey("weekly_hours", row.employee_id, periodKey));
    let status: NotificationStatusEntry["status"] = "pending";
    if (hit?.status === "sent") status = "sent";
    else if (hit?.status === "failed") status = "failed";
    out.push({
      kind: "weekly_hours",
      employeeId: row.employee_id,
      employeeCode: row.employee_code,
      periodKey,
      status,
      error: hit?.error ?? null,
    });
  }

  const weeklyReviewRows = await query<{
    employee_id: number;
    employee_code: string;
    week_start: string;
    week_end: string;
    total_hours: number | null;
  }>(
    `SELECT w.employee_id, e.employee_code, w.week_start::text AS week_start, w.week_end::text AS week_end,
            w.total_hours
     FROM weekly_attendance w
     JOIN employees e ON e.id = w.employee_id
     WHERE w.week_start BETWEEN $1 AND $2
       AND w.total_hours IS NOT NULL
       AND w.total_hours >= $3
       AND (TRIM(COALESCE(e.company, '')) = '' OR UPPER(TRIM(e.company)) = 'PM')
       AND ($4 = '' OR UPPER(TRIM(COALESCE(e.company, ''))) = $4 OR TRIM(COALESCE(e.company, '')) = '')
     ORDER BY w.week_start, e.employee_code`,
    [from, to, WEEKLY_HOURS_THRESHOLD, companyNorm],
  );

  for (const row of weeklyReviewRows) {
    const periodKey = periodKeyIso(row.week_start);
    if (periodKeyIso(row.week_end) >= today) continue;
    const hit = logByKey.get(notificationKey("weekly_data_review", row.employee_id, periodKey));
    let status: NotificationStatusEntry["status"] = "pending";
    if (hit?.status === "sent") status = "sent";
    else if (hit?.status === "failed") status = "failed";
    out.push({
      kind: "weekly_data_review",
      employeeId: row.employee_id,
      employeeCode: row.employee_code,
      periodKey,
      status,
      error: hit?.error ?? null,
    });
  }

  return out;
}
