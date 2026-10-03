import { randomUUID } from "crypto";
import type pg from "pg";
import { query, withTransaction } from "../db/index.js";
import { cellStr } from "../persist/helpers.js";
import {
  buildValidatedRows,
  parseSalaryExcel,
  SalaryValidationError,
  validatePeriod,
} from "./salaryValidator.js";
import {
  calculatePmSalary,
  type PmSalaryInput,
} from "./pmSalaryCalculator.js";
import {
  checkApprovedAttendanceForEmployees,
} from "./approvedAttendance.js";
import {
  getSalaryCalculationStatus,
  loadPmAttendanceSnapshotForSalary,
  recordSalaryCalculationRun,
} from "./attendanceFingerprint.js";
import { loadSalarySheet, loadSalarySheetAsUploadRows, sheetRowsToUploadRows } from "./salarySheet.js";
import { defaultPmStatutoryFields } from "./salaryBase.js";
import type {
  SalaryCalculationResult,
  SalaryCalculationRow,
  SalaryUploadRow,
  SalaryUploadSession,
  SalaryValidationResult,
} from "./types.js";

const UPLOAD_TTL_MS = 60 * 60 * 1000;
const uploads = new Map<string, SalaryUploadSession>();

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function purgeExpiredUploads(): void {
  const cutoff = Date.now() - UPLOAD_TTL_MS;
  for (const [id, session] of uploads) {
    if (session.createdAt < cutoff) uploads.delete(id);
  }
}

function normCode(code: string): string {
  return cellStr(code).replace(/\s+/g, "").toUpperCase();
}

export async function matchSalaryEmployees(
  rows: SalaryUploadRow[],
  company: string,
): Promise<SalaryUploadRow[]> {
  const emps = await query<{
    id: number;
    employee_code: string;
    name: string;
    company: string | null;
    salary: number | null;
  }>(
    company.trim()
      ? `SELECT id, employee_code, name, company, salary FROM employees WHERE company = $1 OR company IS NULL OR company = ''`
      : `SELECT id, employee_code, name, company, salary FROM employees`,
    company.trim() ? [company.trim()] : [],
  );

  const byCode = new Map<string, (typeof emps)[0]>();
  for (const e of emps) {
    byCode.set(normCode(e.employee_code), e);
  }

  return rows.map((row) => {
    if (row.errors.length > 0) return { ...row, matched: false };
    const hit = byCode.get(normCode(row.employeeCode));
    if (!hit) {
      return {
        ...row,
        matched: false,
        errors: [...row.errors, "No employee found with this code"],
      };
    }
    const warnings = [...row.warnings];
    if (row.employeeName && cellStr(row.employeeName).toLowerCase() !== cellStr(hit.name).toLowerCase()) {
      warnings.push(`Name in file differs from HR record (${hit.name})`);
    }
    return {
      ...row,
      matched: true,
      employeeId: hit.id,
      dbEmployeeName: hit.name,
      dbCompany: hit.company,
      warnings,
    };
  });
}

async function enrichRowsWithApprovalGate(
  rows: SalaryUploadRow[],
  year: number,
  month: number,
): Promise<SalaryUploadRow[]> {
  const ids = rows.filter((r) => r.matched && r.employeeId).map((r) => r.employeeId!);
  if (ids.length === 0) return rows;

  return withTransaction(async (client) => {
    const checks = await checkApprovedAttendanceForEmployees(client, ids, year, month);
    return rows.map((row) => {
      if (!row.matched || !row.employeeId) return row;
      const check = checks.get(row.employeeId);
      if (!check || check.ok) return row;
      const approvalErrors = check.issues.map((i) => i.message);
      return {
        ...row,
        errors: [...row.errors, ...approvalErrors],
        matched: false,
      };
    });
  });
}

