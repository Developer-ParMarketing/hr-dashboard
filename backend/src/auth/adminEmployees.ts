import { query, withTransaction } from "../db/index.js";
import { cellStr, daysInMonth, isoDate } from "../persist/helpers.js";
import {
  loadEmployeeSalaryBaseProfile,
  saveEmployeeSalaryBaseProfile,
  staticSalaryFields,
  DEFAULT_PM_PT,
  type SalaryBaseFields,
} from "../salary/salaryBase.js";
import { syncEmployeeSalaryFieldsToAllSheetRows } from "../salary/employeeMasterSync.js";
import { parseFlexibleDoj } from "../employees/dojParse.js";
import {
  calendarTodayIso,
  effectiveEmploymentStatus,
  parseDateOfLeavingInput,
} from "../employees/employmentStatus.js";
import { setEmployeeTeam } from "../teams/teams.js";
import { processDueOffboardingForEmployee } from "../employees/offboarding.js";
import {
  findSimilarWorkEmailsAmong,
  normalizeWorkEmail as normalizeWorkEmailForSimilarity,
  type SimilarWorkEmailHit,
} from "../persist/workEmailSimilarity.js";

export type AdminEmployeeSalaryBase = SalaryBaseFields;

export type AdminEmployeeRecord = {
  id: number;
  employeeCode: string;
  name: string;
  email: string | null;
  company: string | null;
  department: string | null;
  gender: string | null;
  dateOfJoining: string | null;
  dateOfLeaving: string | null;
  effectiveStatus: "active" | "inactive";
  teamId: number | null;
  teamName: string | null;
  teamSortOrder: number;
  teamManagerName: string | null;
  shiftStart: string | null;
  status: string;
  salaryBase: AdminEmployeeSalaryBase | null;
  updatedAt: string;
  /** Set when list is requested with registerYear/registerMonth - active person has daily rows that month. */
  inPeriodRegister?: boolean;
};

function normCode(code: string): string {
  return cellStr(code).replace(/\s+/g, "").toUpperCase();
}

function normalizeWorkEmail(raw: string | null | undefined): string {
  return normalizeWorkEmailForSimilarity(raw);
}

export async function checkSimilarWorkEmails(input: {
  email: string;
  excludeEmployeeId?: number | null;
}): Promise<SimilarWorkEmailHit[]> {
  const email = normalizeWorkEmail(input.email);
  if (!email) return [];
  const roster = await query<{
    id: number;
    employee_code: string;
    name: string;
    email: string | null;
  }>(`SELECT id, employee_code, name, email FROM employees WHERE email IS NOT NULL AND trim(email) <> ''`);
  return findSimilarWorkEmailsAmong(email, roster, input.excludeEmployeeId ?? null);
}

function assertValidWorkEmail(raw: string | null | undefined): string {
  const email = normalizeWorkEmail(raw);
  if (!email) {
    throw Object.assign(new Error("Work email is required"), { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error("Enter a valid work email address"), { status: 400 });
  }
  return email;
}

function parseDateOfJoining(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") return undefined;
  const parsed = parseFlexibleDoj(raw);
  if (parsed) return parsed;
  if (!raw.trim()) return null;
  throw Object.assign(new Error("dateOfJoining must be DD-MM-YYYY"), { status: 400 });
}

function parseGender(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") return undefined;
  return cellStr(raw) || null;
}

function parseSalaryBase(raw: unknown): SalaryBaseFields | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  const inHand = Number(body.inHand);
  if (!Number.isFinite(inHand) || inHand <= 0) return null;
  const incrementPercent =
    body.incrementPercent != null && Number.isFinite(Number(body.incrementPercent))
      ? Number(body.incrementPercent)
      : null;
  return {
    ...staticSalaryFields({
      inHand,
      pfEmployee: Number(body.pfEmployee) || 0,
      esiEmployee: Number(body.esiEmployee) || 0,
      pt: body.pt != null && body.pt !== "" ? Number(body.pt) : DEFAULT_PM_PT,
      gratuity: Number(body.gratuity) || 0,
      employerPf: Number(body.employerPf) || 0,
      employerPfArr: Number(body.employerPfArr) || 0,
      employerEsi: Number(body.employerEsi) || 0,
    }),
    incrementPercent,
  };
}

