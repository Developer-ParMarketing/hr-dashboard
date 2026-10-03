import { findEmployeeIdByUserEmail } from "../auth/attendanceScope.js";
import type { AuthUser } from "../auth/users.js";
import { query, queryOne } from "../db/index.js";
import {
  completionForUploads,
  DOCUMENT_SECTION_LABELS,
  DOCUMENT_TYPE_SPECS,
  specForType,
  type StoredUploadRow,
} from "./catalog.js";
import { canUploadEmployeeDocuments, canViewAllEmployeeDocuments } from "./access.js";
import { listPreviousEmployersForEmployee } from "./previousEmployers.js";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/jpg",
]);

export async function requireEmployeeIdForUser(user: AuthUser): Promise<number> {
  const employeeId = await findEmployeeIdByUserEmail(user.email);
  if (employeeId == null) {
    throw Object.assign(
      new Error("Your login is not linked to an employee record. Contact HR."),
      { status: 400 },
    );
  }
  return employeeId;
}

async function assertCanAccessEmployee(user: AuthUser, employeeId: number): Promise<void> {
  if (canViewAllEmployeeDocuments(user)) return;
  const ownId = await findEmployeeIdByUserEmail(user.email);
  if (ownId !== employeeId) {
    throw Object.assign(new Error("You do not have access to this employee's documents"), {
      status: 403,
    });
  }
}

function mapUploadRow(row: StoredUploadRow & { employee_id?: number }) {
  return {
    id: row.id,
    documentType: row.document_type,
    slot: row.slot,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    uploadedAt: row.uploaded_at,
  };
}

export async function listUploadsForEmployee(employeeId: number) {
  const rows = await query<StoredUploadRow>(
    `SELECT id, document_type, slot, file_name, mime_type, file_size, uploaded_at
     FROM employee_documents
     WHERE employee_id = $1
     ORDER BY document_type, slot, uploaded_at DESC`,
    [employeeId],
  );
  return rows.map(mapUploadRow);
}

export async function getMyDocuments(user: AuthUser) {
  if (!canUploadEmployeeDocuments(user) && !canViewAllEmployeeDocuments(user)) {
    throw Object.assign(new Error("You do not have access to employee documents"), { status: 403 });
  }
  const employeeId = await requireEmployeeIdForUser(user);
  const uploads = await listUploadsForEmployee(employeeId);
  const previousEmployers = await listPreviousEmployersForEmployee(employeeId);
  const completion = completionForUploads(
    uploads.map((u) => ({
      id: u.id,
      document_type: u.documentType,
      slot: u.slot,
      file_name: u.fileName,
      mime_type: u.mimeType,
      file_size: u.fileSize,
      uploaded_at: u.uploadedAt,
    })),
  );
  return {
    employeeId,
    uploads,
    previousEmployers,
    completion,
    specs: DOCUMENT_TYPE_SPECS,
    sectionLabels: DOCUMENT_SECTION_LABELS,
    canUpload: canUploadEmployeeDocuments(user),
  };
}

export async function listEmployeesWithDocumentStatus(user: AuthUser) {
  if (!canViewAllEmployeeDocuments(user)) {
    throw Object.assign(new Error("HR access required"), { status: 403 });
  }
  const rows = await query<{
    id: number;
    employee_code: string;
    name: string;
    email: string | null;
  }>(
    `SELECT e.id, e.employee_code, e.name, e.email
     FROM employees e
     WHERE e.status = 'active'
     ORDER BY lower(e.name), e.employee_code`,
  );

  const result = [];
  for (const e of rows) {
    const uploads = await query<StoredUploadRow>(
      `SELECT id, document_type, slot, file_name, mime_type, file_size, uploaded_at
       FROM employee_documents WHERE employee_id = $1`,
      [e.id],
    );
    const completion = completionForUploads(uploads);
    result.push({
      employeeId: e.id,
      employeeCode: e.employee_code,
      name: e.name,
      email: e.email,
      uploadCount: uploads.length,
      complete: completion.complete,
      missingLabels: completion.missingLabels,
    });
  }
  return result;
}

export async function getEmployeeDocumentsAdmin(user: AuthUser, employeeId: number) {
  if (!canViewAllEmployeeDocuments(user)) {
    throw Object.assign(new Error("HR access required"), { status: 403 });
  }
  const emp = await queryOne<{ id: number; employee_code: string; name: string; email: string | null }>(
    `SELECT id, employee_code, name, email FROM employees WHERE id = $1`,
    [employeeId],
  );
  if (!emp) {
    throw Object.assign(new Error("Employee not found"), { status: 404 });
  }
  const uploads = await listUploadsForEmployee(employeeId);
  const previousEmployers = await listPreviousEmployersForEmployee(employeeId);
  const completion = completionForUploads(
    uploads.map((u) => ({
      id: u.id,
      document_type: u.documentType,
      slot: u.slot,
      file_name: u.fileName,
      mime_type: u.mimeType,
      file_size: u.fileSize,
      uploaded_at: u.uploadedAt,
    })),
  );
  return {
    employee: {
      id: emp.id,
      employeeCode: emp.employee_code,
      name: emp.name,
      email: emp.email,
    },
    uploads,
    previousEmployers,
    completion,
    specs: DOCUMENT_TYPE_SPECS,
    sectionLabels: DOCUMENT_SECTION_LABELS,
  };
}