function summarizeSalaryRows(rows: SalaryUploadRow[]) {
  const validRows = rows.filter((r) => r.errors.length === 0);
  const matchedRows = rows.filter((r) => r.matched && r.errors.length === 0);
  const blockedByApproval = rows.filter(
    (r) => r.errors.some((e) => e.includes("approve and lock weekly attendance") || e.includes("approved/locked")),
  ).length;
  return {
    totalRows: rows.length,
    validRows: validRows.length,
    matchedRows: matchedRows.length,
    errorRows: rows.length - validRows.length,
    blockedByApproval,
    canCalculate: matchedRows.length > 0,
  };
}

export async function buildSalaryUploadSession(input: {
  buffer: Buffer;
  fileName: string;
  year: number;
  month: number;
  company: string;
  uploadId?: string;
}): Promise<SalaryValidationResult> {
  purgeExpiredUploads();
  validatePeriod(input.year, input.month);

  const parsed = parseSalaryExcel(input.buffer);
  const validated = buildValidatedRows(parsed);
  let rows = await matchSalaryEmployees(validated, input.company);
  rows = await enrichRowsWithApprovalGate(rows, input.year, input.month);

  const uploadId = input.uploadId ?? randomUUID();
  const company = input.company.trim() || "PM";
  uploads.set(uploadId, {
    createdAt: Date.now(),
    fileName: input.fileName,
    year: input.year,
    month: input.month,
    company,
    rows,
  });

  return {
    uploadId,
    fileName: input.fileName,
    year: input.year,
    month: input.month,
    company,
    rows,
    summary: summarizeSalaryRows(rows),
  };
}

export async function validateSalaryUpload(input: {
  buffer: Buffer;
  fileName: string;
  year: number;
  month: number;
  company: string;
}): Promise<SalaryValidationResult> {
  return buildSalaryUploadSession(input);
}

export function restoreUploadSession(input: {
  uploadId: string;
  fileName: string;
  year: number;
  month: number;
  company: string;
  rows: SalaryUploadRow[];
}): void {
  uploads.set(input.uploadId, {
    createdAt: Date.now(),
    fileName: input.fileName,
    year: input.year,
    month: input.month,
    company: input.company,
    rows: input.rows,
  });
}