function mapEmployeeRow(row: {
  id: number;
  employee_code: string;
  name: string;
  email: string | null;
  company: string | null;
  department: string | null;
  gender: string | null;
  date_of_joining: Date | string | null;
  date_of_leaving: Date | string | null;
  team_id: number | null;
  team_name: string | null;
  team_sort_order: number | null;
  team_manager_name: string | null;
  shift_start: string | null;
  status: string;
  updated_at: Date;
  in_hand?: number | null;
  pf_employee?: number | null;
  esi_employee?: number | null;
  pt?: number | null;
  gratuity?: number | null;
  employer_pf?: number | null;
  employer_pf_arr?: number | null;
  employer_esi?: number | null;
  increment_percent?: number | null;
  in_period_register?: boolean | null;
}): AdminEmployeeRecord {
  const today = calendarTodayIso();
  const dateOfLeaving = row.date_of_leaving
    ? new Date(row.date_of_leaving).toISOString().slice(0, 10)
    : null;
  const hasBase = row.in_hand != null;
  return {
    id: row.id,
    employeeCode: row.employee_code,
    name: row.name,
    email: row.email,
    company: row.company,
    department: row.department,
    gender: row.gender,
    dateOfJoining: row.date_of_joining
      ? new Date(row.date_of_joining).toISOString().slice(0, 10)
      : null,
    dateOfLeaving,
    effectiveStatus: effectiveEmploymentStatus(row.status, dateOfLeaving, today),
    teamId: row.team_id,
    teamName: row.team_name,
    teamSortOrder: row.team_sort_order ?? 9999,
    teamManagerName: row.team_manager_name,
    shiftStart: row.shift_start,
    status: row.status,
    salaryBase: hasBase
      ? {
          ...staticSalaryFields({
            inHand: Number(row.in_hand) || 0,
            pfEmployee: Number(row.pf_employee) || 0,
            esiEmployee: Number(row.esi_employee) || 0,
            pt: Number(row.pt) || 0,
            gratuity: Number(row.gratuity) || 0,
            employerPf: Number(row.employer_pf) || 0,
            employerPfArr: Number(row.employer_pf_arr) || 0,
            employerEsi: Number(row.employer_esi) || 0,
          }),
          incrementPercent:
            row.increment_percent != null && Number.isFinite(Number(row.increment_percent))
              ? Number(row.increment_percent)
              : null,
        }
      : null,
    updatedAt: new Date(row.updated_at).toISOString(),
    ...(row.in_period_register != null ? { inPeriodRegister: row.in_period_register } : {}),
  };
}

const employeeSelect = (companyParam: string, extraSelect = "") => `
  SELECT e.id, e.employee_code, e.name, e.email, e.company, e.department, e.gender,
         e.date_of_joining, e.date_of_leaving, e.team_id, t.name AS team_name, t.sort_order AS team_sort_order,
         tm.name AS team_manager_name, e.shift_start, e.status, e.updated_at,
         b.in_hand, b.pf_employee, b.esi_employee, b.pt, b.gratuity,
         b.employer_pf, b.employer_pf_arr, b.employer_esi, b.increment_percent${extraSelect}
  FROM employees e
  LEFT JOIN teams t ON t.id = e.team_id
  LEFT JOIN users tm ON tm.id = t.manager_user_id
  LEFT JOIN salary_base_profiles b
    ON b.employee_id = e.id AND b.company = ${companyParam}
`;

export type ListAdminEmployeesOptions = {
  company?: string;
  registerYear?: number;
  registerMonth?: number;
};

