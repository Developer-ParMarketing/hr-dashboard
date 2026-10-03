import { cellStr } from "../persist/helpers.js";
import { sendSmtpMail, smtpConfigured } from "../notify/smtp.js";
import { executiveAdminNotificationEmails } from "../leaveRequests/approvers.js";
import { isExemptFromAttendanceAlertEmails } from "../performance/leadership.js";
import { query, queryOne, withTransaction } from "../db/index.js";
import { deleteUserSessions } from "../auth/users.js";
import { formatDojDdMmYyyy, parseFlexibleDoj } from "./dojParse.js";
import {
  calendarTodayIso,
  effectiveEmploymentStatus,
  shouldBeInactiveAfterLeaving,
} from "./employmentStatus.js";

function normCode(code: string): string {
  return cellStr(code).replace(/\s+/g, "").toUpperCase();
}

type EmployeeRow = {
  id: number;
  employee_code: string;
  name: string;
  email: string | null;
  status: string;
  date_of_leaving: string | null;
  offboarding_notified_at: Date | string | null;
};

async function loadEmployeeByCode(code: string): Promise<EmployeeRow | null> {
  const norm = normCode(code);
  if (!norm) return null;
  return (
    (await queryOne<EmployeeRow>(
      `SELECT id, employee_code, name, email, status, date_of_leaving::text AS date_of_leaving,
              offboarding_notified_at
       FROM employees
       WHERE upper(replace(employee_code, ' ', '')) = $1`,
      [norm],
    )) ?? null
  );
}

async function loadEmployeeById(id: number): Promise<EmployeeRow | null> {
  return (
    (await queryOne<EmployeeRow>(
      `SELECT id, employee_code, name, email, status, date_of_leaving::text AS date_of_leaving,
              offboarding_notified_at
       FROM employees WHERE id = $1`,
      [id],
    )) ?? null
  );
}

async function disableLoginForWorkEmail(workEmail: string | null): Promise<number | null> {
  const email = cellStr(workEmail ?? "").toLowerCase();
  if (!email) return null;
  const user = await queryOne<{ id: number }>(
    `SELECT id FROM users WHERE lower(trim(email)) = $1`,
    [email],
  );
  if (!user) return null;
  await query(
    `UPDATE users SET account_disabled = TRUE, updated_at = NOW() WHERE id = $1`,
    [user.id],
  );
  await deleteUserSessions(user.id);
  return user.id;
}

