import type { Request, Response } from "express";
import fs from "fs";
import type { AuthedRequest } from "../auth/middleware.js";
import { actorFromRequest } from "../auth/routes.js";
import {
  importSalaryBaseFromExcel,
} from "./salaryBase.js";
import {
  calculateSalaryUpload,
  isSalaryValidationError,
  listSalaryResults,
  validateSalaryUpload,
} from "./salaryService.js";
import {
  loadSalarySheet,
  parseSheetInputRows,
  previewSalarySheet,
  saveSalarySheet,
  saveSalarySheetRow,
  exportSalarySheetWorkbook,
} from "./salarySheet.js";
import {
  getSalaryWorkbookHistoryFile,
  getSalaryWorkbookHistoryPreview,
  listSalaryWorkbookHistory,
} from "./salaryWorkbook.js";

function parseYearMonth(body: Record<string, unknown>): { year: number; month: number; company: string } {
  const year = Number.parseInt(String(body.year ?? ""), 10);
  const month = Number.parseInt(String(body.month ?? ""), 10);
  const company =
    (typeof body.company === "string" ? body.company : typeof body.companyName === "string" ? body.companyName : "")
      .trim() || "PM";
  return { year, month, company };
}

function parseRowOverrides(
  value: unknown,
): { employeeCode: string; grossSalary: number; adjustment: number }[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const out: { employeeCode: string; grossSalary: number; adjustment: number }[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const employeeCode = typeof row.employeeCode === "string" ? row.employeeCode.trim() : "";
    const grossSalary = Number(row.grossSalary);
    const adjustment = Number(row.adjustment ?? 0);
    if (!employeeCode || !Number.isFinite(grossSalary) || grossSalary <= 0) continue;
    out.push({
      employeeCode,
      grossSalary,
      adjustment: Number.isFinite(adjustment) ? adjustment : 0,
    });
  }
  return out.length ? out : undefined;
}

export async function handleSalaryValidate(req: Request, res: Response): Promise<void> {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file?.path) {
    res.status(400).json({ message: "Missing salary Excel file (field name: file)" });
    return;
  }

  const { year, month, company } = parseYearMonth((req.body ?? {}) as Record<string, unknown>);

  try {
    const buffer = fs.readFileSync(file.path);
    const result = await validateSalaryUpload({
      buffer,
      fileName: file.originalname ?? "salary.xlsx",
      year,
      month,
      company,
    });
    res.json(result);
  } catch (e) {
    const status =
      isSalaryValidationError(e) || (e instanceof Error && "status" in e && typeof (e as { status: number }).status === "number")
        ? (e as { status: number }).status
        : 400;
    res.status(status).json({ message: e instanceof Error ? e.message : "Validation failed" });
  } finally {
    fs.unlink(file.path, () => {});
  }
}

export async function handleSalaryCalculate(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const uploadId = typeof body.uploadId === "string" ? body.uploadId.trim() : "";
  const year = Number.parseInt(String(body.year ?? ""), 10);
  const month = Number.parseInt(String(body.month ?? ""), 10);
  const company =
    (typeof body.company === "string" ? body.company : typeof body.companyName === "string" ? body.companyName : "")
      .trim() || undefined;

  if (!uploadId && (!Number.isFinite(year) || !Number.isFinite(month) || !company)) {
    res.status(400).json({ message: "uploadId or year/month/company is required" });
    return;
  }

  try {
    const actor = actorFromRequest(req as AuthedRequest, body.actor);
    const rowOverrides = parseRowOverrides(body.rows);
    const result = await calculateSalaryUpload({
      uploadId: uploadId || undefined,
      year: Number.isFinite(year) ? year : undefined,
      month: Number.isFinite(month) ? month : undefined,
      company,
      actor,
      rowOverrides,
    });
    res.json(result);
  } catch (e) {
    const status = e instanceof Error && "status" in e && typeof (e as { status: number }).status === "number"
      ? (e as { status: number }).status
      : 500;
    res.status(status).json({ message: e instanceof Error ? e.message : "Calculation failed" });
  }
}

