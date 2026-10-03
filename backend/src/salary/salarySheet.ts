import type pg from "pg";
import { query, withTransaction } from "../db/index.js";
import { cellStr } from "../persist/helpers.js";
import {
  getSalaryCalculationStatus,
  loadPmAttendanceSnapshotForSalary,
  payDaysZeroWarning,
} from "./attendanceFingerprint.js";
import {
  checkApprovedAttendanceForEmployees,
} from "./approvedAttendance.js";
import { loadBaseProfileMap, loadIncrementCycleMap, staticSalaryFields, defaultPmStatutoryFields } from "./salaryBase.js";
import { resolvePayrollIncrement } from "./incrementPayroll.js";
import {
  INCREMENT_CYCLE_MONTHS,
  applyIncrementCycleToRow,
  isPayrollMonthInIncrementCycle,
  persistIncrementCycle,
  propagateIncrementToCycleSheetRows,
  type IncrementCycle,
} from "./incrementCycle.js";
import { calculatePmSalary, type PmSalaryInput } from "./pmSalaryCalculator.js";
import { validatePeriod } from "./salaryValidator.js";
import type { SalaryUploadRow } from "./types.js";

export type SalarySheetInputRow = {
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  department?: string | null;
  gender?: string | null;
  dateOfJoining?: string | null;
  process?: string | null;
  status?: string | null;
  inHand: number;
  pfEmployee: number;
  esiEmployee: number;
  pt: number;
  gratuity: number;
  employerPf: number;
  employerPfArr: number;
  employerEsi: number;
  otherEarning: number;
  incrementPercent?: number | null;
  increment: number;
  teamId?: number | null;
  teamName?: string | null;
  teamSortOrder?: number | null;
  teamManagerName?: string | null;
};

export type SalarySheetRow = SalarySheetInputRow & {
  matched: boolean;
  errors: string[];
  warnings: string[];
  preview?: ReturnType<typeof calculatePmSalary>;
};

export type SalarySheetResponse = {
  year: number;
  month: number;
  company: string;
  rows: SalarySheetRow[];
  summary: {
    totalRows: number;
    matchedRows: number;
    errorRows: number;
    blockedByApproval: number;
    canCalculate: boolean;
    savedAt: string | null;
    savedBy: string | null;
    hasAttendanceData: boolean;
    hasSalaryResults: boolean;
    lastCalculatedAt: string | null;
    attendanceStale: boolean;
    staleMessage: string | null;
  };
};

function normCode(code: string): string {
  return cellStr(code).replace(/\s+/g, "").toUpperCase();
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function withResolvedIncrement<T extends SalarySheetInputRow>(row: T): T {
  const resolved = resolvePayrollIncrement(row);
  return {
    ...row,
    incrementPercent: resolved.incrementPercent,
    increment: resolved.increment,
  };
}

function pmFromInput(row: SalarySheetInputRow): PmSalaryInput {
  const resolved = withResolvedIncrement(row);
  return {
    employeeCode: resolved.employeeCode,
    employeeName: resolved.employeeName,
    inHand: resolved.inHand,
    pfEmployee: resolved.pfEmployee,
    esiEmployee: resolved.esiEmployee,
    pt: resolved.pt,
    gratuity: resolved.gratuity,
    employerPf: resolved.employerPf,
    employerPfArr: resolved.employerPfArr,
    employerEsi: resolved.employerEsi,
    otherEarning: resolved.otherEarning,
    increment: resolved.increment,
  };
}

function validateSheetInput(row: SalarySheetInputRow): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!row.employeeCode) errors.push("Employee code is required");
  if (!Number.isFinite(row.inHand) || row.inHand <= 0) {
    errors.push("In Hand must be a positive number");
  }
  return { errors, warnings };
}

function sheetRowToUploadRow(row: SalarySheetRow, rowNumber: number): SalaryUploadRow {
  const pm = pmFromInput(row);
  return {
    rowNumber,
    employeeCode: row.employeeCode,
    employeeName: row.employeeName,
    grossSalary: row.inHand,
    adjustment: row.otherEarning + row.increment,
    pm,
    errors: row.errors,
    warnings: row.warnings,
    matched: row.matched,
    employeeId: row.employeeId,
    dbEmployeeName: row.employeeName,
  };
}

export function sheetRowsToUploadRows(rows: SalarySheetRow[]): SalaryUploadRow[] {
  return rows.map((r, i) => sheetRowToUploadRow(r, i + 1));
}