export async function uploadDocument(
  user: AuthUser,
  input: { documentType: string; slot: number; file: Express.Multer.File },
) {
  if (!canUploadEmployeeDocuments(user)) {
    throw Object.assign(new Error("HR and admin do not upload documents here"), { status: 403 });
  }
  const employeeId = await requireEmployeeIdForUser(user);
  const spec = specForType(input.documentType);
  if (!spec) {
    throw Object.assign(new Error("Unknown document type"), { status: 400 });
  }
  if (input.slot < 0 || input.slot >= spec.maxFiles) {
    throw Object.assign(new Error("Invalid slot for this document type"), { status: 400 });
  }

  const buffer = input.file.buffer;
  if (!buffer?.length) {
    throw Object.assign(new Error("Empty file"), { status: 400 });
  }
  if (buffer.length > MAX_FILE_BYTES) {
    throw Object.assign(new Error("File must be 10 MB or smaller"), { status: 400 });
  }
  const mime = (input.file.mimetype || "application/octet-stream").toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    throw Object.assign(new Error("Allowed formats: PDF, JPEG, PNG, WebP"), { status: 400 });
  }

  const fileName = (input.file.originalname || "document").replace(/[^\w.\- ()]/g, "_").slice(0, 200);

  const inserted = await queryOne<{ id: number }>(
    `INSERT INTO employee_documents (
       employee_id, document_type, slot, file_name, mime_type, file_data, file_size, uploaded_by_user_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (employee_id, document_type, slot)
     DO UPDATE SET
       file_name = EXCLUDED.file_name,
       mime_type = EXCLUDED.mime_type,
       file_data = EXCLUDED.file_data,
       file_size = EXCLUDED.file_size,
       uploaded_by_user_id = EXCLUDED.uploaded_by_user_id,
       uploaded_at = NOW()
     RETURNING id`,
    [employeeId, input.documentType, input.slot, fileName, mime, buffer, buffer.length, user.id],
  );

  if (!inserted) {
    throw Object.assign(new Error("Upload failed"), { status: 500 });
  }

  const uploads = await listUploadsForEmployee(employeeId);
  const completion = completionForUploads(
    uploads.map((u) => ({
      id: u.id,
      document_type: u.documentType,
      slot: u.slot,
      file_name: u.fileName,
      mime_type: u.mimeType,
      file_size: u.fileSize,
      uploaded_at: u.uploadedAt,
    })),
  );

  return { uploadId: inserted.id, uploads, completion };
}

export async function deleteDocument(user: AuthUser, documentId: number) {
  const row = await queryOne<{ id: number; employee_id: number }>(
    `SELECT id, employee_id FROM employee_documents WHERE id = $1`,
    [documentId],
  );
  if (!row) {
    throw Object.assign(new Error("Document not found"), { status: 404 });
  }

  const ownId = await findEmployeeIdByUserEmail(user.email);
  const isOwner = ownId === row.employee_id && canUploadEmployeeDocuments(user);
  if (!isOwner) {
    throw Object.assign(new Error("Not allowed to delete this document"), { status: 403 });
  }

  await query(`DELETE FROM employee_documents WHERE id = $1`, [documentId]);
  return { ok: true };
}

export async function getDocumentFile(
  user: AuthUser,
  documentId: number,
): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
  const row = await queryOne<{
    id: number;
    employee_id: number;
    file_name: string;
    mime_type: string;
    file_data: Buffer;
  }>(
    `SELECT id, employee_id, file_name, mime_type, file_data
     FROM employee_documents WHERE id = $1`,
    [documentId],
  );
  if (!row) {
    throw Object.assign(new Error("Document not found"), { status: 404 });
  }
  await assertCanAccessEmployee(user, row.employee_id);
  return {
    buffer: row.file_data,
    fileName: row.file_name,
    mimeType: row.mime_type,
  };
}

export function documentsMeta(user: AuthUser) {
  return {
    specs: DOCUMENT_TYPE_SPECS,
    sectionLabels: DOCUMENT_SECTION_LABELS,
    canUpload: canUploadEmployeeDocuments(user),
    canViewAll: canViewAllEmployeeDocuments(user),
    maxFileBytes: MAX_FILE_BYTES,
    allowedMime: [...ALLOWED_MIME],
  };
}
