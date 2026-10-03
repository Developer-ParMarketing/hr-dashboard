import { query, queryOne } from "../db/index.js";
import type { SalaryUploadRow } from "./types.js";
import { buildSalaryUploadSession } from "./salaryService.js";

export type SalaryWorkbookMeta = {
  uploadId: string;
  fileName: string;
  year: number;
  month: number;
  company: string;
  uploadedBy: string | null;
  uploadedAt: string;
  summary: {
    totalRows: number;
    validRows: number;
    matchedRows: number;
    errorRows: number;
    blockedByApproval: number;
    canCalculate: boolean;
  };
};

export type SalaryWorkbookHistoryEntry = SalaryWorkbookMeta & {
  id: number;
  isCurrent: boolean;
};

export type SalaryWorkbookHistoryPreview = {
  entry: SalaryWorkbookHistoryEntry;
  rows: SalaryUploadRow[];
};

type WorkbookRow = {
  id?: number;
  upload_id: string;
  file_name: string;
  year: number;
  month: number;
  company: string;
  uploaded_by: string | null;
  uploaded_at: string;
  rows_json: SalaryUploadRow[];
  total_rows: number;
  matched_rows: number;
  error_rows: number;
  file_data?: Buffer;
  is_current?: boolean;
};

async function persistRefreshedRows(
  year: number,
  month: number,
  company: string,
  rows: SalaryUploadRow[],
): Promise<void> {
  const summary = summaryFromRows(rows);
  await query(
    `UPDATE salary_workbooks SET
       rows_json = $1::jsonb,
       total_rows = $2,
       matched_rows = $3,
       error_rows = $4
     WHERE year = $5 AND month = $6 AND company = $7`,
    [
      JSON.stringify(rows),
      summary.totalRows,
      summary.matchedRows,
      summary.errorRows,
      year,
      month,
      company,
    ],
  );
}

async function refreshStoredWorkbook(row: WorkbookRow & { file_data: Buffer }): Promise<SalaryWorkbookMeta> {
  const validated = await buildSalaryUploadSession({
    buffer: row.file_data,
    fileName: row.file_name,
    year: row.year,
    month: row.month,
    company: row.company,
    uploadId: row.upload_id,
  });

  await persistRefreshedRows(row.year, row.month, row.company, validated.rows);

  return {
    uploadId: row.upload_id,
    fileName: row.file_name,
    year: row.year,
    month: row.month,
    company: row.company,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at,
    summary: validated.summary,
  };
}

function summaryFromRows(rows: SalaryUploadRow[]) {
  const validRows = rows.filter((r) => r.errors.length === 0);
  const matchedRows = rows.filter((r) => r.matched && r.errors.length === 0);
  const blockedByApproval = rows.filter(
    (r) =>
      r.errors.some(
        (e) => e.includes("approve and lock weekly attendance") || e.includes("approved/locked"),
      ),
  ).length;
  return {
    totalRows: rows.length,
    validRows: validRows.length,
    matchedRows: matchedRows.length,
    errorRows: rows.length - validRows.length,
    blockedByApproval,
    canCalculate: matchedRows.length > 0,
  };
}

function toMeta(row: WorkbookRow): SalaryWorkbookMeta {
  const rows = Array.isArray(row.rows_json) ? row.rows_json : [];
  return {
    uploadId: row.upload_id,
    fileName: row.file_name,
    year: row.year,
    month: row.month,
    company: row.company,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at,
    summary: summaryFromRows(rows),
  };
}

function toHistoryEntry(row: WorkbookRow & { id: number; is_current?: boolean }): SalaryWorkbookHistoryEntry {
  return {
    id: row.id,
    isCurrent: Boolean(row.is_current),
    ...toMeta(row),
  };
}

async function insertSalaryWorkbookHistory(input: {
  buffer: Buffer;
  validated: Awaited<ReturnType<typeof buildSalaryUploadSession>>;
  actor: string;
}): Promise<void> {
  const { validated, buffer, actor } = input;
  await query(
    `INSERT INTO salary_workbook_history (
       year, month, company, file_name, file_data, upload_id, rows_json,
       total_rows, matched_rows, error_rows, uploaded_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
     ON CONFLICT (upload_id) DO NOTHING`,
    [
      validated.year,
      validated.month,
      validated.company,
      validated.fileName,
      buffer,
      validated.uploadId,
      JSON.stringify(validated.rows),
      validated.summary.totalRows,
      validated.summary.matchedRows,
      validated.summary.errorRows,
      actor,
    ],
  );
}

export async function saveSalaryWorkbook(input: {
  buffer: Buffer;
  fileName: string;
  year: number;
  month: number;
  company: string;
  actor: string;
}): Promise<SalaryWorkbookMeta> {
  const validated = await buildSalaryUploadSession({
    buffer: input.buffer,
    fileName: input.fileName,
    year: input.year,
    month: input.month,
    company: input.company,
  });

  const company = validated.company;
  await insertSalaryWorkbookHistory({ buffer: input.buffer, validated, actor: input.actor });
  await query(
    `INSERT INTO salary_workbooks (
       year, month, company, file_name, file_data, upload_id, rows_json,
       total_rows, matched_rows, error_rows, uploaded_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
     ON CONFLICT (year, month, company) DO UPDATE SET
       file_name = EXCLUDED.file_name,
       file_data = EXCLUDED.file_data,
       upload_id = EXCLUDED.upload_id,
       rows_json = EXCLUDED.rows_json,
       total_rows = EXCLUDED.total_rows,
       matched_rows = EXCLUDED.matched_rows,
       error_rows = EXCLUDED.error_rows,
       uploaded_by = EXCLUDED.uploaded_by,
       uploaded_at = NOW()`,
    [
      validated.year,
      validated.month,
      company,
      validated.fileName,
      input.buffer,
      validated.uploadId,
      JSON.stringify(validated.rows),
      validated.summary.totalRows,
      validated.summary.matchedRows,
      validated.summary.errorRows,
      input.actor,
    ],
  );

  const saved = await getSalaryWorkbook(validated.year, validated.month, company);
  if (!saved) throw new Error("Failed to save salary workbook");
  return saved;
}