export async function handleSalaryResults(req: Request, res: Response): Promise<void> {
  const year = Number.parseInt(String(req.query.year ?? ""), 10);
  const month = Number.parseInt(String(req.query.month ?? ""), 10);
  const company = typeof req.query.company === "string" ? req.query.company : undefined;

  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    res.status(400).json({ message: "year and month query params are required" });
    return;
  }

  try {
    res.json(await listSalaryResults({ year, month, company }));
  } catch (e) {
    const status = isSalaryValidationError(e) ? 400 : 500;
    res.status(status).json({ message: e instanceof Error ? e.message : "Failed to load results" });
  }
}

function parseHistoryQuery(query: Record<string, unknown>): {
  year: number;
  month: number;
  company: string;
  limit: number;
  offset: number;
} | null {
  const year = Number.parseInt(String(query.year ?? ""), 10);
  const month = Number.parseInt(String(query.month ?? ""), 10);
  const company =
    (typeof query.company === "string" ? query.company : typeof query.companyName === "string" ? query.companyName : "")
      .trim() || "PM";
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  const limit = Number.parseInt(String(query.limit ?? "20"), 10);
  const offset = Number.parseInt(String(query.offset ?? "0"), 10);
  return {
    year,
    month,
    company,
    limit: Number.isFinite(limit) ? limit : 20,
    offset: Number.isFinite(offset) ? offset : 0,
  };
}

export async function handleSalaryWorkbookHistory(req: Request, res: Response): Promise<void> {
  const parsed = parseHistoryQuery((req.query ?? {}) as Record<string, unknown>);
  if (!parsed) {
    res.status(400).json({ message: "year and month (1-12) query params are required" });
    return;
  }

  try {
    res.json(
      await listSalaryWorkbookHistory({
        year: parsed.year,
        month: parsed.month,
        company: parsed.company,
        limit: parsed.limit,
        offset: parsed.offset,
      }),
    );
  } catch (e) {
    res.status(500).json({ message: e instanceof Error ? e.message : "Failed to load salary workbook history" });
  }
}

export async function handleSalaryWorkbookHistoryPreview(req: Request, res: Response): Promise<void> {
  const id = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ message: "Invalid history id" });
    return;
  }

  try {
    const preview = await getSalaryWorkbookHistoryPreview(id);
    if (!preview) {
      res.status(404).json({ message: "Salary workbook upload not found" });
      return;
    }
    res.json(preview);
  } catch (e) {
    res.status(500).json({ message: e instanceof Error ? e.message : "Failed to load salary workbook preview" });
  }
}

export async function handleSalaryWorkbookHistoryDownload(req: Request, res: Response): Promise<void> {
  const id = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ message: "Invalid history id" });
    return;
  }

  try {
    const file = await getSalaryWorkbookHistoryFile(id);
    if (!file) {
      res.status(404).json({ message: "Salary workbook upload not found" });
      return;
    }
    const safeName = file.fileName.replace(/[^\w.\- ()[\]]+/g, "_") || "salary.xlsx";
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    res.send(file.fileData);
  } catch (e) {
    res.status(500).json({ message: e instanceof Error ? e.message : "Failed to download salary workbook" });
  }
}

export async function handleSalarySheetGet(req: Request, res: Response): Promise<void> {
  const year = Number.parseInt(String(req.query.year ?? ""), 10);
  const month = Number.parseInt(String(req.query.month ?? ""), 10);
  const company =
    (typeof req.query.company === "string"
      ? req.query.company
      : typeof req.query.companyName === "string"
        ? req.query.companyName
        : ""
    ).trim() || "PM";

  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    res.status(400).json({ message: "year and month query params are required" });
    return;
  }

  try {
    res.json(await loadSalarySheet({ year, month, company, withPreview: true }));
  } catch (e) {
    const status = isSalaryValidationError(e) ? 400 : 500;
    res.status(status).json({ message: e instanceof Error ? e.message : "Failed to load salary sheet" });
  }
}