async function sendOffboardingAdminEmail(emp: EmployeeRow, dateOfLeavingIso: string): Promise<boolean> {
  if (!smtpConfigured()) {
    console.warn(
      `[offboarding] SMTP not configured - skipping admin email for ${emp.employee_code} (${emp.name})`,
    );
    return false;
  }
  const dolDisplay = formatDojDdMmYyyy(dateOfLeavingIso);
  const inactiveFrom = formatDojDdMmYyyy(addDaysIso(dateOfLeavingIso, 1));
  const recipients = executiveAdminNotificationEmails().filter(
    (to) => !isExemptFromAttendanceAlertEmails(to),
  );
  const subject = `HR: ${emp.name} (${emp.employee_code}) - portal account inactive`;
  const body = [
    "Hello,",
    "",
    `An experience / relieving letter was generated with date of leaving ${dolDisplay}.`,
    "",
    `${emp.name} (${emp.employee_code}) is marked inactive in People from ${inactiveFrom}.`,
    "Their login (if linked to their work email) has been disabled. Employee history is retained and is excluded from attendance and payroll going forward.",
    "",
    "- Par HR",
  ].join("\n");

  let sent = 0;
  for (const to of recipients) {
    const result = await sendSmtpMail({ to, subject, body, bccHr: false });
    if (!result.skipped) sent += 1;
  }
  return sent > 0;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type OffboardingResult = {
  employeeId: number | null;
  dateOfLeaving: string | null;
  effectiveStatus: "active" | "inactive";
  loginDisabled: boolean;
  adminEmailSent: boolean;
  message?: string;
};

/** Persist DOL from relieving letter and deactivate when past last working day. */
export async function applyRelievingLetterOffboarding(input: {
  employeeCode: string;
  dateOfLeaving: string;
  actor: string;
}): Promise<OffboardingResult> {
  const dolIso = parseFlexibleDoj(input.dateOfLeaving);
  if (!dolIso) {
    throw Object.assign(new Error("Date of leaving must be DD-MM-YYYY"), { status: 400 });
  }

  const emp = await loadEmployeeByCode(input.employeeCode);
  if (!emp) {
    return {
      employeeId: null,
      dateOfLeaving: dolIso,
      effectiveStatus: "inactive",
      loginDisabled: false,
      adminEmailSent: false,
      message: `No employee record found for code ${input.employeeCode}. Letter generated; update People manually.`,
    };
  }

  await query(
    `UPDATE employees
     SET date_of_leaving = $1::date, updated_at = NOW()
     WHERE id = $2`,
    [dolIso, emp.id],
  );

  await query(
    `INSERT INTO change_history (entity_type, entity_id, action, actor, before_json, after_json, note)
     VALUES ('employee', $1, 'update', $2, $3, $4, 'relieving letter - date of leaving')`,
    [
      emp.id,
      input.actor,
      JSON.stringify({ dateOfLeaving: emp.date_of_leaving }),
      JSON.stringify({ dateOfLeaving: dolIso }),
    ],
  );

  return processDueOffboardingForEmployee(emp.id, input.actor);
}

export async function processDueOffboardingForEmployee(
  employeeId: number,
  actor: string,
): Promise<OffboardingResult> {
  const today = calendarTodayIso();
  const emp = await loadEmployeeById(employeeId);
  if (!emp || !emp.date_of_leaving) {
    return {
      employeeId: emp?.id ?? null,
      dateOfLeaving: emp?.date_of_leaving ?? null,
      effectiveStatus: effectiveEmploymentStatus(emp?.status, emp?.date_of_leaving, today),
      loginDisabled: false,
      adminEmailSent: false,
    };
  }

  const dol = emp.date_of_leaving.slice(0, 10);
  if (!shouldBeInactiveAfterLeaving(dol, today)) {
    return {
      employeeId: emp.id,
      dateOfLeaving: dol,
      effectiveStatus: "active",
      loginDisabled: false,
      adminEmailSent: false,
    };
  }

  let loginDisabled = false;
  let adminEmailSent = false;

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE employees SET status = 'inactive', updated_at = NOW() WHERE id = $1`,
      [emp.id],
    );
    await client.query(
      `INSERT INTO change_history (entity_type, entity_id, action, actor, before_json, after_json, note)
       VALUES ('employee', $1, 'update', $2, $3, $4, 'offboarding - inactive after date of leaving')`,
      [
        emp.id,
        actor,
        JSON.stringify({ status: emp.status }),
        JSON.stringify({ status: "inactive", dateOfLeaving: dol }),
      ],
    );
  });

  const userId = await disableLoginForWorkEmail(emp.email);
  loginDisabled = userId != null;

  if (!emp.offboarding_notified_at) {
    adminEmailSent = await sendOffboardingAdminEmail(emp, dol);
    if (adminEmailSent) {
      await query(`UPDATE employees SET offboarding_notified_at = NOW() WHERE id = $1`, [emp.id]);
    }
  }

  return {
    employeeId: emp.id,
    dateOfLeaving: dol,
    effectiveStatus: "inactive",
    loginDisabled,
    adminEmailSent,
  };
}

/** Daily job: deactivate anyone whose last working day has passed. */
export async function runScheduledEmployeeOffboarding(actor = "system"): Promise<{ processed: number }> {
  const today = calendarTodayIso();
  const rows = await query<{ id: number }>(
    `SELECT id FROM employees
     WHERE date_of_leaving IS NOT NULL
       AND date_of_leaving < $1::date
       AND (
         lower(trim(status)) = 'active'
         OR offboarding_notified_at IS NULL
       )`,
    [today],
  );
  for (const row of rows) {
    await processDueOffboardingForEmployee(row.id, actor);
  }
  return { processed: rows.length };
}
