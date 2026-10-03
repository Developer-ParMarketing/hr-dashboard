/** PM salary sheet column layout - matches "salary calculation PM.xlsx". */

import { SALARY_COLUMN_LABELS, SALARY_FULL_COLUMN_KEYS } from "./salaryColumnLabels.js";

export type PmSalaryColumnKind = "meta" | "input" | "calc";

export type PmSalaryColumnDef = {
  key: string;
  label: string;
  kind: PmSalaryColumnKind;
  /** Maps to PmSalaryBreakdown field when kind=calc */
  field?: string;
  /** Maps to SalarySheetInputRow / pm input when kind=input */
  inputKey?: string;
};

const L = (key: keyof typeof SALARY_COLUMN_LABELS | string): string =>
  SALARY_COLUMN_LABELS[key as keyof typeof SALARY_COLUMN_LABELS] ?? String(key);

export const PM_SALARY_COLUMNS: PmSalaryColumnDef[] = [
  { key: "employeeCode", label: L("employeeCode"), kind: "meta" },
  { key: "employeeName", label: L("employeeName"), kind: "meta" },
  { key: "doj", label: L("doj"), kind: "meta" },
  { key: "process", label: L("process"), kind: "meta" },
  { key: "department", label: L("department"), kind: "meta" },
  { key: "gender", label: L("gender"), kind: "meta" },
  { key: "status", label: L("status"), kind: "meta" },
  { key: "inHand", label: L("inHand"), kind: "input", inputKey: "inHand" },
  { key: "pfEmployee", label: L("pfEmployee"), kind: "input", inputKey: "pfEmployee" },
  { key: "esiEmployee", label: L("esiEmployee"), kind: "input", inputKey: "esiEmployee" },
  { key: "ptBase", label: L("ptBase"), kind: "input", inputKey: "pt" },
  { key: "gratuityBase", label: L("gratuityBase"), kind: "input", inputKey: "gratuity" },
  { key: "employerPf", label: L("employerPf"), kind: "input", inputKey: "employerPf" },
  { key: "employerPfArr", label: L("employerPfArr"), kind: "input", inputKey: "employerPfArr" },
  { key: "employerEsi", label: L("employerEsi"), kind: "input", inputKey: "employerEsi" },
  { key: "grossCtc", label: L("grossCtc"), kind: "calc", field: "grossCtc" },
  { key: "perDay", label: L("perDay"), kind: "calc", field: "perDay" },
  { key: "payDays", label: L("payDays"), kind: "calc", field: "payDays" },
  { key: "grossPay", label: L("grossPay"), kind: "calc", field: "grossPay" },
  { key: "gratuity", label: L("gratuity"), kind: "calc", field: "gratuity" },
  { key: "pt", label: L("pt"), kind: "calc", field: "pt" },
  { key: "pfEmployeeCalc", label: L("pfEmployeeCalc"), kind: "calc", field: "pfEmployee" },
  { key: "pfEmployer", label: L("pfEmployer"), kind: "calc", field: "pfEmployer" },
  { key: "esicEmployer", label: L("esicEmployer"), kind: "calc", field: "esicEmployer" },
  { key: "esicEmployee", label: L("esicEmployee"), kind: "calc", field: "esicEmployee" },
  { key: "otherEarning", label: L("otherEarning"), kind: "input", inputKey: "otherEarning" },
  { key: "wfhDeduction", label: L("wfhDeduction"), kind: "calc", field: "wfhDeduction" },
  { key: "lateMarkDeduction", label: L("lateMarkDeduction"), kind: "calc", field: "lateMarkDeduction" },
  { key: "increment", label: L("increment"), kind: "input", inputKey: "increment" },
  { key: "netPay", label: L("netPay"), kind: "calc", field: "netPay" },
  { key: "incrementPercent", label: L("incrementPercent"), kind: "input", inputKey: "incrementPercent" },
  { key: "fileList", label: L("fileList"), kind: "meta" },
];

/** Main salary sheet export - exact PM column set (no Inc. %, no file list). */
export const PM_SALARY_EXPORT_COLUMN_KEYS = [...SALARY_FULL_COLUMN_KEYS] as const;

export const PM_SALARY_HEADER_ROW = SALARY_FULL_COLUMN_KEYS.map(
  (key) => SALARY_COLUMN_LABELS[key as keyof typeof SALARY_COLUMN_LABELS] ?? key,
);
