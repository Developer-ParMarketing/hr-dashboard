import * as XLSX from "xlsx";
import type { PmSalaryBreakdown } from "./pmSalaryCalculator.js";
import { ctcProratedRupees } from "./pmSalaryCalculator.js";
import { PM_SALARY_EXPORT_COLUMN_KEYS, PM_SALARY_HEADER_ROW } from "./salaryColumns.js";
import type { SalarySheetRow } from "./salarySheet.js";

export type PmExportRowMeta = {
  fileList?: string | number | null;
  doj?: string | null;
  process?: string | null;
  department?: string | null;
  gender?: string | null;
  status?: string | null;
};

function dashOrNum(n: number, showZero = true): number | string {
  if (!Number.isFinite(n)) return "-";
  if (n === 0 && !showZero) return "-";
  return Math.round(n * 100) / 100;
}

/** Excel serial date (days since 1899-12-30). */
export function isoToExcelSerial(iso: string | null | undefined): number | "" {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  const epoch = Date.UTC(1899, 11, 30);
  return Math.round((d.getTime() - epoch) / 86400000);
}

export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const epoch = Date.UTC(1899, 11, 30);
  const d = new Date(epoch + serial * 86400000);
  return d.toISOString().slice(0, 10);
}

export function buildPmSalaryMatrixRow(
  row: Pick<
    SalarySheetRow,
    | "employeeId"
    | "employeeCode"
    | "employeeName"
    | "inHand"
    | "pfEmployee"
    | "esiEmployee"
    | "pt"
    | "gratuity"
    | "employerPf"
    | "employerPfArr"
    | "employerEsi"
    | "otherEarning"
    | "increment"
    | "incrementPercent"
    | "department"
    | "gender"
    | "dateOfJoining"
    | "process"
    | "status"
  >,
  preview?: PmSalaryBreakdown,
): (string | number)[] {
  const p = preview;
  const values: Record<string, string | number> = {
    fileList: row.employeeId ?? "",
    employeeCode: row.employeeCode,
    employeeName: row.employeeName,
    doj: isoToExcelSerial(row.dateOfJoining) || "",
    process: row.process ?? "PM",
    department: row.department ?? "",
    gender: row.gender ?? "",
    status: row.status ? row.status.charAt(0).toUpperCase() + row.status.slice(1) : "Active",
    inHand: dashOrNum(row.inHand),
    pfEmployee: dashOrNum(row.pfEmployee, false),
    esiEmployee: dashOrNum(row.esiEmployee, false),
    ptBase: dashOrNum(row.pt, false),
    gratuityBase: dashOrNum(row.gratuity, false),
    employerPf: dashOrNum(row.employerPf, false),
    employerPfArr: dashOrNum(row.employerPfArr, false),
    employerEsi: dashOrNum(row.employerEsi, false),
    grossCtc: p ? dashOrNum(p.grossCtc) : "",
    perDay: p ? dashOrNum(p.perDay) : "",
    payDays: p?.payDays ?? "",
    grossPay: p ? dashOrNum(p.grossPay) : "",
    gratuity: p ? dashOrNum(p.gratuity, false) : "",
    pt: p ? dashOrNum(p.pt, false) : "",
    pfEmployeeCalc: p ? dashOrNum(p.pfEmployee, false) : "",
    pfEmployer: p ? dashOrNum(p.pfEmployer, false) : "",
    esicEmployer: p ? dashOrNum(p.esicEmployer, false) : "",
    esicEmployee: p ? dashOrNum(p.esicEmployee, false) : "",
    otherEarning: dashOrNum(row.otherEarning, false),
    wfhDeduction: p ? dashOrNum(p.wfhDeduction, false) : "",
    lateMarkDeduction: p ? dashOrNum(p.lateMarkDeduction, false) : "",
    incrementPercent:
      row.incrementPercent != null && row.incrementPercent > 0 ? row.incrementPercent : "",
    increment: dashOrNum(row.increment, false),
    netPay: p ? dashOrNum(p.netPay) : "",
  };

  return PM_SALARY_EXPORT_COLUMN_KEYS.map((key) => values[key] ?? "");
}

function buildWfhSheet(rows: SalarySheetRow[]): unknown[][] {
  const header = ["Emp Name", "WFH Days", "Gross Salary", "Perday", "Salary", "Deduction"];
  const body: unknown[][] = [header];
  for (const row of rows) {
    const p = row.preview;
    if (!p || p.wfhDays <= 0) continue;
    const grossSalary = p.grossPay;
    const perDay = p.perDay;
    const salary = ctcProratedRupees(p.grossCtc, p.calendarDays ?? 30, p.wfhDays);
    body.push([
      row.employeeName,
      p.wfhDays,
      dashOrNum(grossSalary),
      dashOrNum(perDay),
      dashOrNum(salary),
      dashOrNum(p.wfhDeduction),
    ]);
  }
  return body;
}

function buildLateMarkSheet(rows: SalarySheetRow[]): unknown[][] {
  const header = ["Emp Name", "Department", "Final Late Mark", "Final No day", "Salary", "Per day", "Deduction"];
  const body: unknown[][] = [header];
  for (const row of rows) {
    const p = row.preview;
    if (!p || p.lateMarkCount <= 0) continue;
    body.push([
      row.employeeName,
      row.department ?? "",
      p.lateMarkCount,
      p.lateDeductionDays,
      dashOrNum(p.grossCtc),
      dashOrNum(p.perDay),
      dashOrNum(p.lateMarkDeduction),
    ]);
  }
  return body;
}

export function buildPmSalaryWorkbookBuffer(rows: SalarySheetRow[]): Buffer {
  const salaryMatrix: unknown[][] = [PM_SALARY_HEADER_ROW];
  for (const row of rows) {
    if (!row.matched || row.errors.length > 0) continue;
    salaryMatrix.push(buildPmSalaryMatrixRow(row, row.preview));
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(salaryMatrix), "Salary");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildWfhSheet(rows)), "wfh");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildLateMarkSheet(rows)), "late mark ");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
