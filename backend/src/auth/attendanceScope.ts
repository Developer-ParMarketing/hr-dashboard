import { queryOne } from "../db/index.js";
import { calendarTodayIso, sqlEmployeeOperationalOnDate } from "../employees/employmentStatus.js";
import { getAssignedEmployeeIds } from "./managerAssignments.js";
import { userCanEdit, userIsManager } from "./middleware.js";
import type { AuthUser } from "./users.js";

export type AttendanceScopeMode = "full" | "team" | "self";

export type AttendanceScope = {
  /** null = unrestricted (admin / HR). Empty array = no linked employees. */
  restrictToEmployeeIds: number[] | null;
  mode: AttendanceScopeMode;
};

export type LinkedEmployeeProfile = {
  linked: boolean;
  employeeCode: string | null;
  name: string | null;
  teamName: string | null;
  department: string | null;
  dateOfJoining: string | null;
};

export async function loadLinkedEmployeeProfile(email: string): Promise<LinkedEmployeeProfile> {
  const row = await queryOne<{
    employee_code: string;
    name: string;
    team_name: string | null;
    department: string | null;
    date_of_joining: Date | string | null;
  }>(
    `SELECT e.employee_code, e.name, t.name AS team_name, e.department, e.date_of_joining
     FROM employees e
     LEFT JOIN teams t ON t.id = e.team_id
     WHERE e.email IS NOT NULL AND lower(trim(e.email)) = lower(trim($1))
     LIMIT 1`,
    [email],
  );
  if (!row) {
    return {
      linked: false,
      employeeCode: null,
      name: null,
      teamName: null,
      department: null,
      dateOfJoining: null,
    };
  }
  return {
    linked: true,
    employeeCode: row.employee_code,
    name: row.name,
    teamName: row.team_name,
    department: row.department,
    dateOfJoining: row.date_of_joining
      ? new Date(row.date_of_joining).toISOString().slice(0, 10)
      : null,
  };
}

export async function findEmployeeIdByUserEmail(email: string): Promise<number | null> {
  const today = calendarTodayIso();
  const row = await queryOne<{ id: number }>(
    `SELECT e.id FROM employees e
     WHERE e.email IS NOT NULL AND lower(trim(e.email)) = lower(trim($1))
       AND ${sqlEmployeeOperationalOnDate("e", 2)}
     LIMIT 1`,
    [email, today],
  );
  return row?.id ?? null;
}

export async function resolveAttendanceScope(user: AuthUser): Promise<AttendanceScope> {
  if (userCanEdit(user)) {
    return { restrictToEmployeeIds: null, mode: "full" };
  }
  if (userIsManager(user)) {
    const ids = await getAssignedEmployeeIds(user.id);
    return { restrictToEmployeeIds: ids, mode: "team" };
  }
  const employeeId = await findEmployeeIdByUserEmail(user.email);
  return {
    restrictToEmployeeIds: employeeId != null ? [employeeId] : [],
    mode: "self",
  };
}

export async function assertEmployeeInAttendanceScope(
  user: AuthUser,
  employeeId: number,
): Promise<void> {
  const scope = await resolveAttendanceScope(user);
  if (scope.restrictToEmployeeIds === null) return;
  if (!scope.restrictToEmployeeIds.includes(employeeId)) {
    throw Object.assign(new Error("You do not have access to this employee's attendance"), {
      status: 403,
    });
  }
}