async function loadSavedSheetMap(
  year: number,
  month: number,
  company: string,
): Promise<Map<number, SalarySheetInputRow>> {
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
    other_earning: number;
    increment: number;
    increment_percent: number | null;
  }>(
    `SELECT s.*, e.employee_code, e.name
     FROM salary_sheet_rows s
     JOIN employees e ON e.id = s.employee_id
     WHERE s.year = $1 AND s.month = $2 AND s.company = $3`,
    [year, month, company],
  );

  const map = new Map<number, SalarySheetInputRow>();
  for (const r of rows) {
    map.set(r.employee_id, {
      employeeId: r.employee_id,
      employeeCode: r.employee_code,
      employeeName: r.name,
      inHand: Number(r.in_hand) || 0,
      pfEmployee: Number(r.pf_employee) || 0,
      esiEmployee: Number(r.esi_employee) || 0,
      pt: Number(r.pt) || 0,
      gratuity: Number(r.gratuity) || 0,
      employerPf: Number(r.employer_pf) || 0,
      employerPfArr: Number(r.employer_pf_arr) || 0,
      employerEsi: Number(r.employer_esi) || 0,
      otherEarning: Number(r.other_earning) || 0,
      incrementPercent:
        r.increment_percent != null && Number.isFinite(Number(r.increment_percent))
          ? Number(r.increment_percent)
          : null,
      increment: Number(r.increment) || 0,
    });
    const resolved = withResolvedIncrement(map.get(r.employee_id)!);
    map.set(r.employee_id, resolved);
  }
  return map;
}

async function loadPreviousMonthSheetMap(
  year: number,
  month: number,
  company: string,
): Promise<Map<number, SalarySheetInputRow>> {
  let py = year;
  let pm = month - 1;
  if (pm < 1) {
    pm = 12;
    py -= 1;
  }
  return loadSavedSheetMap(py, pm, company);
}

type IncrementCarrySource = {
  incrementPercent: number | null;
  increment: number;
  sourceYear: number;
  sourceMonth: number;
};