export async function calculateSalaryUpload(input: {
  uploadId?: string;
  year?: number;
  month?: number;
  company?: string;
  actor: string;
  rowOverrides?: { employeeCode: string; grossSalary: number; adjustment: number }[];
}): Promise<SalaryCalculationResult> {
  purgeExpiredUploads();

  let uploadId = input.uploadId?.trim() || "";

  if (
    Number.isFinite(input.year) &&
    Number.isFinite(input.month) &&
    typeof input.company === "string" &&
    input.company.trim()
  ) {
    const company = input.company.trim();
    let sheetData = await loadSalarySheetAsUploadRows({
      year: input.year!,
      month: input.month!,
      company,
    });
    if (!sheetData) {
      const sheet = await loadSalarySheet({
        year: input.year!,
        month: input.month!,
        company,
        withPreview: false,
      });
      if (sheet.rows.length > 0) {
        sheetData = {
          rows: sheetRowsToUploadRows(sheet.rows),
          year: sheet.year,
          month: sheet.month,
          company: sheet.company,
        };
      }
    }
    if (sheetData) {
      uploadId = `sheet-${monthKey(input.year!, input.month!)}-${company}`;
      uploads.set(uploadId, {
        createdAt: Date.now(),
        fileName: "Salary sheet",
        year: sheetData.year,
        month: sheetData.month,
        company: sheetData.company,
        rows: sheetData.rows,
      });
    }
  }

  if (!uploads.has(uploadId)) {
    throw Object.assign(
      new Error(
        "No salary data for this month. Open the Salary tab, fill the table, click Save sheet, then Process salary.",
      ),
      { status: 404 },
    );
  }

  const session = uploads.get(uploadId);
  if (!session) {
    throw Object.assign(new Error("Salary session expired. Reload the salary sheet and try again."), {
      status: 404,
    });
  }

  if (input.rowOverrides?.length) {
    const byCode = new Map(
      input.rowOverrides.map((r) => [normCode(r.employeeCode), r]),
    );
    session.rows = session.rows.map((row) => {
      const hit = byCode.get(normCode(row.employeeCode));
      if (!hit || row.errors.length > 0 || !row.matched) return row;
      const pm = row.pm ?? {
        employeeCode: row.employeeCode,
        employeeName: row.employeeName,
        inHand: row.grossSalary,
        ...defaultPmStatutoryFields(),
        otherEarning: 0,
        increment: 0,
      };
      return {
        ...row,
        grossSalary: hit.grossSalary,
        adjustment: hit.adjustment,
        pm: {
          ...pm,
          inHand: hit.grossSalary,
          otherEarning: hit.adjustment,
        },
      };
    });
    uploads.set(uploadId, session);
  }

  const mk = monthKey(session.year, session.month);
  const eligible = session.rows.filter((r) => r.matched && r.errors.length === 0 && r.employeeId);
  if (eligible.length === 0) {
    throw Object.assign(new Error("No matched rows to calculate"), { status: 400 });
  }

  let skippedApproved = 0;
  const rows: SalaryCalculationRow[] = [];

  await withTransaction(async (client) => {
    for (const row of eligible) {
      const employeeId = row.employeeId!;

      const existing = await client.query<{ id: number; status: string }>(
        `SELECT id, status FROM salary_records WHERE employee_id = $1 AND month = $2`,
        [employeeId, mk],
      );
      if (existing.rows[0]?.status === "approved") {
        skippedApproved += 1;
        continue;
      }

      const attendance = await loadPmAttendanceSnapshotForSalary(
        client,
        employeeId,
        session.year,
        session.month,
      );

      const pmInput: PmSalaryInput = row.pm ?? {
        employeeCode: row.employeeCode,
        employeeName: row.employeeName,
        inHand: row.grossSalary,
        ...defaultPmStatutoryFields(),
        otherEarning: 0,
        increment: 0,
      };

      const pm = calculatePmSalary(pmInput, attendance, session.year, session.month);
      const totalDeduction = pm.wfhDeduction + pm.lateMarkDeduction;
      const adjustment = pm.otherEarning + pm.increment;

      await client.query(`UPDATE employees SET salary = $1, updated_at = NOW() WHERE id = $2`, [
        pm.grossCtc,
        employeeId,
      ]);

      let salaryRecordId: number;
      if (existing.rows[0]) {
        const upd = await client.query<{ id: number }>(
          `UPDATE salary_records SET
             gross_salary = $1::numeric,
             working_days = $2::integer,
             attendance_adjustment = $3::numeric,
             deduction = $4::numeric,
             final_salary = $5::numeric,
             pm_breakdown = $6::jsonb,
             status = 'draft',
             updated_at = NOW()
           WHERE id = $7
           RETURNING id`,
          [
            pm.grossPay,
            pm.payDays,
            adjustment,
            totalDeduction,
            pm.netPay,
            JSON.stringify(pm),
            existing.rows[0].id,
          ],
        );
        salaryRecordId = upd.rows[0].id;
      } else {
        const ins = await client.query<{ id: number }>(
          `INSERT INTO salary_records (
             employee_id, month, gross_salary, working_days, attendance_adjustment, deduction, final_salary, pm_breakdown, status
           ) VALUES ($1, $2, $3::numeric, $4::integer, $5::numeric, $6::numeric, $7::numeric, $8::jsonb, 'draft')
           RETURNING id`,
          [
            employeeId,
            mk,
            pm.grossPay,
            pm.payDays,
            adjustment,
            totalDeduction,
            pm.netPay,
            JSON.stringify(pm),
          ],
        );
        salaryRecordId = ins.rows[0].id;
      }

      rows.push({
        employeeId,
        employeeCode: row.employeeCode,
        employeeName: row.dbEmployeeName ?? row.employeeName,
        grossSalary: pm.grossPay,
        workingDays: pm.payDays,
        deficitHours: pm.lateDeductionDays,
        attendanceDeduction: totalDeduction,
        adjustment,
        finalSalary: pm.netPay,
        salaryRecordId,
        status: "draft",
        warnings: row.warnings,
        pm,
      });

      await client.query(
        `INSERT INTO change_history (entity_type, entity_id, action, actor, before_json, after_json, note)
         VALUES ('salary', $1, 'calculate', $2, NULL, $3, $4)`,
        [
          salaryRecordId,
          input.actor,
          JSON.stringify({
            month: mk,
            grossPay: pm.grossPay,
            wfhDeduction: pm.wfhDeduction,
            lateMarkDeduction: pm.lateMarkDeduction,
            netPay: pm.netPay,
            pm,
          }),
          "PM salary sheet",
        ],
      );
    }

    if (rows.length > 0) {
      await recordSalaryCalculationRun(client, {
        year: session.year,
        month: session.month,
        company: session.company,
        actor: input.actor,
        employeeCount: rows.length,
      });
    }
  });

  if (rows.length === 0 && skippedApproved > 0) {
    throw Object.assign(new Error("All salary rows are already approved and cannot be recalculated."), {
      status: 400,
    });
  }

  if (rows.length === 0) {
    throw Object.assign(new Error("No matched rows to calculate"), { status: 400 });
  }

  const result: SalaryCalculationResult = {
    uploadId,
    year: session.year,
    month: session.month,
    company: session.company,
    monthKey: mk,
    rows,
    summary: {
      calculated: rows.length,
      skippedApproved,
      blockedByApproval: 0,
      totalDeduction: Math.round(rows.reduce((s, r) => s + r.attendanceDeduction, 0) * 100) / 100,
      totalFinal: Math.round(rows.reduce((s, r) => s + r.finalSalary, 0) * 100) / 100,
    },
  };

  uploads.delete(uploadId);
  return result;
}

