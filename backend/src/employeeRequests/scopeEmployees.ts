import { query } from "../db/index.js";
import { calendarTodayIso, sqlEmployeeOperationalOnDate } from "../employees/employmentStatus.js";

export type RequestScopeEmployee = {
  employeeId: number;
  employeeCode: string;
  employeeName: string;
};

/** Active operational employees - used for company-wide leave/in-out approver views. */
export async function loadOversightDirectoryEmployees(): Promise<RequestScopeEmployee[]> {
  const today = calendarTodayIso();
  const rows = await query<{ id: number; employee_code: string; name: string }>(
    `SELECT e.id, e.employee_code, e.name
     FROM employees e
     WHERE ${sqlEmployeeOperationalOnDate("e", 1)}
     ORDER BY e.name ASC, e.employee_code ASC`,
    [today],
  );
  return rows.map((r) => ({
    employeeId: r.id,
    employeeCode: r.employee_code,
    employeeName: r.name,
  }));
}

export async function loadScopeEmployeesByIds(employeeIds: number[]): Promise<RequestScopeEmployee[]> {
  if (employeeIds.length === 0) return [];
  const rows = await query<{ id: number; employee_code: string; name: string }>(
    `SELECT id, employee_code, name FROM employees WHERE id = ANY($1::int[])
     ORDER BY name ASC, employee_code ASC`,
    [employeeIds],
  );
  return rows.map((r) => ({
    employeeId: r.id,
    employeeCode: r.employee_code,
    employeeName: r.name,
  }));
}
