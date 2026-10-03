import { cellStr, daysInMonth, employeeCodeOf, type RawIngestEmployee } from "./helpers.js";
import { assertIngestAnomaliesOk } from "./ingestAnomalies.js";

export class ValidationError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export type ValidatedIngest = {
  employees: RawIngestEmployee[];
  skippedMissingCode: number;
  year: number;
  month: number;
};

export function validateParsedEmployees(
  rows: unknown[],
  year: number,
  month: number,
): ValidatedIngest {
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    throw new ValidationError("Report year is invalid");
  }
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    throw new ValidationError("Report month is invalid");
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ValidationError("No employees parsed from the upload");
  }

  const employees: RawIngestEmployee[] = [];
  let skippedMissingCode = 0;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const raw = row as RawIngestEmployee;
    const code = employeeCodeOf(raw);
    if (!code) {
      skippedMissingCode += 1;
      continue;
    }
    if (!cellStr(raw.employeeName ?? raw.empName ?? raw.name)) {
      raw.employeeName = code;
    }
    employees.push(raw);
  }

  if (employees.length === 0) {
    throw new ValidationError("No employees with an employee code to save");
  }

  const dim = daysInMonth(year, month);
  let dayCells = 0;
  for (const raw of employees) {
    for (let d = 1; d <= dim; d++) {
      const token = cellStr(raw[`day${d}`]);
      const inTime = cellStr(raw[`day${d}InTime`]) || cellStr(raw.inTime);
      if (token || inTime) dayCells += 1;
    }
  }
  if (dayCells === 0) {
    throw new ValidationError("Parsed employees but found no daily attendance cells to save");
  }

  try {
    assertIngestAnomaliesOk(employees, year, month, dim);
  } catch (e) {
    throw new ValidationError(e instanceof Error ? e.message : "Attendance validation failed");
  }

  return { employees, skippedMissingCode, year, month };
}
