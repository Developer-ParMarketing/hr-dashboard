import { query, queryOne, withTransaction } from "../db/index.js";
import type { AuthUser } from "./users.js";

export type ManagerSummary = AuthUser & {
  assignedCount: number;
};

export type AssignedEmployee = {
  id: number;
  employeeCode: string;
  name: string;
  company: string | null;
  teamId: number | null;
  teamName: string | null;
};

function normalizeRole(role: string): string {
  return role.trim().toLowerCase();
}

export async function listManagers(): Promise<ManagerSummary[]> {
  return query<ManagerSummary>(
    `SELECT u.id, u.email, u.name, u.role,
            COUNT(a.employee_id)::int AS "assignedCount"
     FROM users u
     LEFT JOIN manager_employee_assignments a ON a.manager_user_id = u.id
     WHERE lower(u.role) = 'manager'
     GROUP BY u.id
     ORDER BY lower(u.name), lower(u.email)`,
  );
}

export async function getManagerAssignments(managerUserId: number): Promise<{
  manager: AuthUser;
  employees: AssignedEmployee[];
  employeeIds: number[];
}> {
  const manager = await queryOne<AuthUser>(
    `SELECT id, email, name, role FROM users WHERE id = $1 AND lower(role) = 'manager'`,
    [managerUserId],
  );
  if (!manager) {
    throw Object.assign(new Error("Manager not found"), { status: 404 });
  }

  const employees = await query<{
    id: number;
    employee_code: string;
    name: string;
    company: string | null;
    team_id: number | null;
    team_name: string | null;
  }>(
    `SELECT e.id, e.employee_code, e.name, e.company, e.team_id, t.name AS team_name
     FROM manager_employee_assignments a
     JOIN employees e ON e.id = a.employee_id
     LEFT JOIN teams t ON t.id = e.team_id
     WHERE a.manager_user_id = $1
     ORDER BY e.employee_code`,
    [managerUserId],
  );

  return {
    manager,
    employees: employees.map((e) => ({
      id: e.id,
      employeeCode: e.employee_code,
      name: e.name,
      company: e.company,
      teamId: e.team_id,
      teamName: e.team_name,
    })),
    employeeIds: employees.map((e) => e.id),
  };
}

export async function setManagerAssignments(
  managerUserId: number,
  employeeIds: number[],
  actor: string,
): Promise<{ assignedCount: number }> {
  const manager = await queryOne<AuthUser>(`SELECT id, role FROM users WHERE id = $1`, [managerUserId]);
  if (!manager || normalizeRole(manager.role) !== "manager") {
    throw Object.assign(new Error("Manager not found"), { status: 404 });
  }

  const uniqueIds = [...new Set(employeeIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (uniqueIds.length > 0) {
    const found = await query<{ id: number }>(`SELECT id FROM employees WHERE id = ANY($1::int[])`, [
      uniqueIds,
    ]);
    if (found.length !== uniqueIds.length) {
      throw Object.assign(new Error("One or more employees were not found"), { status: 400 });
    }
  }

  await withTransaction(async (client) => {
    await client.query(`DELETE FROM manager_employee_assignments WHERE manager_user_id = $1`, [
      managerUserId,
    ]);
    if (uniqueIds.length === 0) return;

    await client.query(
      `DELETE FROM manager_employee_assignments
       WHERE employee_id = ANY($1::int[]) AND manager_user_id <> $2`,
      [uniqueIds, managerUserId],
    );

    for (const employeeId of uniqueIds) {
      await client.query(
        `INSERT INTO manager_employee_assignments (manager_user_id, employee_id, assigned_by)
         VALUES ($1, $2, $3)`,
        [managerUserId, employeeId, actor],
      );
    }
  });

  return { assignedCount: uniqueIds.length };
}

export async function getAssignedEmployeeIds(managerUserId: number): Promise<number[]> {
  const rows = await query<{ employee_id: number }>(
    `SELECT employee_id FROM manager_employee_assignments WHERE manager_user_id = $1`,
    [managerUserId],
  );
  return rows.map((r) => r.employee_id);
}

export async function listEmployeesForAssignment(company?: string): Promise<AssignedEmployee[]> {
  const rows = company
    ? await query<{
        id: number;
        employee_code: string;
        name: string;
        company: string | null;
        team_id: number | null;
        team_name: string | null;
      }>(
        `SELECT e.id, e.employee_code, e.name, e.company, e.team_id, t.name AS team_name
         FROM employees e
         LEFT JOIN teams t ON t.id = e.team_id
         WHERE e.status = 'active' AND (e.company = $1 OR e.company IS NULL OR e.company = '')
         ORDER BY e.employee_code`,
        [company],
      )
    : await query<{
        id: number;
        employee_code: string;
        name: string;
        company: string | null;
        team_id: number | null;
        team_name: string | null;
      }>(
        `SELECT e.id, e.employee_code, e.name, e.company, e.team_id, t.name AS team_name
         FROM employees e
         LEFT JOIN teams t ON t.id = e.team_id
         WHERE e.status = 'active'
         ORDER BY e.employee_code`,
      );

  return rows.map((e) => ({
    id: e.id,
    employeeCode: e.employee_code,
    name: e.name,
    company: e.company,
    teamId: e.team_id,
    teamName: e.team_name,
  }));
}