export async function listAdminEmployees(
  companyOrOpts?: string | ListAdminEmployeesOptions,
): Promise<AdminEmployeeRecord[]> {
  const opts: ListAdminEmployeesOptions =
    typeof companyOrOpts === "string" || companyOrOpts === undefined
      ? { company: companyOrOpts }
      : companyOrOpts;
  const companyNorm = opts.company?.trim() || "PM";
  const year = opts.registerYear;
  const month = opts.registerMonth;
  const periodOk =
    typeof year === "number" &&
    typeof month === "number" &&
    year >= 2000 &&
    month >= 1 &&
    month <= 12;
  const from = periodOk ? isoDate(year!, month!, 1) : null;
  const to = periodOk ? isoDate(year!, month!, daysInMonth(year!, month!)) : null;
  const registerSelect = periodOk
    ? `, EXISTS (
         SELECT 1 FROM daily_attendance d
         WHERE d.employee_id = e.id
           AND d.attendance_date BETWEEN $2::date AND $3::date
       ) AS in_period_register`
    : "";
  const params: unknown[] = periodOk ? [companyNorm, from, to] : [companyNorm];
  const rows = await query<Parameters<typeof mapEmployeeRow>[0]>(
    `${employeeSelect("$1", registerSelect)}
     WHERE (e.company = $1 OR e.company IS NULL OR e.company = '')
     ORDER BY COALESCE(t.sort_order, 9999), t.name NULLS LAST, e.employee_code`,
    params,
  );
  return rows.map(mapEmployeeRow);
}

export async function getAdminEmployee(id: number, company?: string): Promise<AdminEmployeeRecord | null> {
  const companyNorm = company?.trim() || "PM";
  const rows = await query<Parameters<typeof mapEmployeeRow>[0]>(
    `${employeeSelect("$2")}
     WHERE e.id = $1
       AND (e.company = $2 OR e.company IS NULL OR e.company = '')`,
    [id, companyNorm],
  );
  return rows[0] ? mapEmployeeRow(rows[0]) : null;
}

