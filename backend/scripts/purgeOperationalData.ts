/**
 * Remove operational / test data. Keeps employees, teams, manager assignments,
 * salary_base_profiles (People), company_holidays, and HR login (password unchanged).
 *
 * Run: cd backend && npx tsx scripts/purgeOperationalData.ts
 */
import { initDb, query, queryOne, withTransaction } from "../src/db/index.js";

const HR_EMAIL = (process.env.AUTH_BOOTSTRAP_EMAIL ?? "hr@parmarketing.agency")
  .trim()
  .toLowerCase();

/** Logins created only for dev/test seeds — not production roster managers. */
const DEMO_USER_EMAILS = ["aishwarya.kamble@parmarketing.agency"] as const;

async function tableCount(table: string): Promise<number> {
  const row = await queryOne<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${table}`);
  return row?.n ?? 0;
}

async function safeCount(table: string): Promise<number | null> {
  try {
    return await tableCount(table);
  } catch {
    return null;
  }
}

const PURGE_TABLES = [
  "auth_sessions",
  "auth_email_challenges",
  "login_audit",
  "performance_appraisal_answers",
  "performance_appraisal_submissions",
  "goal_sheet_answers",
  "goal_sheet_submissions",
  "reimbursement_receipts",
  "reimbursement_requests",
  "leave_requests",
  "portal_punch_days",
  "employee_documents",
  "employee_previous_employer_details",
  "daily_attendance_edits",
  "daily_attendance_raw",
  "daily_attendance",
  "weekly_attendance",
  "leave_records",
  "wfh_records",
  "salary_sheet_rows",
  "salary_workbook_history",
  "salary_workbooks",
  "salary_calc_runs",
  "salary_records",
  "change_history",
  "notification_log",
  "upload_history",
  "holiday_year_reminders",
] as const;

const KEEP_TABLES = [
  "employees",
  "teams",
  "manager_employee_assignments",
  "salary_base_profiles",
  "company_holidays",
  "users",
] as const;

async function main() {
  await initDb();

  console.log("Counts before purge:");
  for (const t of [...KEEP_TABLES, ...PURGE_TABLES]) {
    const n = await safeCount(t);
    if (n !== null) console.log(`  ${t}: ${n}`);
  }

  const hrBefore = await queryOne<{ id: number; email: string }>(
    `SELECT id, email FROM users WHERE lower(email) = $1`,
    [HR_EMAIL],
  );

  await withTransaction(async (client) => {
    for (const table of PURGE_TABLES) {
      await client.query(`DELETE FROM ${table}`).catch(() => {
        /* table may not exist on older DBs */
      });
    }

    for (const email of DEMO_USER_EMAILS) {
      const res = await client.query(`DELETE FROM users WHERE lower(email) = $1 AND lower(email) <> $2`, [
        email.toLowerCase(),
        HR_EMAIL,
      ]);
      if (res.rowCount && res.rowCount > 0) {
        console.log(`Removed demo login: ${email}`);
      }
    }
  });

  const hrAfter = await queryOne<{ id: number; email: string }>(
    `SELECT id, email FROM users WHERE lower(email) = $1`,
    [HR_EMAIL],
  );

  if (!hrAfter) {
    console.warn(
      `\nNo HR user at ${HR_EMAIL}. Start the API once to bootstrap, or set AUTH_BOOTSTRAP_PASSWORD in backend/.env.`,
    );
  } else if (hrBefore) {
    console.log(`\nKept HR login: ${hrAfter.email} (password unchanged).`);
  } else {
    console.log(`\nHR login preserved: ${hrAfter.email}.`);
  }

  console.log("\nCounts after purge:");
  for (const t of [...KEEP_TABLES, ...PURGE_TABLES]) {
    const n = await safeCount(t);
    if (n !== null) console.log(`  ${t}: ${n}`);
  }

  const users = await query<{ email: string; role: string }>(
    `SELECT email, role FROM users ORDER BY email`,
  );
  console.log("\nRemaining logins:");
  for (const u of users) console.log(`  - ${u.email} (${u.role})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