export async function handleSalarySheetSave(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { year, month, company } = parseYearMonth(body);
  const rows = parseSheetInputRows(body.rows);

  if (rows.length === 0) {
    res.status(400).json({ message: "rows array is required" });
    return;
  }

  try {
    const actor = actorFromRequest(req as AuthedRequest, body.actor);
    res.json(await saveSalarySheet({ year, month, company, rows, actor }));
  } catch (e) {
    const status = isSalaryValidationError(e) ? 400 : 500;
    res.status(status).json({ message: e instanceof Error ? e.message : "Failed to save salary sheet" });
  }
}

export async function handleSalarySheetPreview(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { year, month, company } = parseYearMonth(body);
  const rows = parseSheetInputRows(body.rows);

  try {
    res.json(await previewSalarySheet({ year, month, company, rows }));
  } catch (e) {
    const status = isSalaryValidationError(e) ? 400 : 500;
    res.status(status).json({ message: e instanceof Error ? e.message : "Failed to preview salary sheet" });
  }
}

export async function handleSalarySheetRowSave(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { year, month, company } = parseYearMonth(body);
  const rows = parseSheetInputRows(body.row != null ? [body.row] : body.rows);
  const row = rows[0];
  if (!row) {
    res.status(400).json({ message: "row object is required" });
    return;
  }

  try {
    const actor = actorFromRequest(req as AuthedRequest, body.actor);
    const saved = await saveSalarySheetRow({ year, month, company, row, actor });
    res.json(saved);
  } catch (e) {
    const status =
      e instanceof Error && "status" in e && typeof (e as { status: number }).status === "number"
        ? (e as { status: number }).status
        : isSalaryValidationError(e)
          ? 400
          : 500;
    res.status(status).json({ message: e instanceof Error ? e.message : "Failed to save row" });
  }
}

export async function handleSalaryBaseImport(req: Request, res: Response): Promise<void> {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file?.path) {
    res.status(400).json({ message: "Missing Excel file (field name: file)" });
    return;
  }

  const { company } = parseYearMonth((req.body ?? {}) as Record<string, unknown>);

  try {
    const buffer = fs.readFileSync(file.path);
    const actor = actorFromRequest(req as AuthedRequest, (req.body ?? {}) as Record<string, unknown>);
    const result = await importSalaryBaseFromExcel({ buffer, company, actor });
    const nameNote =
      result.matchedByName > 0
        ? ` ${result.matchedByName} row${result.matchedByName === 1 ? "" : "s"} matched by name similarity (code differed in Excel).`
        : "";
    res.json({
      message: `Loaded base salary for ${result.matched} employee${result.matched === 1 ? "" : "s"} (In Hand carries forward each month).${nameNote}`,
      ...result,
    });
  } catch (e) {
    const status =
      e instanceof Error && "status" in e && typeof (e as { status: number }).status === "number"
        ? (e as { status: number }).status
        : 400;
    res.status(status).json({ message: e instanceof Error ? e.message : "Import failed" });
  } finally {
    fs.unlink(file.path, () => {});
  }
}

export async function handleSalaryExport(req: Request, res: Response): Promise<void> {
  const year = Number.parseInt(String(req.query.year ?? ""), 10);
  const month = Number.parseInt(String(req.query.month ?? ""), 10);
  const company =
    (typeof req.query.company === "string"
      ? req.query.company
      : typeof req.query.companyName === "string"
        ? req.query.companyName
        : ""
    ).trim() || "PM";
  const useResults = String(req.query.results ?? "1") !== "0";

  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    res.status(400).json({ message: "year and month query params are required" });
    return;
  }

  try {
    const { buffer, fileName, rowCount } = await exportSalarySheetWorkbook({
      year,
      month,
      company,
      useResults,
    });
    if (rowCount === 0) {
      res.status(404).json({ message: "No salary rows to export for this month." });
      return;
    }
    const safeName = fileName.replace(/[^\w.\- ()[\]]+/g, "_");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    res.send(buffer);
  } catch (e) {
    const status = isSalaryValidationError(e) ? 400 : 500;
    res.status(status).json({ message: e instanceof Error ? e.message : "Export failed" });
  }
}