export async function createAdminEmployee(input: {
  employeeCode: string;
  name: string;
  email: string;
  company: string;
  department?: string;
  gender?: string | null;
  dateOfJoining?: string | null;
  teamId?: number | null;
  shiftStart?: string;
  status?: string;
  salaryBase?: SalaryBaseFields | null;
  actor: string;
}): Promise<AdminEmployeeRecord> {
  const code = normCode(input.employeeCode);
  const name = cellStr(input.name);
  const company = input.company.trim() || "PM";
  const email = assertValidWorkEmail(input.email);
  const department = cellStr(input.department ?? "") || null;
  const gender = cellStr(input.gender ?? "") || null;
  const dateOfJoining = parseFlexibleDoj(input.dateOfJoining ?? "") ?? null;
  const shiftStart = cellStr(input.shiftStart ?? "") || null;
  const status = cellStr(input.status ?? "active") || "active";

  if (!code) {
    throw Object.assign(new Error("Employee code is required"), { status: 400 });
  }
  if (!name) {
    throw Object.assign(new Error("Employee name is required"), { status: 400 });
  }

  const existing = await query<{ id: number }>(`SELECT id FROM employees WHERE employee_code = $1`, [code]);
  if (existing.length > 0) {
    throw Object.assign(new Error(`Employee code ${code} already exists`), { status: 409 });
  }

  const salaryBase = input.salaryBase ?? null;
  const grossSalary = salaryBase ? salaryBase.inHand + salaryBase.pt : null;

  const employeeId = await withTransaction(async (client) => {
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO employees (
         employee_code, name, email, company, department, gender, date_of_joining,
         shift_start, status, salary, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, NOW())
       RETURNING id`,
      [code, name, email, company, department, gender, dateOfJoining, shiftStart, status, grossSalary],
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new Error("Failed to create employee");

    if (salaryBase) {
      await saveEmployeeSalaryBaseProfile(id, company, salaryBase, input.actor, client);
    }

    await client.query(
      `INSERT INTO change_history (entity_type, entity_id, action, actor, before_json, after_json, note)
       VALUES ('employee', $1, 'create', $2, NULL, $3, 'admin employee onboarding')`,
      [id, input.actor, JSON.stringify({ code, name, company, department, shiftStart, status, salaryBase })],
    );

    return id;
  });

  const created = await getAdminEmployee(employeeId, company);
  if (!created) throw new Error("Failed to load created employee");
  if (input.teamId !== undefined) {
    await setEmployeeTeam(employeeId, input.teamId, input.actor);
    const refreshed = await getAdminEmployee(employeeId, company);
    if (refreshed) return refreshed;
  }
  return created;
}

export async function updateAdminEmployee(
  id: number,
  input: {
    employeeCode?: string;
    name?: string;
    email?: string | null;
    company?: string;
    department?: string | null;
    gender?: string | null;
    dateOfJoining?: string | null;
    dateOfLeaving?: string | null;
    shiftStart?: string | null;
    status?: string;
    salaryBase?: SalaryBaseFields | null;
    teamId?: number | null;
    actor: string;
  },
): Promise<AdminEmployeeRecord | null> {
  const existing = await query<{
    id: number;
    employee_code: string;
    name: string;
    email: string | null;
    company: string | null;
    department: string | null;
    gender: string | null;
    date_of_joining: Date | string | null;
    date_of_leaving: Date | string | null;
    shift_start: string | null;
    status: string;
  }>(`SELECT * FROM employees WHERE id = $1`, [id]);
  const emp = existing[0];
  if (!emp) return null;

  const nextCode =
    input.employeeCode !== undefined ? normCode(input.employeeCode) : normCode(emp.employee_code);
  const nextName = input.name !== undefined ? cellStr(input.name) : emp.name;
  const nextEmail =
    input.email !== undefined ? assertValidWorkEmail(input.email) : assertValidWorkEmail(emp.email);
  const nextCompany =
    input.company !== undefined ? input.company.trim() || "PM" : emp.company?.trim() || "PM";
  const nextDepartment =
    input.department !== undefined ? cellStr(input.department ?? "") || null : emp.department;
  const nextGender = input.gender !== undefined ? cellStr(input.gender ?? "") || null : emp.gender;
  const nextDateOfJoining =
    input.dateOfJoining !== undefined
      ? parseFlexibleDoj(input.dateOfJoining) ?? null
      : emp.date_of_joining
        ? new Date(emp.date_of_joining).toISOString().slice(0, 10)
        : null;
  const nextDateOfLeaving =
    input.dateOfLeaving !== undefined
      ? parseDateOfLeavingInput(input.dateOfLeaving) ?? null
      : emp.date_of_leaving
        ? new Date(emp.date_of_leaving).toISOString().slice(0, 10)
        : null;
  const nextShiftStart =
    input.shiftStart !== undefined ? cellStr(input.shiftStart ?? "") || null : emp.shift_start;
  const nextStatus = input.status !== undefined ? cellStr(input.status) || emp.status : emp.status;

  if (!nextCode) {
    throw Object.assign(new Error("Employee code is required"), { status: 400 });
  }
  if (!nextName) {
    throw Object.assign(new Error("Employee name is required"), { status: 400 });
  }

  if (nextCode !== normCode(emp.employee_code)) {
    const clash = await query<{ id: number }>(
      `SELECT id FROM employees WHERE employee_code = $1 AND id <> $2`,
      [nextCode, id],
    );
    if (clash.length > 0) {
      throw Object.assign(new Error(`Employee code ${nextCode} already exists`), { status: 409 });
    }
  }

  const salaryBase =
    input.salaryBase === undefined
      ? await loadEmployeeSalaryBaseProfile(id, nextCompany)
      : input.salaryBase;

  const existingSalary = await query<{ salary: number | null }>(
    `SELECT salary FROM employees WHERE id = $1`,
    [id],
  );
  let grossSalary = existingSalary[0]?.salary ?? null;
  if (input.salaryBase !== undefined) {
    grossSalary = salaryBase ? salaryBase.inHand + salaryBase.pt : null;
  } else if (salaryBase) {
    grossSalary = salaryBase.inHand + salaryBase.pt;
  }

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE employees
       SET employee_code = $1, name = $2, email = $3, company = $4, department = $5,
           gender = $6, date_of_joining = $7::date, date_of_leaving = $8::date, shift_start = $9,
           status = $10, salary = $11, updated_at = NOW()
       WHERE id = $12`,
      [
        nextCode,
        nextName,
        nextEmail,
        nextCompany,
        nextDepartment,
        nextGender,
        nextDateOfJoining,
        nextDateOfLeaving,
        nextShiftStart,
        nextStatus,
        salaryBase ? salaryBase.inHand + salaryBase.pt : null,
        id,
      ],
    );

    if (input.salaryBase !== undefined) {
      if (salaryBase) {
        await saveEmployeeSalaryBaseProfile(id, nextCompany, salaryBase, input.actor, client);
      } else {
        await client.query(`DELETE FROM salary_base_profiles WHERE company = $1 AND employee_id = $2`, [
          nextCompany,
          id,
        ]);
      }
    }

    const fieldsForSheetSync =
      input.salaryBase !== undefined ? input.salaryBase : salaryBase;
    if (fieldsForSheetSync && fieldsForSheetSync.inHand > 0) {
      await syncEmployeeSalaryFieldsToAllSheetRows(client, {
        company: nextCompany,
        employeeId: id,
        fields: fieldsForSheetSync,
        actor: input.actor,
      });
    }

    await client.query(
      `INSERT INTO change_history (entity_type, entity_id, action, actor, before_json, after_json, note)
       VALUES ('employee', $1, 'update', $2, $3, $4, 'admin employee profile')`,
      [
        id,
        input.actor,
        JSON.stringify(emp),
        JSON.stringify({
          employeeCode: nextCode,
          name: nextName,
          email: nextEmail,
          company: nextCompany,
          department: nextDepartment,
          gender: nextGender,
          dateOfJoining: nextDateOfJoining,
          dateOfLeaving: nextDateOfLeaving,
          shiftStart: nextShiftStart,
          status: nextStatus,
          salaryBase,
        }),
      ],
    );
  });

  if (input.teamId !== undefined) {
    await setEmployeeTeam(id, input.teamId, input.actor);
  }

  if (input.dateOfLeaving !== undefined && nextDateOfLeaving) {
    await processDueOffboardingForEmployee(id, input.actor);
  }

  return getAdminEmployee(id, nextCompany);
}