export async function listSalaryResults(input: {
  year: number;
  month: number;
  company?: string;
}) {
  validatePeriod(input.year, input.month);
  const mk = monthKey(input.year, input.month);
  const company = input.company?.trim();

  const rows = await query<{
    id: number;
    employee_id: number;
    employee_code: string;
    name: string;
    gross_salary: number | null;
    working_days: number | null;
    attendance_adjustment: number | null;
    deduction: number | null;
    final_salary: number | null;
    status: string;
    pm_breakdown: unknown;
  }>(
    company
      ? `SELECT s.*, e.employee_code, e.name
         FROM salary_records s
         JOIN employees e ON e.id = s.employee_id
         WHERE s.month = $1 AND (e.company = $2 OR e.company IS NULL OR e.company = '')
         ORDER BY e.employee_code`
      : `SELECT s.*, e.employee_code, e.name
         FROM salary_records s
         JOIN employees e ON e.id = s.employee_id
         WHERE s.month = $1
         ORDER BY e.employee_code`,
    company ? [mk, company] : [mk],
  );

  return {
    year: input.year,
    month: input.month,
    monthKey: mk,
    company: company ?? null,
    ...(await getSalaryCalculationStatus(input.year, input.month, company ?? "PM")),
    rows: rows.map((r) => ({
      salaryRecordId: r.id,
      employeeId: r.employee_id,
      employeeCode: r.employee_code,
      employeeName: r.name,
      grossSalary: r.gross_salary,
      workingDays: r.working_days,
      adjustment: r.attendance_adjustment,
      attendanceDeduction: r.deduction,
      finalSalary: r.final_salary,
      status: r.status,
      pm: r.pm_breakdown && typeof r.pm_breakdown === "object" ? (r.pm_breakdown as SalaryCalculationRow["pm"]) : undefined,
    })),
  };
}

export function isSalaryValidationError(err: unknown): err is SalaryValidationError {
  return err instanceof SalaryValidationError;
}
