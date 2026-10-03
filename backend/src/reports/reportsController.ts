import type { Request, Response } from "express";
import type { AuthedRequest } from "../auth/middleware.js";
import { loadReport, listAccessibleReportTypes, type ReportType } from "./reportsService.js";

const REPORT_TYPES = new Set<ReportType>([
  "admin",
  "self",
  "team",
  "leave",
  "in-out",
  "payroll",
  "contact",
  "email",
]);

function parseReportType(raw: string | undefined): ReportType | null {
  if (!raw) return null;
  const type = raw.trim().toLowerCase() as ReportType;
  return REPORT_TYPES.has(type) ? type : null;
}

export async function handleReportsList(req: Request, res: Response): Promise<void> {
  const authed = req as AuthedRequest;
  if (!authed.authUser) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  res.json({ types: listAccessibleReportTypes(authed.authUser) });
}

export async function handleReport(req: Request, res: Response): Promise<void> {
  const authed = req as AuthedRequest;
  if (!authed.authUser) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  const type = parseReportType(typeof req.params.type === "string" ? req.params.type : undefined);
  if (!type) {
    res.status(400).json({ message: "Invalid report type" });
    return;
  }

  const q = req.query ?? {};
  const year = Number.parseInt(String(q.year ?? ""), 10);
  const month = Number.parseInt(String(q.month ?? ""), 10);
  const company =
    (typeof q.company === "string" ? q.company : typeof q.companyName === "string" ? q.companyName : "")
      .trim() || "PM";

  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    res.status(400).json({ message: "year and month (1-12) query params are required" });
    return;
  }

  try {
    res.json({
      report: await loadReport({
        type,
        year,
        month,
        company,
        user: authed.authUser,
      }),
    });
  } catch (e) {
    const status =
      e && typeof e === "object" && "status" in e && typeof (e as { status: number }).status === "number"
        ? (e as { status: number }).status
        : 500;
    res.status(status).json({ message: e instanceof Error ? e.message : "Failed to load report" });
  }
}
