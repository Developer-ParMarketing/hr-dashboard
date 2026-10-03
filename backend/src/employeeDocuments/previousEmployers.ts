import { query, withTransaction } from "../db/index.js";
import type { AuthUser } from "../auth/users.js";
import { findEmployeeIdByUserEmail } from "../auth/attendanceScope.js";
import { canUploadEmployeeDocuments, canViewAllEmployeeDocuments } from "./access.js";

export type PreviousEmployerDetail = {
  id: number;
  sortOrder: number;
  companyName: string;
  dateOfJoining: string | null;
  dateOfLeaving: string | null;
  position: string | null;
  location: string | null;
  reasonForLeaving: string | null;
  referenceContactName: string | null;
  referenceContactInfo: string | null;
  updatedAt: string;
};

export type PreviousEmployerInput = {
  companyName: string;
  dateOfJoining?: string | null;
  dateOfLeaving?: string | null;
  position?: string | null;
  location?: string | null;
  reasonForLeaving?: string | null;
  referenceContactName?: string | null;
  referenceContactInfo?: string | null;
};

const MAX_ROWS = 10;

function parseIsoDate(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw Object.assign(new Error(`Invalid date: ${s || "(empty)"}`), { status: 400 });
  }
  return s;
}

function normalizeInput(rows: unknown): PreviousEmployerInput[] {
  if (!Array.isArray(rows)) {
    throw Object.assign(new Error("employers must be an array"), { status: 400 });
  }
  if (rows.length > MAX_ROWS) {
    throw Object.assign(new Error(`At most ${MAX_ROWS} previous employers`), { status: 400 });
  }

  const out: PreviousEmployerInput[] = [];
  for (const raw of rows) {
    const row = (raw ?? {}) as Record<string, unknown>;
    const companyName = String(row.companyName ?? row.company_name ?? "").trim();
    const dateOfJoining = parseIsoDate(row.dateOfJoining ?? row.date_of_joining);
    const dateOfLeaving = parseIsoDate(row.dateOfLeaving ?? row.date_of_leaving);
    const position = String(row.position ?? "").trim() || null;
    const location = String(row.location ?? "").trim() || null;
    const reasonForLeaving =
      String(row.reasonForLeaving ?? row.reason_for_leaving ?? "").trim() || null;
    const referenceContactName =
      String(row.referenceContactName ?? row.reference_contact_name ?? "").trim() || null;
    const referenceContactInfo =
      String(row.referenceContactInfo ?? row.reference_contact_info ?? "").trim() || null;

    const empty =
      !companyName &&
      !dateOfJoining &&
      !dateOfLeaving &&
      !position &&
      !location &&
      !reasonForLeaving &&
      !referenceContactName &&
      !referenceContactInfo;
    if (empty) continue;

    if (!companyName) {
      throw Object.assign(new Error("Company name is required for each previous employer entry"), {
        status: 400,
      });
    }
    if (dateOfJoining && dateOfLeaving && dateOfLeaving < dateOfJoining) {
      throw Object.assign(new Error("Date of leaving cannot be before date of joining"), {
        status: 400,
      });
    }

    out.push({
      companyName,
      dateOfJoining,
      dateOfLeaving,
      position,
      location,
      reasonForLeaving,
      referenceContactName,
      referenceContactInfo,
    });
  }
  return out;
}

function mapRow(row: {
  id: number;
  sort_order: number;
  company_name: string;
  date_of_joining: string | null;
  date_of_leaving: string | null;
  position: string | null;
  location: string | null;
  reason_for_leaving: string | null;
  reference_contact_name: string | null;
  reference_contact_info: string | null;
  updated_at: Date;
}): PreviousEmployerDetail {
  return {
    id: row.id,
    sortOrder: row.sort_order,
    companyName: row.company_name,
    dateOfJoining: row.date_of_joining ? String(row.date_of_joining).slice(0, 10) : null,
    dateOfLeaving: row.date_of_leaving ? String(row.date_of_leaving).slice(0, 10) : null,
    position: row.position,
    location: row.location,
    reasonForLeaving: row.reason_for_leaving,
    referenceContactName: row.reference_contact_name,
    referenceContactInfo: row.reference_contact_info,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function listPreviousEmployersForEmployee(
  employeeId: number,
): Promise<PreviousEmployerDetail[]> {
  const rows = await query<{
    id: number;
    sort_order: number;
    company_name: string;
    date_of_joining: string | null;
    date_of_leaving: string | null;
    position: string | null;
    location: string | null;
    reason_for_leaving: string | null;
    reference_contact_name: string | null;
    reference_contact_info: string | null;
    updated_at: Date;
  }>(
    `SELECT id, sort_order, company_name, date_of_joining, date_of_leaving, position, location,
            reason_for_leaving, reference_contact_name, reference_contact_info, updated_at
     FROM employee_previous_employer_details
     WHERE employee_id = $1
     ORDER BY sort_order, id`,
    [employeeId],
  );
  return rows.map(mapRow);
}

async function assertCanEditPreviousEmployers(user: AuthUser, employeeId: number): Promise<void> {
  if (!canUploadEmployeeDocuments(user)) {
    throw Object.assign(new Error("Not allowed to update previous employer details"), { status: 403 });
  }
  const ownId = await findEmployeeIdByUserEmail(user.email);
  if (ownId !== employeeId) {
    throw Object.assign(new Error("You can only update your own previous employer details"), {
      status: 403,
    });
  }
}

export async function savePreviousEmployersForEmployee(
  user: AuthUser,
  employeeId: number,
  rawRows: unknown,
): Promise<PreviousEmployerDetail[]> {
  await assertCanEditPreviousEmployers(user, employeeId);
  const employers = normalizeInput(rawRows);

  await withTransaction(async (client) => {
    await client.query(`DELETE FROM employee_previous_employer_details WHERE employee_id = $1`, [
      employeeId,
    ]);
    let sort = 0;
    for (const row of employers) {
      sort += 1;
      await client.query(
        `INSERT INTO employee_previous_employer_details (
           employee_id, sort_order, company_name, date_of_joining, date_of_leaving,
           position, location, reason_for_leaving, reference_contact_name, reference_contact_info,
           updated_by_user_id, updated_at
         ) VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11, NOW())`,
        [
          employeeId,
          sort,
          row.companyName,
          row.dateOfJoining,
          row.dateOfLeaving,
          row.position,
          row.location,
          row.reasonForLeaving,
          row.referenceContactName,
          row.referenceContactInfo,
          user.id,
        ],
      );
    }
  });

  return listPreviousEmployersForEmployee(employeeId);
}

export async function assertCanViewPreviousEmployers(
  user: AuthUser,
  employeeId: number,
): Promise<void> {
  if (canViewAllEmployeeDocuments(user)) return;
  const ownId = await findEmployeeIdByUserEmail(user.email);
  if (ownId !== employeeId) {
    throw Object.assign(new Error("You do not have access to this employee's records"), {
      status: 403,
    });
  }
}
