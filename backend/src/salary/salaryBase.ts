import * as XLSX from "xlsx";
import type pg from "pg";
import type { IncrementCycle } from "./incrementCycle.js";
import { cycleIsActive } from "./incrementCycle.js";
import { query, withTransaction } from "../db/index.js";
import { cellStr } from "../persist/helpers.js";
import {
  normEmployeeCode,
  resolveEmployeeLinkage,
  type EmployeeRosterRow,
} from "../persist/employeeLinkage.js";
import { parsePmAmount } from "./pmSalaryCalculator.js";
import { parseFlexibleDoj } from "../employees/dojParse.js";
import type { SalarySheetInputRow } from "./salarySheet.js";

export type SalaryBaseProfile = Omit<
  SalarySheetInputRow,
  "employeeCode" | "employeeName" | "increment" | "otherEarning"
> & {
  employeeCode?: string;
  employeeName?: string;
};

/** PM payroll: statutory columns default to zero except professional tax (₹200; February payroll uses ₹300 in salary calc). */
export const DEFAULT_PM_PT = 200;

export function defaultPmStatutoryFields(): Pick<
  SalarySheetInputRow,
  "pfEmployee" | "esiEmployee" | "pt" | "gratuity" | "employerPf" | "employerPfArr" | "employerEsi"
> {
  return {
    pfEmployee: 0,
    esiEmployee: 0,
    pt: DEFAULT_PM_PT,
    gratuity: 0,
    employerPf: 0,
    employerPfArr: 0,
    employerEsi: 0,
  };
}

/** One row from PM salary base Excel (Emp Code, In Hand, DOJ, …). */
export type SalaryBaseImportRow = {
  employeeCode: string;
  employeeName: string;
  inHand: number;
  pfEmployee: number;
  esiEmployee: number;
  pt: number;
  gratuity: number;
  employerPf: number;
  employerPfArr: number;
  employerEsi: number;
  department?: string;
  gender?: string;
  dateOfJoining?: string;
};

function normCode(code: string): string {
  return normEmployeeCode(code);
}

export function staticSalaryFields(
  row: Pick<
    SalarySheetInputRow,
    | "inHand"
    | "pfEmployee"
    | "esiEmployee"
    | "pt"
    | "gratuity"
    | "employerPf"
    | "employerPfArr"
    | "employerEsi"
  >,
): Pick<
  SalarySheetInputRow,
  | "inHand"
  | "pfEmployee"
  | "esiEmployee"
  | "pt"
  | "gratuity"
  | "employerPf"
  | "employerPfArr"
  | "employerEsi"
> {
  return {
    inHand: Number(row.inHand) || 0,
    pfEmployee: Number(row.pfEmployee) || 0,
    esiEmployee: Number(row.esiEmployee) || 0,
    pt: Number(row.pt) > 0 ? Number(row.pt) : DEFAULT_PM_PT,
    gratuity: Number(row.gratuity) || 0,
    employerPf: Number(row.employerPf) || 0,
    employerPfArr: Number(row.employerPfArr) || 0,
    employerEsi: Number(row.employerEsi) || 0,
  };
}

export async function loadBaseProfileMap(company: string): Promise<Map<number, SalarySheetInputRow>> {
  const companyNorm = company.trim() || "PM";
  const rows = await query<{
    employee_id: number;
    employee_code: string;
    name: string;
    in_hand: number;
    pf_employee: number;
    esi_employee: number;
    pt: number;
    gratuity: number;
    employer_pf: number;
    employer_pf_arr: number;
    employer_esi: number;
    increment_percent: number | null;
  }>(
    `SELECT b.*, e.employee_code, e.name
     FROM salary_base_profiles b
     JOIN employees e ON e.id = b.employee_id
     WHERE b.company = $1`,
    [companyNorm],
  );

  const map = new Map<number, SalarySheetInputRow>();
  for (const r of rows) {
    const staticPart = staticSalaryFields({
      inHand: Number(r.in_hand),
      pfEmployee: Number(r.pf_employee),
      esiEmployee: Number(r.esi_employee),
      pt: Number(r.pt),
      gratuity: Number(r.gratuity),
      employerPf: Number(r.employer_pf),
      employerPfArr: Number(r.employer_pf_arr),
      employerEsi: Number(r.employer_esi),
    });
    const incrementPercent =
      r.increment_percent != null && Number.isFinite(Number(r.increment_percent))
        ? Number(r.increment_percent)
        : null;
    map.set(r.employee_id, {
      employeeId: r.employee_id,
      employeeCode: r.employee_code,
      employeeName: r.name,
      ...staticPart,
      incrementPercent,
      otherEarning: 0,
      increment: 0,
    });
  }
  return map;
}