export async function getSalaryWorkbook(
  year: number,
  month: number,
  company: string,
): Promise<SalaryWorkbookMeta | null> {
  const row = await queryOne<WorkbookRow>(
    `SELECT upload_id, file_name, year, month, company, uploaded_by, uploaded_at,
            rows_json, total_rows, matched_rows, error_rows
     FROM salary_workbooks
     WHERE year = $1 AND month = $2 AND company = $3`,
    [year, month, company.trim() || "PM"],
  );
  if (!row) return null;
  return toMeta(row);
}

export async function deleteSalaryWorkbook(
  year: number,
  month: number,
  company: string,
): Promise<boolean> {
  const removed = await queryOne<{ id: number }>(
    `DELETE FROM salary_workbooks WHERE year = $1 AND month = $2 AND company = $3 RETURNING id`,
    [year, month, company.trim() || "PM"],
  );
  return Boolean(removed);
}

export async function refreshWorkbookSessionForPeriod(
  year: number,
  month: number,
  company: string,
): Promise<SalaryWorkbookMeta | null> {
  const row = await queryOne<WorkbookRow & { file_data: Buffer }>(
    `SELECT upload_id, file_name, year, month, company, uploaded_by, uploaded_at,
            rows_json, total_rows, matched_rows, error_rows, file_data
     FROM salary_workbooks
     WHERE year = $1 AND month = $2 AND company = $3`,
    [year, month, company.trim() || "PM"],
  );
  if (!row) return null;
  return refreshStoredWorkbook(row);
}

export async function refreshWorkbookSessionByUploadId(uploadId: string): Promise<boolean> {
  const row = await queryOne<WorkbookRow & { file_data: Buffer }>(
    `SELECT upload_id, file_name, year, month, company, uploaded_by, uploaded_at,
            rows_json, total_rows, matched_rows, error_rows, file_data
     FROM salary_workbooks
     WHERE upload_id = $1`,
    [uploadId],
  );
  if (!row) return false;
  await refreshStoredWorkbook(row);
  return true;
}

/** @deprecated Use refreshWorkbookSessionByUploadId - re-parses stored Excel instead of frozen rows_json. */
export async function restoreWorkbookSession(uploadId: string): Promise<boolean> {
  return refreshWorkbookSessionByUploadId(uploadId);
}

export async function listSalaryWorkbookHistory(input: {
  year: number;
  month: number;
  company: string;
  limit?: number;
  offset?: number;
}): Promise<{ entries: SalaryWorkbookHistoryEntry[]; total: number }> {
  const company = input.company.trim() || "PM";
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);

  const countRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM salary_workbook_history
     WHERE year = $1 AND month = $2 AND company = $3`,
    [input.year, input.month, company],
  );
  const total = Number.parseInt(countRow?.count ?? "0", 10) || 0;

  const rows = await query<WorkbookRow & { id: number; is_current: boolean }>(
    `SELECT h.id, h.upload_id, h.file_name, h.year, h.month, h.company, h.uploaded_by, h.uploaded_at,
            h.rows_json, h.total_rows, h.matched_rows, h.error_rows,
            (w.upload_id IS NOT NULL) AS is_current
     FROM salary_workbook_history h
     LEFT JOIN salary_workbooks w
       ON w.year = h.year AND w.month = h.month AND w.company = h.company AND w.upload_id = h.upload_id
     WHERE h.year = $1 AND h.month = $2 AND h.company = $3
     ORDER BY h.uploaded_at DESC
     LIMIT $4 OFFSET $5`,
    [input.year, input.month, company, limit, offset],
  );

  return {
    entries: rows.map((row) => toHistoryEntry(row)),
    total,
  };
}

export async function getSalaryWorkbookHistoryPreview(id: number): Promise<SalaryWorkbookHistoryPreview | null> {
  const row = await queryOne<WorkbookRow & { id: number; is_current: boolean }>(
    `SELECT h.id, h.upload_id, h.file_name, h.year, h.month, h.company, h.uploaded_by, h.uploaded_at,
            h.rows_json, h.total_rows, h.matched_rows, h.error_rows,
            (w.upload_id IS NOT NULL) AS is_current
     FROM salary_workbook_history h
     LEFT JOIN salary_workbooks w
       ON w.year = h.year AND w.month = h.month AND w.company = h.company AND w.upload_id = h.upload_id
     WHERE h.id = $1`,
    [id],
  );
  if (!row) return null;
  const rows = Array.isArray(row.rows_json) ? row.rows_json : [];
  return {
    entry: toHistoryEntry(row),
    rows,
  };
}

export async function getSalaryWorkbookHistoryFile(
  id: number,
): Promise<{ fileName: string; fileData: Buffer } | null> {
  const row = await queryOne<{ file_name: string; file_data: Buffer }>(
    `SELECT file_name, file_data FROM salary_workbook_history WHERE id = $1`,
    [id],
  );
  if (!row) return null;
  return { fileName: row.file_name, fileData: row.file_data };
}