function incrementCarryIsActive(row: {
  incrementPercent?: number | null;
  increment: number;
}): boolean {
  return (row.incrementPercent != null && row.incrementPercent > 0) || row.increment > 0;
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Latest saved increment per employee before this payroll month (active increments only). */
async function loadLatestIncrementCarryMap(
  year: number,
  month: number,
  company: string,
): Promise<Map<number, IncrementCarrySource>> {
  const rows = await query<{
    employee_id: number;
    increment: number;
    increment_percent: number | null;
    year: number;
    month: number;
  }>(
    `SELECT DISTINCT ON (s.employee_id)
       s.employee_id, s.increment, s.increment_percent, s.year, s.month
     FROM salary_sheet_rows s
     WHERE s.company = $1
       AND (s.year < $2 OR (s.year = $2 AND s.month < $3))
     ORDER BY s.employee_id, s.year DESC, s.month DESC`,
    [company, year, month],
  );

  const map = new Map<number, IncrementCarrySource>();
  for (const r of rows) {
    const incrementPercent =
      r.increment_percent != null && Number.isFinite(Number(r.increment_percent))
        ? Number(r.increment_percent)
        : null;
    const increment = Number(r.increment) || 0;
    if (!incrementCarryIsActive({ incrementPercent, increment })) continue;
    if (
      !isPayrollMonthInIncrementCycle(r.year, r.month, year, month)
    ) {
      continue;
    }
    map.set(r.employee_id, {
      incrementPercent,
      increment,
      sourceYear: r.year,
      sourceMonth: r.month,
    });
  }
  return map;
}

function mergeRowIncrementFromCarry(
  row: SalarySheetInputRow,
  carry: Map<number, IncrementCarrySource>,
  cycle: IncrementCycle | undefined,
  year: number,
  month: number,
): SalarySheetInputRow {
  if (incrementCarryIsActive(row)) {
    return withResolvedIncrement(row);
  }
  if (cycle && isPayrollMonthInIncrementCycle(cycle.incrementFromYear, cycle.incrementFromMonth, year, month)) {
    return withResolvedIncrement(applyIncrementCycleToRow(row, cycle, year, month));
  }
  const source = carry.get(row.employeeId);
  if (!source) {
    return withResolvedIncrement({ ...row, incrementPercent: null, increment: 0 });
  }
  return withResolvedIncrement({
    ...row,
    incrementPercent: source.incrementPercent,
    increment: source.increment,
  });
}

function applyIncrementCarryForward(
  row: BuiltSheetRow,
  carry: Map<number, IncrementCarrySource>,
  cycle: IncrementCycle | undefined,
  year: number,
  month: number,
): BuiltSheetRow {
  if (incrementCarryIsActive(row)) {
    return { ...withResolvedIncrement(row), seedWarnings: row.seedWarnings };
  }

  if (cycle && isPayrollMonthInIncrementCycle(cycle.incrementFromYear, cycle.incrementFromMonth, year, month)) {
    const merged = withResolvedIncrement(applyIncrementCycleToRow(row, cycle, year, month));
    const label = `${MONTH_SHORT[cycle.incrementFromMonth - 1] ?? cycle.incrementFromMonth} ${cycle.incrementFromYear}`;
    const cycleNote = `Increment from ${label} (${INCREMENT_CYCLE_MONTHS}-month cycle; edit Inc. % or amount here to override this month).`;
    return {
      ...merged,
      seedWarnings: [...(row.seedWarnings ?? []), cycleNote],
    };
  }

  const source = carry.get(row.employeeId);
  if (!source) {
    return { ...withResolvedIncrement({ ...row, incrementPercent: null, increment: 0 }), seedWarnings: row.seedWarnings };
  }
  const merged = mergeRowIncrementFromCarry(row, carry, cycle, year, month);
  const label = `${MONTH_SHORT[source.sourceMonth - 1] ?? source.sourceMonth} ${source.sourceYear}`;
  const carryNote = `Increment continues from ${label} (${INCREMENT_CYCLE_MONTHS}-month cycle; edit Inc. % or amount here to override this month).`;
  return {
    ...merged,
    seedWarnings: [...(row.seedWarnings ?? []), carryNote],
  };
}

async function loadRegisterEmployees(company: string) {
  return query<{
    id: number;
    employee_code: string;
    name: string;
    salary: number | null;
    company: string | null;
    department: string | null;
    gender: string | null;
    date_of_joining: Date | null;
    status: string;
    team_id: number | null;
    team_name: string | null;
    team_sort_order: number | null;
    team_manager_name: string | null;
  }>(
    company.trim()
      ? `SELECT e.id, e.employee_code, e.name, e.salary, e.company, e.department, e.gender,
                e.date_of_joining, e.status,
                e.team_id, t.name AS team_name, t.sort_order AS team_sort_order,
                mu.name AS team_manager_name
         FROM employees e
         LEFT JOIN teams t ON t.id = e.team_id
         LEFT JOIN users mu ON mu.id = t.manager_user_id
         WHERE e.status = 'active' AND (e.company = $1 OR e.company IS NULL OR e.company = '')
         ORDER BY e.employee_code`
      : `SELECT e.id, e.employee_code, e.name, e.salary, e.company, e.department, e.gender,
                e.date_of_joining, e.status,
                e.team_id, t.name AS team_name, t.sort_order AS team_sort_order,
                mu.name AS team_manager_name
         FROM employees e
         LEFT JOIN teams t ON t.id = e.team_id
         LEFT JOIN users mu ON mu.id = t.manager_user_id
         WHERE e.status = 'active'
         ORDER BY e.employee_code`,
    company.trim() ? [company.trim()] : [],
  );
}

function employeeMeta(emp: Awaited<ReturnType<typeof loadRegisterEmployees>>[0], companyNorm: string) {
  return {
    department: emp.department,
    gender: emp.gender,
    dateOfJoining: emp.date_of_joining
      ? new Date(emp.date_of_joining).toISOString().slice(0, 10)
      : null,
    process: emp.company?.trim() || companyNorm,
    status: emp.status,
    teamId: emp.team_id,
    teamName: emp.team_name,
    teamSortOrder: emp.team_sort_order,
    teamManagerName: emp.team_manager_name,
  };
}

type BuiltSheetRow = SalarySheetInputRow & { seedWarnings?: string[] };

type StaticSalaryFields = ReturnType<typeof staticSalaryFields>;

function statutoryFieldsDiffer(a: StaticSalaryFields, b: StaticSalaryFields): boolean {
  return (
    a.pfEmployee !== b.pfEmployee ||
    a.esiEmployee !== b.esiEmployee ||
    a.pt !== b.pt ||
    a.gratuity !== b.gratuity ||
    a.employerPf !== b.employerPf ||
    a.employerPfArr !== b.employerPfArr ||
    a.employerEsi !== b.employerEsi
  );
}

function mergeStatutoryFromAdminProfile(
  fields: StaticSalaryFields,
  profile: SalarySheetInputRow | undefined,
): { fields: StaticSalaryFields; syncedFromAdmin: boolean } {
  if (!profile) return { fields, syncedFromAdmin: false };
  const fromProfile = staticSalaryFields(profile);
  const merged: StaticSalaryFields = {
    inHand: fromProfile.inHand > 0 ? fromProfile.inHand : fields.inHand,
    pfEmployee: fromProfile.pfEmployee,
    esiEmployee: fromProfile.esiEmployee,
    pt: fromProfile.pt,
    gratuity: fromProfile.gratuity,
    employerPf: fromProfile.employerPf,
    employerPfArr: fromProfile.employerPfArr,
    employerEsi: fromProfile.employerEsi,
  };
  return {
    fields: merged,
    syncedFromAdmin:
      statutoryFieldsDiffer(fields, merged) ||
      (fromProfile.inHand > 0 && fromProfile.inHand !== fields.inHand),
  };
}

async function buildBaseSheetRows(
  year: number,
  month: number,
  company: string,
): Promise<BuiltSheetRow[]> {
  const companyNorm = company.trim() || "PM";
  const saved = await loadSavedSheetMap(year, month, companyNorm);
  const baseProfiles = await loadBaseProfileMap(companyNorm);
  const previous = await loadPreviousMonthSheetMap(year, month, companyNorm);
  const incrementCarry = await loadLatestIncrementCarryMap(year, month, companyNorm);
  const incrementCycles = await loadIncrementCycleMap(companyNorm);
  const emps = await loadRegisterEmployees(companyNorm);

  return emps.map((emp) => {
    const cycle = incrementCycles.get(emp.id);
    const meta = employeeMeta(emp, companyNorm);
    const hit = saved.get(emp.id);
    const profile = baseProfiles.get(emp.id);
    if (hit) {
      const seedWarnings: string[] = [];
      let staticFields = staticSalaryFields(hit);
      if (hit.inHand <= 0) {
        if (profile && profile.inHand > 0) {
          staticFields = { ...staticFields, inHand: profile.inHand };
          seedWarnings.push(
            "Base salary loaded from Admin → People (saved sheet had In Hand as zero). Save the sheet to keep it for this month.",
          );
        } else if (emp.salary != null && Number.isFinite(Number(emp.salary)) && Number(emp.salary) > 0) {
          staticFields = { ...staticFields, inHand: Number(emp.salary) };
          seedWarnings.push(
            "In Hand loaded from employee profile (saved sheet had zero). Save the sheet to keep it for this month.",
          );
        }
      }
      const adminStatutory = mergeStatutoryFromAdminProfile(staticFields, profile);
      staticFields = adminStatutory.fields;
      if (adminStatutory.syncedFromAdmin) {
        seedWarnings.push(
          "In Hand / PF / ESI / PT / gratuity loaded from Admin → People (saved sheet had older values). Save the sheet to persist for this month.",
        );
      }
      let built: BuiltSheetRow = {
        employeeId: emp.id,
        employeeCode: emp.employee_code,
        employeeName: emp.name,
        ...meta,
        ...staticFields,
        otherEarning: hit.otherEarning,
        incrementPercent: hit.incrementPercent ?? null,
        increment: hit.increment,
        seedWarnings: seedWarnings.length ? seedWarnings : undefined,
      };
      if (!incrementCarryIsActive(built)) {
        built = applyIncrementCarryForward(built, incrementCarry, cycle, year, month);
      } else {
        built = { ...withResolvedIncrement(built), seedWarnings: built.seedWarnings };
      }
      return built;
    }

    let built: BuiltSheetRow;

    if (profile) {
      built = {
        ...profile,
        ...meta,
        employeeId: emp.id,
        employeeCode: emp.employee_code,
        employeeName: emp.name,
        otherEarning: 0,
        increment: 0,
        incrementPercent: null,
      };
    } else {
      const prev = previous.get(emp.id);
      if (prev) {
        const fromPrev = staticSalaryFields(prev);
        const { fields: staticFromPrev } = mergeStatutoryFromAdminProfile(fromPrev, profile);
        built = {
          employeeId: emp.id,
          employeeCode: emp.employee_code,
          employeeName: emp.name,
          ...meta,
          ...staticFromPrev,
          otherEarning: 0,
          increment: 0,
          incrementPercent: null,
        };
      } else {
        const inHand = emp.salary != null && Number.isFinite(Number(emp.salary)) ? Number(emp.salary) : 0;
        built = {
          employeeId: emp.id,
          employeeCode: emp.employee_code,
          employeeName: emp.name,
          ...meta,
          inHand,
          ...defaultPmStatutoryFields(),
          otherEarning: 0,
          increment: 0,
          incrementPercent: null,
        };
      }
    }

    return applyIncrementCarryForward(built, incrementCarry, cycle, year, month);
  });
}

async function enrichWithApprovalGate(
  rows: SalarySheetRow[],
  year: number,
  month: number,
): Promise<SalarySheetRow[]> {
  const ids = rows.map((r) => r.employeeId);
  if (ids.length === 0) return rows;
  return withTransaction(async (client) => {
    const checks = await checkApprovedAttendanceForEmployees(client, ids, year, month);
    return rows.map((row) => {
      const check = checks.get(row.employeeId);
      if (!check || check.ok) return row;
      const approvalWarnings = check.issues.map(
        (i) => `${i.message} (salary still uses uploaded monthly attendance)`,
      );
      return {
        ...row,
        warnings: [...row.warnings, ...approvalWarnings],
      };
    });
  });
}

async function addPreviews(
  rows: SalarySheetRow[],
  year: number,
  month: number,
  client?: pg.PoolClient,
): Promise<SalarySheetRow[]> {
  const run = async (c: pg.PoolClient) => {
    const out: SalarySheetRow[] = [];
    for (const row of rows) {
      if (row.errors.length > 0 || !row.matched) {
        out.push(row);
        continue;
      }
      const attendance = await loadPmAttendanceSnapshotForSalary(c, row.employeeId, year, month);
      const preview = calculatePmSalary(pmFromInput(row), attendance, year, month);
      const payWarn = await payDaysZeroWarning(c, row.employeeId, year, month, preview.payDays);
      const warnings = payWarn ? [...row.warnings, payWarn] : row.warnings;
      out.push({ ...row, preview, warnings });
    }
    return out;
  };
  if (client) return run(client);
  return withTransaction(run);
}

function summarizeSheet(
  rows: SalarySheetRow[],
  savedAt: string | null,
  savedBy: string | null,
  calcStatus: Awaited<ReturnType<typeof getSalaryCalculationStatus>>,
) {
  const matchedRows = rows.filter((r) => r.matched && r.errors.length === 0);
  const blockedByApproval = rows.filter((r) =>
    r.warnings.some((w) => w.includes("approve and lock weekly attendance")),
  ).length;
  return {
    totalRows: rows.length,
    matchedRows: matchedRows.length,
    errorRows: rows.length - rows.filter((r) => r.errors.length === 0).length,
    blockedByApproval,
    canCalculate: matchedRows.length > 0 && calcStatus.hasAttendanceData,
    savedAt,
    savedBy,
    hasAttendanceData: calcStatus.hasAttendanceData,
    hasSalaryResults: calcStatus.hasSalaryResults,
    lastCalculatedAt: calcStatus.lastCalculatedAt,
    attendanceStale: calcStatus.attendanceStale,
    staleMessage: calcStatus.staleMessage,
  };
}

export async function loadSalarySheet(input: {
  year: number;
  month: number;
  company: string;
  withPreview?: boolean;
}): Promise<SalarySheetResponse> {
  validatePeriod(input.year, input.month);
  const company = input.company.trim() || "PM";

  const meta = await query<{ updated_at: Date; updated_by: string | null }>(
    `SELECT MAX(updated_at) AS updated_at,
            (ARRAY_AGG(updated_by ORDER BY updated_at DESC))[1] AS updated_by
     FROM salary_sheet_rows
     WHERE year = $1 AND month = $2 AND company = $3`,
    [input.year, input.month, company],
  );
  const savedAt = meta[0]?.updated_at ? new Date(meta[0].updated_at).toISOString() : null;
  const savedBy = meta[0]?.updated_by ?? null;

  const base = await buildBaseSheetRows(input.year, input.month, company);
  let rows: SalarySheetRow[] = base.map((r) => {
    const { seedWarnings, ...row } = r;
    const { errors, warnings } = validateSheetInput(row);
    return {
      ...row,
      matched: errors.length === 0,
      errors,
      warnings: [...warnings, ...(seedWarnings ?? [])],
    };
  });
  rows = await enrichWithApprovalGate(rows, input.year, input.month);
  if (input.withPreview !== false) {
    rows = await addPreviews(rows, input.year, input.month);
  }

  const calcStatus = await getSalaryCalculationStatus(input.year, input.month, company);

  return {
    year: input.year,
    month: input.month,
    company,
    rows,
    summary: summarizeSheet(rows, savedAt, savedBy, calcStatus),
  };
}

export async function saveSalarySheet(input: {
  year: number;
  month: number;
  company: string;
  rows: SalarySheetInputRow[];
  actor: string;
}): Promise<SalarySheetResponse> {
  validatePeriod(input.year, input.month);
  const company = input.company.trim() || "PM";
  const incrementCarry = await loadLatestIncrementCarryMap(input.year, input.month, company);
  const incrementCycles = await loadIncrementCycleMap(company);

  await withTransaction(async (client) => {
    for (const row of input.rows) {
      if (!row.employeeId) continue;
      const clientActive = incrementCarryIsActive(row);
      const cycle = incrementCycles.get(row.employeeId);
      const resolved = clientActive
        ? withResolvedIncrement(row)
        : mergeRowIncrementFromCarry(row, incrementCarry, cycle, input.year, input.month);
      await client.query(
        `INSERT INTO salary_sheet_rows (
           year, month, company, employee_id,
           in_hand, pf_employee, esi_employee, pt, gratuity,
           employer_pf, employer_pf_arr, employer_esi, other_earning, increment, increment_percent,
           updated_by, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
         ON CONFLICT (year, month, company, employee_id) DO UPDATE SET
           in_hand = EXCLUDED.in_hand,
           pf_employee = EXCLUDED.pf_employee,
           esi_employee = EXCLUDED.esi_employee,
           pt = EXCLUDED.pt,
           gratuity = EXCLUDED.gratuity,
           employer_pf = EXCLUDED.employer_pf,
           employer_pf_arr = EXCLUDED.employer_pf_arr,
           employer_esi = EXCLUDED.employer_esi,
           other_earning = EXCLUDED.other_earning,
           increment = EXCLUDED.increment,
           increment_percent = EXCLUDED.increment_percent,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
        [
          input.year,
          input.month,
          company,
          row.employeeId,
          resolved.inHand,
          resolved.pfEmployee,
          resolved.esiEmployee,
          resolved.pt,
          resolved.gratuity,
          resolved.employerPf,
          resolved.employerPfArr,
          resolved.employerEsi,
          resolved.otherEarning,
          resolved.increment,
          resolved.incrementPercent,
          input.actor,
        ],
      );

      if (clientActive) {
        await persistIncrementCycle(client, {
          company,
          employeeId: row.employeeId,
          fromYear: input.year,
          fromMonth: input.month,
          incrementPercent: resolved.incrementPercent ?? null,
          increment: resolved.increment,
          actor: input.actor,
        });
        await propagateIncrementToCycleSheetRows(client, {
          company,
          employeeId: row.employeeId,
          fromYear: input.year,
          fromMonth: input.month,
          incrementPercent: resolved.incrementPercent ?? null,
          increment: resolved.increment,
          actor: input.actor,
        });
      }
    }
  });

  return loadSalarySheet({ year: input.year, month: input.month, company, withPreview: true });
}

export async function previewSalarySheet(input: {
  year: number;
  month: number;
  company: string;
  rows: SalarySheetInputRow[];
}): Promise<SalarySheetResponse> {
  validatePeriod(input.year, input.month);
  const company = input.company.trim() || "PM";
  const byId = new Map(input.rows.map((r) => [r.employeeId, r]));

  const base = await buildBaseSheetRows(input.year, input.month, company);
  let rows: SalarySheetRow[] = base.map((r) => {
    const { seedWarnings, ...built } = r;
    const patch = byId.get(built.employeeId);
    const merged = patch
      ? { ...built, ...patch, employeeCode: built.employeeCode, employeeName: built.employeeName }
      : built;
    const resolved = withResolvedIncrement(merged);
    const { errors, warnings } = validateSheetInput(resolved);
    return {
      ...resolved,
      matched: errors.length === 0,
      errors,
      warnings: [...warnings, ...(seedWarnings ?? [])],
    };
  });
  rows = await enrichWithApprovalGate(rows, input.year, input.month);
  rows = await addPreviews(rows, input.year, input.month);
  const calcStatus = await getSalaryCalculationStatus(input.year, input.month, company);

  return {
    year: input.year,
    month: input.month,
    company,
    rows,
    summary: summarizeSheet(rows, null, null, calcStatus),
  };
}

export async function exportSalarySheetWorkbook(input: {
  year: number;
  month: number;
  company: string;
  useResults?: boolean;
}): Promise<{ buffer: Buffer; fileName: string; rowCount: number }> {
  validatePeriod(input.year, input.month);
  const company = input.company.trim() || "PM";
  const sheet = await loadSalarySheet({ ...input, company, withPreview: true });

  if (input.useResults) {
    const { listSalaryResults } = await import("./salaryService.js");
    const results = await listSalaryResults({ year: input.year, month: input.month, company });
    if (results.rows.length > 0) {
      const byId = new Map(results.rows.map((r) => [r.employeeId, r]));
      sheet.rows = sheet.rows.map((row) => {
        const hit = byId.get(row.employeeId);
        if (!hit?.pm) return row;
        return { ...row, preview: hit.pm };
      });
    }
  }

  const eligible = sheet.rows.filter((r) => r.matched && r.errors.length === 0);
  const { buildPmSalaryWorkbookBuffer } = await import("./salaryExcelExport.js");
  const buffer = buildPmSalaryWorkbookBuffer(eligible);
  const fileName = `salary-${company}-${input.year}-${String(input.month).padStart(2, "0")}.xlsx`;
  return { buffer, fileName, rowCount: eligible.length };
}

export async function loadSalarySheetAsUploadRows(input: {
  year: number;
  month: number;
  company: string;
}): Promise<{ rows: SalaryUploadRow[]; year: number; month: number; company: string } | null> {
  const company = input.company.trim() || "PM";
  const hasSaved = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM salary_sheet_rows WHERE year = $1 AND month = $2 AND company = $3`,
    [input.year, input.month, company],
  );
  if ((hasSaved[0]?.n ?? 0) === 0) return null;

  const sheet = await loadSalarySheet({ ...input, company, withPreview: false });
  return {
    rows: sheetRowsToUploadRows(sheet.rows),
    year: sheet.year,
    month: sheet.month,
    company: sheet.company,
  };
}

export async function saveSalarySheetRow(input: {
  year: number;
  month: number;
  company: string;
  row: SalarySheetInputRow;
  actor: string;
}): Promise<SalarySheetRow> {
  const sheet = await saveSalarySheet({
    year: input.year,
    month: input.month,
    company: input.company,
    rows: [input.row],
    actor: input.actor,
  });
  const hit = sheet.rows.find((r) => r.employeeId === input.row.employeeId);
  if (!hit) {
    throw Object.assign(new Error("Employee not found on salary sheet"), { status: 404 });
  }
  return hit;
}

export function parseSheetInputRows(value: unknown): SalarySheetInputRow[] {
  if (!Array.isArray(value)) return [];
  const out: SalarySheetInputRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const employeeId = Number(row.employeeId);
    if (!Number.isFinite(employeeId) || employeeId <= 0) continue;
    const num = (k: string) => {
      const n = Number(row[k]);
      return Number.isFinite(n) ? n : 0;
    };
    out.push({
      employeeId,
      employeeCode: typeof row.employeeCode === "string" ? row.employeeCode.trim() : "",
      employeeName: typeof row.employeeName === "string" ? row.employeeName.trim() : "",
      inHand: num("inHand"),
      pfEmployee: num("pfEmployee"),
      esiEmployee: num("esiEmployee"),
      pt: num("pt"),
      gratuity: num("gratuity"),
      employerPf: num("employerPf"),
      employerPfArr: num("employerPfArr"),
      employerEsi: num("employerEsi"),
      otherEarning: num("otherEarning"),
      incrementPercent:
        row.incrementPercent != null && Number.isFinite(Number(row.incrementPercent))
          ? Number(row.incrementPercent)
          : null,
      increment: num("increment"),
    });
  }
  return out;
}
