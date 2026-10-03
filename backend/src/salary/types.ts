import type { PmSalaryInput } from "./pmSalaryCalculator.js";

export type SalaryUploadRow = {
  rowNumber: number;
  employeeCode: string;
  employeeName: string;
  /** Legacy alias for In Hand (column I). */
  grossSalary: number;
  adjustment: number;
  /** PM template columns A-P (through Employer ESI). */
  pm?: PmSalaryInput;
  errors: string[];
  warnings: string[];
  matched: boolean;
  employeeId?: number;
  dbEmployeeName?: string;
  dbCompany?: string | null;
};

export type SalaryValidationResult = {
  uploadId: string;
  fileName: string;
  year: number;
  month: number;
  company: string;
  rows: SalaryUploadRow[];
  summary: {
    totalRows: number;
    validRows: number;
    matchedRows: number;
    errorRows: number;
    blockedByApproval: number;
    canCalculate: boolean;
  };
};

import type { PmSalaryBreakdown } from "./pmSalaryCalculator.js";

export type SalaryCalculationRow = {
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  grossSalary: number;
  workingDays: number;
  deficitHours: number;
  attendanceDeduction: number;
  adjustment: number;
  finalSalary: number;
  salaryRecordId: number;
  status: string;
  warnings: string[];
  pm?: PmSalaryBreakdown;
};

export type SalaryCalculationResult = {
  uploadId: string;
  year: number;
  month: number;
  company: string;
  monthKey: string;
  rows: SalaryCalculationRow[];
  summary: {
    calculated: number;
    skippedApproved: number;
    blockedByApproval: number;
    totalDeduction: number;
    totalFinal: number;
  };
};

export type SalaryUploadSession = {
  createdAt: number;
  fileName: string;
  year: number;
  month: number;
  company: string;
  rows: SalaryUploadRow[];
};
