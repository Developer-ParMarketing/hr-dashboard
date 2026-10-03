/**
 * Restore Admin → People master from local HR files (attendance roster + salary base).
 * Does not touch attendance registers, leave, or payroll runs.
 *
 * Default paths (override with env):
 *   RESTORE_ATTENDANCE_PDF  — ESSL monthly PDF (codes, names, shifts)
 *   RESTORE_SALARY_XLSX     — salary calculation PM.xlsx (DOJ, gender, in-hand, PF/ESI)
 *
 * Run: cd backend && npm run restore:people
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDb, query, queryOne, withTransaction } from "../src/db/index.js";
import { cellStr } from "../src/persist/helpers.js";
import {
  importSalaryBaseProfiles,
  parseSalaryBaseRowsFromBuffer,
} from "../src/salary/salaryBase.js";
import { seedTeams, seedPinnedEmployeeTeams, setEmployeeTeam } from "../src/teams/teams.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_PDF =
  process.env.RESTORE_ATTENDANCE_PDF?.trim() ||
  "/Users/hemangikakirde/Desktop/Data - HR/Daily Attendance_Detail Summary Report PM.pdf";
const DEFAULT_SALARY_XLSX =
  process.env.RESTORE_SALARY_XLSX?.trim() ||
  "/Users/hemangikakirde/Desktop/Data - HR/salary calculation PM.xlsx";

/** Work emails that differ from first.last@parmarketing.agency heuristics. */
const WORK_EMAIL_BY_CODE: Record<string, string> = {
  PMPL01: "jay.parmar@parmarketing.agency",
  PMPL02: "mansi.prasad@parmarketing.agency",
  PMPL03: "santosh.choudhary@parmarketing.agency",
  PMPL04: "wasif.siddiqui@parmarketing.agency",
  PMPL11: "nikhil.varia@parmarketing.agency",
  PMPL13: "aishwarya.kamble@parmarketing.agency",
  PMPL14: "rizwan.shaikh@parmarketing.agency",
  PMPL23: "hemangi.kakirde@parmarketing.agency",
};

type RosterRow = {
  employeeCode: string;
  name: string;
  shiftStart: string;
};

function normShift(raw: string): string {
  const s = cellStr(raw);
  if (!s) return "";
  const parts = s.split(":").map((p) => p.trim());
  if (parts.length >= 2) return `${parts[0]}:${parts[1]}`;
  return s;
}

function workEmailFor(code: string, name: string): string {
  const fixed = WORK_EMAIL_BY_CODE[code.toUpperCase()];
  if (fixed) return fixed;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0]!.toLowerCase().replace(/[^a-z0-9]/g, "");
    const last = parts[parts.length - 1]!.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (first && last) return `${first}.${last}@parmarketing.agency`;
  }
  const one = parts[0]?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "employee";
  return `${one}@parmarketing.agency`;
}

function loadRosterFromPdf(pdfPath: string): RosterRow[] {
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`Attendance PDF not found: ${pdfPath}`);
  }
  const script = path.join(__dirname, "pdf_to_json.py");
  const proc = spawnSync("python3", [script, pdfPath, "PM", "monthly"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (proc.status !== 0) {
    throw new Error(proc.stderr?.trim() || proc.stdout?.trim() || "pdf_to_json failed");
  }
  const data = JSON.parse(proc.stdout) as { employees?: unknown[] };
  const out: RosterRow[] = [];
  for (const row of data.employees ?? []) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const employeeCode = cellStr(r.employeeCode ?? r.code).replace(/\s+/g, "").toUpperCase();
    const name = cellStr(r.name ?? r.employeeName);
    const shiftStart = normShift(cellStr(r.shiftStart ?? r.shift));
    if (!employeeCode || !name) continue;
    out.push({ employeeCode, name, shiftStart });
  }
  out.sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
  return out;
}

async function upsertRoster(roster: RosterRow[]): Promise<number> {
  let n = 0;
  await withTransaction(async (client) => {
    for (const row of roster) {
      const email = workEmailFor(row.employeeCode, row.name);
      await client.query(
        `INSERT INTO employees (
           employee_code, name, email, company, shift_start, status, updated_at
         ) VALUES ($1, $2, $3, 'PM', NULLIF($4, ''), 'active', NOW())
         ON CONFLICT (employee_code) DO UPDATE SET
           name = EXCLUDED.name,
           email = COALESCE(NULLIF(EXCLUDED.email, ''), employees.email),
           company = COALESCE(employees.company, 'PM'),
           shift_start = CASE WHEN EXCLUDED.shift_start <> '' THEN EXCLUDED.shift_start ELSE employees.shift_start END,
           updated_at = NOW()`,
        [row.employeeCode, row.name, email, row.shiftStart],
      );
      n += 1;
    }
  });
  return n;
}