async function upsertBaseProfile(
  client: pg.PoolClient,
  employeeId: number,
  company: string,
  fields: SalaryBaseFields,
  actor: string,
): Promise<void> {
  const incrementPercent =
    fields.incrementPercent != null && Number.isFinite(fields.incrementPercent)
      ? fields.incrementPercent
      : null;
  await client.query(
    `INSERT INTO salary_base_profiles (
       company, employee_id, in_hand, pf_employee, esi_employee, pt, gratuity,
       employer_pf, employer_pf_arr, employer_esi, increment_percent, updated_by, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
     ON CONFLICT (company, employee_id) DO UPDATE SET
       in_hand = EXCLUDED.in_hand,
       pf_employee = EXCLUDED.pf_employee,
       esi_employee = EXCLUDED.esi_employee,
       pt = EXCLUDED.pt,
       gratuity = EXCLUDED.gratuity,
       employer_pf = EXCLUDED.employer_pf,
       employer_pf_arr = EXCLUDED.employer_pf_arr,
       employer_esi = EXCLUDED.employer_esi,
       increment_percent = EXCLUDED.increment_percent,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [
      company,
      employeeId,
      fields.inHand,
      fields.pfEmployee,
      fields.esiEmployee,
      fields.pt,
      fields.gratuity,
      fields.employerPf,
      fields.employerPfArr,
      fields.employerEsi,
      incrementPercent,
      actor,
    ],
  );
  await client.query(`UPDATE employees SET salary = $1, updated_at = NOW() WHERE id = $2`, [
    fields.inHand + fields.pt,
    employeeId,
  ]);
}

function parseDojCell(v: unknown): string | null {
  return parseFlexibleDoj(v);
}

/** Parse PM salary workbook rows (Emp Code, In Hand, DOJ, etc.). */
export function parseSalaryBaseRowsFromBuffer(buffer: Buffer): SalaryBaseImportRow[] {
  return parseBaseRowsFromExcel(buffer);
}

function parseBaseRowsFromExcel(buffer: Buffer): SalaryBaseImportRow[] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheetName =
    wb.SheetNames.find((n) => cellStr(n).toLowerCase() === "salary") ?? wb.SheetNames[0];
  if (!sheetName) return [];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName]!, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];

  let headerRow = 0;
  for (let r = 0; r < Math.min(matrix.length, 10); r++) {
    const headers = (matrix[r] ?? []).map((c) => cellStr(c).toLowerCase());
    if (headers.some((h) => h.includes("emp code")) && headers.some((h) => h.includes("in hand"))) {
      headerRow = r;
      break;
    }
  }

  const headers = (matrix[headerRow] ?? []).map((c) => cellStr(c).toLowerCase());
  const find = (...candidates: string[]) =>
    headers.findIndex((h) => candidates.some((c) => h.includes(c) || h.replace(/\s+/g, "") === c.replace(/\s+/g, "")));

  const codeIdx = find("emp code", "employee code", "code");
  const nameIdx = find("emp name", "employee name", "name");
  const inHandIdx = find("in hand", "inhand");
  if (codeIdx < 0 || inHandIdx < 0) return [];

  const pfIdx = find("pfamt", "pf employee", "pf amount");
  const esiIdx = find("esiamt", "esi employee", "esi amount");
  const ptIdx = find("pt", "prof tax");
  const gratIdx = find("gratuity");
  const empPfIdx = find("employer pf");
  const empPfArrIdx = find("employer pfarr", "employer pf arr");
  const empEsiIdx = find("employer esi");
  const dojIdx = find("doj", "date of joining");
  const deptIdx = find("department", "dept");
  const genderIdx = find("gender");
  const processIdx = find("process");

  const cellAt = (row: unknown[], idx: number) => (idx >= 0 ? row[idx] : undefined);
  const out: SalaryBaseImportRow[] = [];

  for (let r = headerRow + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const employeeCode = cellStr(cellAt(row, codeIdx)).toUpperCase();
    const employeeName = nameIdx >= 0 ? cellStr(cellAt(row, nameIdx)) : "";
    const inHand = parsePmAmount(cellAt(row, inHandIdx));
    if (!employeeCode && !employeeName && !inHand) continue;
    if (!employeeCode || inHand <= 0) continue;

    out.push({
      employeeCode,
      employeeName,
      inHand,
      pfEmployee: parsePmAmount(cellAt(row, pfIdx)),
      esiEmployee: parsePmAmount(cellAt(row, esiIdx)),
      pt: parsePmAmount(cellAt(row, ptIdx)),
      gratuity: parsePmAmount(cellAt(row, gratIdx)),
      employerPf: parsePmAmount(cellAt(row, empPfIdx)),
      employerPfArr: parsePmAmount(cellAt(row, empPfArrIdx)),
      employerEsi: parsePmAmount(cellAt(row, empEsiIdx)),
      department: deptIdx >= 0 ? cellStr(cellAt(row, deptIdx)) || undefined : undefined,
      gender: genderIdx >= 0 ? cellStr(cellAt(row, genderIdx)) || undefined : undefined,
      dateOfJoining: dojIdx >= 0 ? parseDojCell(cellAt(row, dojIdx)) ?? undefined : undefined,
      ...(processIdx >= 0 && cellStr(cellAt(row, processIdx))
        ? { process: cellStr(cellAt(row, processIdx)) }
        : {}),
    });
  }
  return out;
}

export async function importSalaryBaseProfiles(input: {
  company: string;
  actor: string;
  rows: SalaryBaseImportRow[];
}): Promise<{ matched: number; unmatched: string[]; matchedByName: number }> {
  const company = input.company.trim() || "PM";
  const emps = await query<{ id: number; employee_code: string; name: string }>(
    `SELECT id, employee_code, name FROM employees WHERE status = 'active'`,
  );
  const roster: EmployeeRosterRow[] = emps;
  let matched = 0;
  let matchedByName = 0;
  const unmatched: string[] = [];

  await withTransaction(async (client) => {
    for (const row of input.rows) {
      const link = resolveEmployeeLinkage(roster, {
        code: row.employeeCode ?? "",
        name: row.employeeName ?? "",
      });
      if (!link) {
        unmatched.push(row.employeeCode ?? row.employeeName ?? "?");
        continue;
      }
      if (link.method === "name") matchedByName += 1;
      const employeeId = link.id;
      const fields = staticSalaryFields(row);
      await upsertBaseProfile(client, employeeId, company, fields, input.actor);
      const dept = row.department?.trim() || null;
      const gender = row.gender?.trim() || null;
      const doj = row.dateOfJoining ?? null;
      const process = (row as { process?: string }).process?.trim() || null;
      await client.query(
        `UPDATE employees
         SET department = COALESCE($1, department),
             gender = COALESCE($2, gender),
             date_of_joining = COALESCE($3::date, date_of_joining),
             company = COALESCE($4, company),
             updated_at = NOW()
         WHERE id = $5`,
        [dept, gender, doj, process, employeeId],
      );
      matched += 1;
    }
  });

  return { matched, unmatched, matchedByName };
}

export async function importSalaryBaseFromExcel(input: {
  buffer: Buffer;
  company: string;
  actor: string;
}): Promise<{ matched: number; unmatched: string[]; parsed: number; matchedByName: number }> {
  const rows = parseBaseRowsFromExcel(input.buffer);
  if (rows.length === 0) {
    throw Object.assign(new Error("No salary base rows found. Use the PM Salary sheet with Emp Code and In Hand."), {
      status: 400,
    });
  }
  const result = await importSalaryBaseProfiles({
    company: input.company,
    actor: input.actor,
    rows,
  });
  return { ...result, parsed: rows.length };
}

export type SalaryBaseFields = ReturnType<typeof staticSalaryFields> & {
  incrementPercent?: number | null;
};

export async function loadEmployeeSalaryBaseProfile(
  employeeId: number,
  company: string,
): Promise<SalaryBaseFields | null> {
  const companyNorm = company.trim() || "PM";
  const rows = await query<{
    in_hand: number;
    pf_employee: number;
    esi_employee: number;
    pt: number;
    gratuity: number;
    employer_pf: number;
    employer_pf_arr: number;
    employer_esi: number;
    increment_percent: number | null;
  }>(
    `SELECT in_hand, pf_employee, esi_employee, pt, gratuity,
            employer_pf, employer_pf_arr, employer_esi, increment_percent
     FROM salary_base_profiles
     WHERE company = $1 AND employee_id = $2`,
    [companyNorm, employeeId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    ...staticSalaryFields({
      inHand: Number(row.in_hand),
      pfEmployee: Number(row.pf_employee),
      esiEmployee: Number(row.esi_employee),
      pt: Number(row.pt),
      gratuity: Number(row.gratuity),
      employerPf: Number(row.employer_pf),
      employerPfArr: Number(row.employer_pf_arr),
      employerEsi: Number(row.employer_esi),
    }),
    incrementPercent:
      row.increment_percent != null && Number.isFinite(Number(row.increment_percent))
        ? Number(row.increment_percent)
        : null,
  };
}

export async function saveEmployeeSalaryBaseProfile(
  employeeId: number,
  company: string,
  fields: SalaryBaseFields,
  actor: string,
  client?: pg.PoolClient,
): Promise<void> {
  const companyNorm = company.trim() || "PM";
  const run = async (c: pg.PoolClient) => {
    await upsertBaseProfile(c, employeeId, companyNorm, fields, actor);
  };
  if (client) return run(client);
  return withTransaction(run);
}

export async function loadIncrementCycleMap(company: string): Promise<Map<number, IncrementCycle>> {
  const companyNorm = company.trim() || "PM";
  const rows = await query<{
    employee_id: number;
    increment_from_year: number | null;
    increment_from_month: number | null;
    increment_percent: number | null;
    increment_rupees: number;
  }>(
    `SELECT employee_id, increment_from_year, increment_from_month, increment_percent, increment_rupees
     FROM salary_base_profiles
     WHERE company = $1`,
    [companyNorm],
  );
  const map = new Map<number, IncrementCycle>();
  for (const r of rows) {
    const cycle: IncrementCycle = {
      incrementFromYear: Number(r.increment_from_year) || 0,
      incrementFromMonth: Number(r.increment_from_month) || 0,
      incrementPercent:
        r.increment_percent != null && Number.isFinite(Number(r.increment_percent))
          ? Number(r.increment_percent)
          : null,
      incrementRupees: Number(r.increment_rupees) || 0,
    };
    if (cycleIsActive(cycle)) {
      map.set(r.employee_id, cycle);
    }
  }
  return map;
}