export function parseAdminEmployeeBody(body: Record<string, unknown>): {
  employeeCode?: string;
  name?: string;
  email?: string | null;
  company?: string;
  department?: string | null;
  gender?: string | null;
  dateOfJoining?: string | null;
  dateOfLeaving?: string | null;
  teamId?: number | null;
  shiftStart?: string | null;
  status?: string;
  salaryBase?: SalaryBaseFields | null;
} {
  return {
    employeeCode: typeof body.employeeCode === "string" ? body.employeeCode : undefined,
    name: typeof body.name === "string" ? body.name : undefined,
    email:
      body.email === null || typeof body.email === "string"
        ? (body.email as string | null)
        : undefined,
    company: typeof body.company === "string" ? body.company : undefined,
    department:
      body.department === null || typeof body.department === "string"
        ? (body.department as string | null)
        : undefined,
    gender: parseGender(body.gender),
    dateOfJoining: parseDateOfJoining(body.dateOfJoining),
    dateOfLeaving: parseDateOfLeavingInput(body.dateOfLeaving),
    teamId:
      body.teamId === null
        ? null
        : body.teamId !== undefined
          ? Number.parseInt(String(body.teamId), 10) || null
          : undefined,
    shiftStart:
      body.shiftStart === null || typeof body.shiftStart === "string"
        ? (body.shiftStart as string | null)
        : undefined,
    status: typeof body.status === "string" ? body.status : undefined,
    salaryBase: body.salaryBase === null ? null : parseSalaryBase(body.salaryBase),
  };
}