async function assignUnpinnedToOthers(): Promise<number> {
  const others = await queryOne<{ id: number }>(`SELECT id FROM teams WHERE slug = 'others'`);
  if (!others) return 0;
  const rows = await query<{ id: number }>(
    `SELECT id FROM employees WHERE team_id IS NULL ORDER BY employee_code`,
  );
  for (const row of rows) {
    await setEmployeeTeam(row.id, others.id, "system:restore-people");
  }
  return rows.length;
}

async function resyncManagerAssignmentsFromTeams(): Promise<number> {
  const rows = await query<{ id: number; team_id: number | null }>(
    `SELECT id, team_id FROM employees WHERE team_id IS NOT NULL`,
  );
  for (const row of rows) {
    await setEmployeeTeam(row.id, row.team_id, "system:restore-people");
  }
  return rows.length;
}

async function main() {
  await initDb();

  console.log("Loading roster from:", DEFAULT_PDF);
  const roster = loadRosterFromPdf(DEFAULT_PDF);
  console.log(`Parsed ${roster.length} employees from attendance PDF.`);

  const upserted = await upsertRoster(roster);
  console.log(`Upserted ${upserted} employee rows.`);

  if (fs.existsSync(DEFAULT_SALARY_XLSX)) {
    console.log("Importing salary base + DOJ/gender/dept from:", DEFAULT_SALARY_XLSX);
    const buf = fs.readFileSync(DEFAULT_SALARY_XLSX);
    const parsedRows = parseSalaryBaseRowsFromBuffer(buf);
    const nameRows = parsedRows.map((row) => ({
      ...row,
      employeeCode: "",
    }));
    await query(`DELETE FROM salary_base_profiles WHERE company = 'PM'`);
    let salary = await importSalaryBaseProfiles({
      company: "PM",
      actor: "system:restore-people",
      rows: nameRows,
    });

    /** Salary sheet names are short; map to ESSL codes when fuzzy match is ambiguous. */
    const SALARY_NAME_TO_CODE: Record<string, string> = {
      santosh: "PMPL03",
      hemangi: "PMPL23",
    };
    for (const row of parsedRows) {
      const key = cellStr(row.employeeName).toLowerCase().replace(/[^a-z0-9]/g, "");
      const code = SALARY_NAME_TO_CODE[key];
      if (!code) continue;
      const emp = await queryOne<{ id: number }>(`SELECT id FROM employees WHERE employee_code = $1`, [
        code,
      ]);
      if (!emp) continue;
      await importSalaryBaseProfiles({
        company: "PM",
        actor: "system:restore-people",
        rows: [{ ...row, employeeCode: code }],
      });
      salary = { ...salary, matched: salary.matched + 1 };
    }

    console.log(
      `Salary: matched ${salary.matched} (${salary.matchedByName} by name), unmatched: ${salary.unmatched.filter(Boolean).join(", ") || "none"}`,
    );
  } else {
    console.warn("Salary xlsx not found — skipped salary base / DOJ import.");
  }

  console.log("Seeding teams and pinned team placements…");
  await seedTeams();
  await seedPinnedEmployeeTeams();

  const othersCount = await assignUnpinnedToOthers();
  if (othersCount > 0) {
    console.log(`Assigned ${othersCount} employees without a team → Others.`);
  }

  const synced = await resyncManagerAssignmentsFromTeams();
  console.log(`Synced manager assignments for ${synced} employees on teams.`);

  const counts = await queryOne<{
    employees: number;
    teams: number;
    assignments: number;
    salary_base: number;
  }>(
    `SELECT
       (SELECT COUNT(*)::int FROM employees) AS employees,
       (SELECT COUNT(*)::int FROM teams) AS teams,
       (SELECT COUNT(*)::int FROM manager_employee_assignments) AS assignments,
       (SELECT COUNT(*)::int FROM salary_base_profiles) AS salary_base`,
  );
  console.log("\nAfter restore:");
  console.log(`  employees: ${counts?.employees ?? 0}`);
  console.log(`  teams: ${counts?.teams ?? 0}`);
  console.log(`  manager assignments: ${counts?.assignments ?? 0}`);
  console.log(`  salary_base_profiles: ${counts?.salary_base ?? 0}`);
  console.log(
    "\nReview Admin → People: verify work emails, teams, and salary for anyone not in the salary Excel.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
