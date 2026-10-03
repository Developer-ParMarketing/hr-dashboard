import * as XLSX from "xlsx";
import { cellStr } from "../persist/helpers.js";
import { parsePmAmount, type PmSalaryInput } from "./pmSalaryCalculator.js";
import type { SalaryUploadRow } from "./types.js";

export class SalaryValidationError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "SalaryValidationError";
  }
}

const CODE_HEADERS = ["emp code", "employee code", "code", "employee_id", "empcode"];
const NAME_HEADERS = ["emp name", "employee name", "name", "employee"];
const IN_HAND_HEADERS = ["in hand", "inhand", "take home", "net in hand"];
const PF_EMP_HEADERS = ["pfamt", "pf employee", "pf amount", "employee pf"];
const ESI_EMP_HEADERS = ["esiamt", "esi employee", "esi amount", "employee esi"];
const PT_HEADERS = ["pt", "prof tax", "professional tax"];
const GRATUITY_HEADERS = ["gratuity"];
const EMP_PF_HEADERS = ["employer pf", "employer pf amount"];
const EMP_PFARR_HEADERS = ["employer pfarr", "employer pf arr"];
const EMP_ESI_HEADERS = ["employer esi"];
const OTHER_EARNING_HEADERS = ["other earning", "other earnings"];
const INCREMENT_HEADERS = ["increment"];
const GROSS_HEADERS = ["gross salary", "gross ctc", "gross", "salary", "monthly salary"];

function normHeader(v: unknown): string {
  return cellStr(v).toLowerCase().replace(/\s+/g, " ").trim();
}

function findColumnIndex(headers: string[], candidates: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (candidates.includes(h)) return i;
    const compact = h.replace(/[^a-z0-9]/g, "");
    if (candidates.some((c) => c.replace(/[^a-z0-9]/g, "") === compact)) return i;
  }
  return -1;
}

function parseNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = cellStr(v).replace(/[,₹]/g, "");
  if (!s || s === "-") return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function sheetToMatrix(buffer: Buffer): unknown[][] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheetName =
    wb.SheetNames.find((n) => normHeader(n) === "salary") ?? wb.SheetNames[0];
  if (!sheetName) throw new SalaryValidationError("Excel file has no sheets");
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new SalaryValidationError("Could not read Excel sheet");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];
  return rows.filter((row) => row.some((c) => cellStr(c) !== ""));
}

function detectHeaderRow(matrix: unknown[][]): number {
  let bestRow = 0;
  let bestScore = -1;
  const scan = Math.min(matrix.length, 15);
  for (let r = 0; r < scan; r++) {
    const headers = (matrix[r] ?? []).map(normHeader);
    let score = 0;
    if (findColumnIndex(headers, CODE_HEADERS) >= 0) score += 4;
    if (findColumnIndex(headers, IN_HAND_HEADERS) >= 0) score += 4;
    if (findColumnIndex(headers, GROSS_HEADERS) >= 0) score += 2;
    if (findColumnIndex(headers, NAME_HEADERS) >= 0) score += 1;
    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
    }
  }
  if (bestScore < 4) {
    throw new SalaryValidationError(
      "Could not find PM salary columns. Expected Emp Code and In Hand (columns A-P through Employer ESI).",
    );
  }
  return bestRow;
}

function cellAt(row: unknown[], idx: number): unknown {
  return idx >= 0 ? row[idx] : undefined;
}

export function parseSalaryExcel(buffer: Buffer): Omit<SalaryUploadRow, "matched" | "errors" | "warnings">[] {
  const matrix = sheetToMatrix(buffer);
  if (matrix.length < 2) throw new SalaryValidationError("Excel file is empty");

  const headerRow = detectHeaderRow(matrix);
  const headers = (matrix[headerRow] ?? []).map(normHeader);

  const codeIdx = findColumnIndex(headers, CODE_HEADERS);
  const nameIdx = findColumnIndex(headers, NAME_HEADERS);
  const inHandIdx = findColumnIndex(headers, IN_HAND_HEADERS);
  const grossIdx = findColumnIndex(headers, GROSS_HEADERS);
  const pfIdx = findColumnIndex(headers, PF_EMP_HEADERS);
  const esiIdx = findColumnIndex(headers, ESI_EMP_HEADERS);
  const ptIdx = findColumnIndex(headers, PT_HEADERS);
  const gratIdx = findColumnIndex(headers, GRATUITY_HEADERS);
  const empPfIdx = findColumnIndex(headers, EMP_PF_HEADERS);
  const empPfArrIdx = findColumnIndex(headers, EMP_PFARR_HEADERS);
  const empEsiIdx = findColumnIndex(headers, EMP_ESI_HEADERS);
  const otherIdx = findColumnIndex(headers, OTHER_EARNING_HEADERS);
  const incIdx = findColumnIndex(headers, INCREMENT_HEADERS);

  if (codeIdx < 0) throw new SalaryValidationError("Missing Emp Code column");

  const isPmTemplate = inHandIdx >= 0;

  const out: Omit<SalaryUploadRow, "matched" | "errors" | "warnings">[] = [];
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const employeeCode = cellStr(cellAt(row, codeIdx)).toUpperCase();
    const employeeName = nameIdx >= 0 ? cellStr(cellAt(row, nameIdx)) : "";

    let inHand = 0;
    if (isPmTemplate) {
      inHand = parsePmAmount(cellAt(row, inHandIdx));
    } else if (grossIdx >= 0) {
      inHand = parseNumber(cellAt(row, grossIdx)) ?? NaN;
    }

    if (!employeeCode && !employeeName && !inHand) continue;

    const pm: PmSalaryInput = {
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
      otherEarning: parsePmAmount(cellAt(row, otherIdx)),
      increment: parsePmAmount(cellAt(row, incIdx)),
    };

    out.push({
      rowNumber: r + 1,
      employeeCode,
      employeeName,
      grossSalary: inHand,
      adjustment: pm.otherEarning + pm.increment,
      pm,
    });
  }

  if (out.length === 0) throw new SalaryValidationError("No salary rows found below the header");
  return out;
}

export function validateSalaryRow(
  row: Omit<SalaryUploadRow, "matched" | "errors" | "warnings">,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!row.employeeCode) errors.push("Employee code is required");
  const inHand = row.pm?.inHand ?? row.grossSalary;
  if (!Number.isFinite(inHand) || inHand <= 0) {
    errors.push("In Hand / gross salary must be a positive number");
  }
  if (!row.employeeName) warnings.push("Employee name missing - matching uses code only");

  return { errors, warnings };
}

export function validatePeriod(year: number, month: number): void {
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    throw new SalaryValidationError("Invalid year (use 2000-2100)");
  }
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    throw new SalaryValidationError("Invalid month (use 1-12)");
  }
}

export function buildValidatedRows(
  parsed: Omit<SalaryUploadRow, "matched" | "errors" | "warnings">[],
): SalaryUploadRow[] {
  return parsed.map((row) => {
    const { errors, warnings } = validateSalaryRow(row);
    return {
      ...row,
      matched: false,
      errors,
      warnings,
    };
  });
}
