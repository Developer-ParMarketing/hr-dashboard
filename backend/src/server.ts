/**
 * HTTP API for the HR dashboard.
 *
 * Route handlers are grouped in feature folders (auth/, persist/, leaveRequests/, …).
 * This file mounts paths and runs the ESSL ingest bridge (scripts/pdf_to_json.py +
 * backend/python_tools/attendance_tool.py). Overview: README.md at the repo root.
 */
import express from "express";
import multer from "multer";
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { databaseLabel, initDb, pingDatabase, query } from "./db/index.js";
import { persistProcessedAttendance } from "./persist/ingest.js";
import { AttendanceLockedError } from "./persist/helpers.js";
import { ValidationError, validateParsedEmployees } from "./persist/validate.js";
import {
  listEmployees,
  listHistory,
  listRecentUploads,
  listBrowsePeriodsForScope,
  listSavedPeriods,
  loadMonthSnapshot,
  patchDailyAttendance,
  patchEmployee,
  recordUploadHistory,
  saveWeeklyEdit,
  setWeeklyStatus,
} from "./persist/queries.js";
import { sendSmtpMail } from "./notify/smtp.js";
import {
  sendLateNotification,
  sendWeeklyHoursNotification,
  sendWeeklyDataReviewNotification,
  runScheduledNotifications,
} from "./notify/service.js";
import { startNotificationScheduler, startOffboardingScheduler } from "./notify/schedule.js";
import { authSecret, requireAuth, requireAdmin, requireEditor, type AuthedRequest } from "./auth/middleware.js";
import { requireHolidayManager } from "./holidays/guard.js";
import { resolveAttendanceScope } from "./auth/attendanceScope.js";
import {
  handleMe,
  handleLogout,
  handleLogin,
  handleLoginVerify,
  handleLoginResend,
  handleForgotPassword,
  handleForgotPasswordVerify,
  handleAccountSetupChallenge,
  handleAccountSetupComplete,
  handleAccountSetupResend,
  handleChangePassword,
  actorFromRequest,
} from "./auth/routes.js";
import {
  handleCreateUser,
  handleCheckSimilarWorkEmail,
  handleCreateAdminEmployee,
  handleDeleteSalaryWorkbook,
  handleDeleteUser,
  handleGetAdminEmployee,
  handleGetManagerAssignments,
  handleGetSalaryWorkbook,
  handleListAdminEmployees,
  handleListEmployeesForAssignment,
  handleListManagers,
  handleListUsers,
  handlePublicSalaryWorkbook,
  handleSaveSalaryWorkbook,
  handleSetManagerAssignments,
  handleUpdateAdminEmployee,
  handleUpdateUser,
} from "./auth/adminRoutes.js";
import { handleListTeams, handleGetTeamMembers, handleSetTeamMembers, handleSetTeamManager, handleReapplyTeamPins } from "./teams/teamRoutes.js";
import { seedTeams, seedPinnedEmployeeTeams } from "./teams/teams.js";
import {
  handleCopyHolidays,
  handleListHolidays,
  handleSaveHolidays,
} from "./holidays/routes.js";
import { seedDefaultHolidaysIfEmpty } from "./holidays/holidays.js";
import {
  handleAdminListPerformance,
  handleGetMyPerformance,
  handleGetPerformanceForEmployee,
  handleGetPerformanceMeta,
  handleListLeadershipPerformance,
  handleListTeamPerformance,
  handleSavePerformance,
} from "./performance/routes.js";
import {
  handleAdminListGoalSheet,
  handleGetGoalSheetForEmployee,
  handleGetGoalSheetMeta,
  handleGetMyGoalSheet,
  handleListLeadershipGoalSheet,
  handleListTeamGoalSheet,
  handleSaveGoalSheet,
} from "./goalSheet/routes.js";
import {
  handleCancelLeaveRequest,
  handleCreateLeaveRequest,
  handlePreviewLeaveApply,
  handleDecideLeaveRequest,
  handleLeaveRequestBalance,
  handleLeaveRequestMeta,
  handleEmployeeLeaveHistory,
  handleListScopedLeaveRequests,
  handleListAllLeaveRequests,
  handleListMyLeaveRequests,
  handleListPendingLeaveRequests,
} from "./leaveRequests/routes.js";
import {
  handleDecidePortalPunch,
  handleListAllPortalPunches,
  handleListScopedPortalPunches,
  handleEmployeePortalPunchHistory,
  handleListMyPortalPunches,
  handleListPendingPortalPunches,
  handlePortalCheckIn,
  handlePortalCheckOut,
  handlePortalPunchMeta,
} from "./portalPunch/routes.js";
import {
  handleCancelReimbursement,
  handleCreateReimbursement,
  handleDecideReimbursement,
  handleDownloadReimbursementReceipt,
  handleListAllReimbursements,
  handleListMyReimbursements,
  handleListPendingReimbursements,
  handleReimbursementMeta,
  handleUpdateReimbursementSpecialApprovalMin,
  handleUploadReimbursementReceipts,
} from "./reimbursementRequests/routes.js";
import {
  handleOfferLetterMeta,
  handleParseOfferExcel,
  handlePreviewOfferEmail,
  handlePreviewOfferPdf,
  handleSendOfferLetters,
  requireOfferLetterAccess,
} from "./offerLetters/routes.js";
import {
  handleGenerateRelievingLetter,
  handleGenerateRelievingLetterPdf,
  handleRelievingLetterMeta,
  handleSaveRelievingSignature,
  requireRelievingLetterAccessMiddleware,
} from "./relievingLetters/routes.js";
import {
  handleDeleteDocument,
  handleDocumentsMeta,
  handleDownloadDocument,
  handleGetEmployeeDocuments,
  handleGetMyDocuments,
  handleListEmployeesDocuments,
  handleUploadDocument,
  handleSavePreviousEmployers,
} from "./employeeDocuments/routes.js";
import { bootstrapFirstUser } from "./auth/users.js";
import {
  handleSalaryCalculate,
  handleSalaryResults,
  handleSalaryBaseImport,
  handleSalaryExport,
  handleSalarySheetGet,
  handleSalarySheetPreview,
  handleSalarySheetRowSave,
  handleSalarySheetSave,
  handleSalaryValidate,
  handleSalaryWorkbookHistory,
  handleSalaryWorkbookHistoryDownload,
  handleSalaryWorkbookHistoryPreview,
} from "./salary/salaryController.js";
import { handleDashboardEmployeeFilterOptions, handleDashboardNotifications, handleDashboardSummary } from "./dashboard/dashboardController.js";
import { handleReport, handleReportsList } from "./reports/reportsController.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(API_ROOT, "scripts", "pdf_to_json.py");
const MERGE_SCRIPT = path.join(API_ROOT, "scripts", "merge_cross_reports.py");
const PYTHON = process.env.PYTHON ?? "python3";

const upload = multer({ storage: multer.diskStorage({}) });
const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});
const uploadEmployeeDoc = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});
const uploadReimbursementReceipts = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
});
const uploadRelievingSignature = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});
const downloads = new Map<string, string>();

type MulterFiles = Record<string, Express.Multer.File[] | undefined>;

function safeUnlink(p: string | undefined) {
  if (p) fs.unlink(p, () => {});
}

function parseRouteId(raw: string | string[] | undefined): number | null {
  const text = Array.isArray(raw) ? raw[0] : raw;
  if (text == null || text === "") return null;
  const id = Number.parseInt(text, 10);
  return Number.isFinite(id) ? id : null;
}

function runMerge(
  employeesJsonPath: string,
  year: number,
  month: number,
  leavePath: string | null,
  wfhPath: string | null,
  reportType: "daily" | "weekly" | "monthly" = "monthly",
  reportDay?: number,
): Promise<{ employees: unknown[]; crossCheck?: unknown }> {
  return new Promise((resolve, reject) => {
    const args = [
      MERGE_SCRIPT,
      employeesJsonPath,
      String(year),
      String(month),
      leavePath ?? "-",
      wfhPath ?? "-",
      reportType,
    ];
    if (typeof reportDay === "number" && reportDay >= 1 && reportDay <= 31) {
      args.push(String(reportDay));
    }
    execFile(PYTHON, args, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || String(err)));
        return;
      }
      try {
        const data = JSON.parse(stdout.trim()) as {
          employees?: unknown[];
          crossCheck?: unknown;
          error?: string;
        };
        if (data.error && !(data.employees && (data.employees as unknown[]).length)) {
          reject(new Error(data.error));
          return;
        }
        resolve({
          employees: data.employees ?? [],
          crossCheck: data.crossCheck,
        });
      } catch {
        reject(new Error(`Bad JSON from merge script: ${stdout.slice(0, 400)}`));
      }
    });
  });
}

function runBridge(
  pdfPath: string,
  company: string,
  reportType: "daily" | "weekly" | "monthly",
): Promise<{
  employees: unknown[];
  excelPath?: string;
  reportDay?: number;
  reportDate?: string;
  reportDateIso?: string;
  parseMeta?: unknown;
}> {
  return new Promise((resolve, reject) => {
    const args = [SCRIPT, pdfPath, company.trim(), reportType];

    execFile(
      PYTHON,
      args,
      { env: process.env, maxBuffer: 20 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr || String(err)));
          return;
        }
        try {
          const data = JSON.parse(stdout.trim()) as {
            employees?: unknown[];
            excelPath?: string;
            reportDay?: number;
            reportDate?: string;
            reportDateIso?: string;
            parseMeta?: unknown;
            error?: string;
          };
          if (data.error && !(data.employees && data.employees.length)) {
            reject(new Error(data.error));
            return;
          }
          resolve({
            employees: data.employees ?? [],
            excelPath: data.excelPath,
            reportDay: data.reportDay,
            reportDate: data.reportDate,
            reportDateIso: data.reportDateIso,
            parseMeta: data.parseMeta,
          });
        } catch {
          reject(new Error(`Bad JSON from Python: ${stdout.slice(0, 400)}`));
        }
      },
    );
  });
}

const app = express();
const PORT = Number(process.env.ATTENDANCE_API_PORT ?? 8787);
const HOST = process.env.HOST?.trim() || "0.0.0.0";
const NODE_ENV = process.env.NODE_ENV?.trim() || "development";

function parseCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (!raw) return ["http://localhost:5173"];
  if (raw === "*") return ["*"];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

const corsOrigins = parseCorsOrigins();

function resolveCorsAllowOrigin(requestOrigin: string | undefined): string {
  if (corsOrigins.includes("*")) {
    return typeof requestOrigin === "string" ? requestOrigin : "*";
  }
  if (requestOrigin && corsOrigins.includes(requestOrigin)) return requestOrigin;
  return corsOrigins[0] ?? "http://localhost:5173";
}

app.use(express.json({ limit: "2mb" }));

app.use((req, res, next) => {
  const allowOrigin = resolveCorsAllowOrigin(
    typeof req.headers.origin === "string" ? req.headers.origin : undefined,
  );
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Actor");
  if (allowOrigin !== "*") res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Vary", "Origin");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/health/ready", async (_req, res) => {
  try {
    await pingDatabase();
    res.json({ ok: true, db: "up" });
  } catch (err) {
    res.status(503).json({
      ok: false,
      db: "down",
      message: err instanceof Error ? err.message : "database unavailable",
    });
  }
});

// --- Auth (login routes below are registered before requireAuth) ---

app.post("/api/auth/login", (req, res) => {
  void handleLogin(req, res);
});
app.post("/api/auth/login/verify", (req, res) => {
  void handleLoginVerify(req, res);
});
app.post("/api/auth/login/resend", (req, res) => {
  void handleLoginResend(req, res);
});
app.post("/api/auth/forgot-password", (req, res) => {
  void handleForgotPassword(req, res);
});
app.post("/api/auth/forgot-password/reset", (req, res) => {
  void handleForgotPasswordVerify(req, res);
});

app.get("/api/auth/account-setup/challenge/:challengeId", (req, res) => {
  void handleAccountSetupChallenge(req, res);
});
app.post("/api/auth/account-setup/complete", (req, res) => {
  void handleAccountSetupComplete(req, res);
});
app.post("/api/auth/account-setup/resend", (req, res) => {
  void handleAccountSetupResend(req, res);
});

app.use("/api", requireAuth);
app.use("/weekly", requireAuth);

app.get("/api/auth/me", handleMe);
app.post("/api/auth/logout", (req, res) => {
  void handleLogout(req, res);
});
app.post("/api/auth/change-password", (req, res) => {
  void handleChangePassword(req, res);
});

// --- Attendance ingest, saved months, daily/weekly edits ---

app.post(
  "/api/attendance/process",
  requireEditor,
  upload.fields([
    { name: "file", maxCount: 1 },
    { name: "leaveFile", maxCount: 1 },
    { name: "wfhFile", maxCount: 1 },
  ]),
  async (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    const files = req.files as MulterFiles | undefined;
    const pdf = files?.file?.[0];
    if (!pdf?.path) {
      res.status(400).json({ error: "Missing main file (field name: file)" });
      return;
    }
    const requestId = randomUUID();
    const processedAt = new Date().toISOString();
    const uploadName = pdf.originalname ?? "";
    const uploadSize = Number.isFinite(pdf.size) ? Number(pdf.size) : 0;
    console.log(
      `[attendance/process] requestId=${requestId} file="${uploadName}" size=${uploadSize} tmp="${pdf.path}"`,
    );

    const company =
      (typeof req.body?.company === "string"
        ? req.body.company
        : typeof req.body?.companyName === "string"
          ? req.body.companyName
          : ""
      ).trim() || "PM";
    const reportTypeRaw = typeof req.body?.reportType === "string" ? req.body.reportType : "";
    const reportType =
      reportTypeRaw === "daily" || reportTypeRaw === "weekly" || reportTypeRaw === "monthly"
        ? reportTypeRaw
        : "monthly";

    const yRaw = typeof req.body?.reportYear === "string" ? req.body.reportYear : "";
    const mRaw = typeof req.body?.reportMonth === "string" ? req.body.reportMonth : "";
    let year = Number.parseInt(yRaw, 10);
    let month = Number.parseInt(mRaw, 10);
    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
      year = new Date().getFullYear();
    }
    if (!Number.isFinite(month) || month < 1 || month > 12) {
      month = new Date().getMonth() + 1;
    }

    const tmpPdf = pdf.path;
    const leaveF = files?.leaveFile?.[0];
    const wfhF = files?.wfhFile?.[0];
    const leavePath = leaveF?.path;
    const wfhPath = wfhF?.path;
    console.log(
      `[attendance/process] requestId=${requestId} leaveFile="${leaveF?.originalname ?? "none"}" wfhFile="${wfhF?.originalname ?? "none"}"`,
    );

    let empJsonPath: string | undefined;

    try {
      let {
        employees,
        excelPath,
        reportDay,
        reportDate,
        reportDateIso,
        parseMeta,
      } = await runBridge(tmpPdf, company, reportType);

      // Merge leave/WFH against the report month/year parsed from the uploaded ESSL file when available.
      // This avoids mismatches when UI year/month doesn't match the actual register dates.
      let mergeYear = year;
      let mergeMonth = month;
      const isoForMerge =
        typeof reportDateIso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(reportDateIso)
          ? reportDateIso
          : typeof (parseMeta as { reportDateIso?: unknown } | undefined)?.reportDateIso === "string" &&
              /^\d{4}-\d{2}-\d{2}$/.test(
                String((parseMeta as { reportDateIso?: unknown }).reportDateIso),
              )
            ? String((parseMeta as { reportDateIso?: unknown }).reportDateIso)
            : undefined;
      if (isoForMerge) {
        const [yy, mm] = isoForMerge.split("-").map((v) => Number.parseInt(v, 10));
        if (Number.isFinite(yy) && yy >= 2000 && yy <= 2100) mergeYear = yy;
        if (Number.isFinite(mm) && mm >= 1 && mm <= 12) mergeMonth = mm;
      }

      const doMerge =
        (leavePath && fs.existsSync(leavePath)) || (wfhPath && fs.existsSync(wfhPath));
      console.log(
        `[attendance/process] requestId=${requestId} doMerge=${Boolean(doMerge)} mergeYear=${mergeYear} mergeMonth=${mergeMonth} reportType=${reportType} reportDay=${String(reportDay ?? "na")}`,
      );
      let crossCheck: unknown;
      if (doMerge) {
        empJsonPath = path.join(os.tmpdir(), `attendance_emp_${randomUUID()}.json`);
        fs.writeFileSync(empJsonPath, JSON.stringify({ employees }), "utf8");
        const scopeDay =
          typeof reportDay === "number" && reportDay >= 1 && reportDay <= 31
            ? reportDay
            : undefined;
        const merged = await runMerge(
          empJsonPath,
          mergeYear,
          mergeMonth,
          leavePath && fs.existsSync(leavePath) ? leavePath : null,
          wfhPath && fs.existsSync(wfhPath) ? wfhPath : null,
          reportType,
          scopeDay,
        );
        employees = merged.employees;
        crossCheck = merged.crossCheck;
        const cc = merged.crossCheck as
          | {
              replacedAb?: number;
              abCandidates?: number;
              leaveKeys?: number;
              wfhKeys?: number;
              unmatchedSample?: unknown;
            }
          | undefined;
        console.log(
          `[attendance/process] requestId=${requestId} replacedAb=${String(cc?.replacedAb ?? "na")} abCandidates=${String(cc?.abCandidates ?? "na")} leaveKeys=${String(cc?.leaveKeys ?? "na")} wfhKeys=${String(cc?.wfhKeys ?? "na")} unmatchedSample=${JSON.stringify(cc?.unmatchedSample ?? [])}`,
        );
      }

      let downloadUrl: string | undefined;
      if (excelPath && fs.existsSync(excelPath)) {
        const id = randomUUID();
        const dest = path.join(os.tmpdir(), `attendance_${id}.xlsx`);
        fs.copyFileSync(excelPath, dest);
        downloads.set(id, dest);
        downloadUrl = `/api/attendance/export?id=${id}`;
        setTimeout(() => {
          const p = downloads.get(id);
          if (p) {
            fs.unlink(p, () => {});
            downloads.delete(id);
          }
        }, 60 * 60 * 1000);
      }

      const actor = actorFromRequest(req as AuthedRequest, req.body?.actor);
      const source =
        typeof (parseMeta as { source?: unknown } | undefined)?.source === "string"
          ? String((parseMeta as { source: string }).source)
          : "pdf";

      const validated = validateParsedEmployees(employees as unknown[], mergeYear, mergeMonth);
      const persisted = await persistProcessedAttendance({
        employees: validated.employees,
        year: mergeYear,
        month: mergeMonth,
        company,
        source,
        actor,
        requestId,
        reportType,
        reportDay,
      });
      if (persisted.dailyUpserted === 0 && persisted.skippedApprovedWeeks === 0) {
        throw new ValidationError("No daily attendance records were saved");
      }
      await seedPinnedEmployeeTeams();
      console.log(
        `[attendance/process] requestId=${requestId} persisted=${JSON.stringify(persisted)} skippedMissingCode=${validated.skippedMissingCode}`,
      );

      await recordUploadHistory({
        requestId,
        fileName: uploadName,
        fileSize: uploadSize,
        reportType,
        reportYear: mergeYear,
        reportMonth: mergeMonth,
        reportDay:
          (reportType === "daily" || reportType === "weekly") &&
          typeof reportDay === "number" &&
          reportDay >= 1 &&
          reportDay <= 31
            ? reportDay
            : null,
        company: company.trim() || null,
        actor,
        employeeCount: validated.employees.length,
        dailyUpserted: persisted.dailyUpserted,
      });

      const snapshot = await loadMonthSnapshot(
        mergeYear,
        mergeMonth,
        company.trim() ? company.trim() : undefined,
      );

      const payload: Record<string, unknown> = {
        employees: snapshot.employees,
        daily: snapshot.daily,
        weekly: snapshot.weekly,
        downloadUrl,
        reportDay,
        reportDate,
        reportDateIso,
        reportYear: mergeYear,
        reportMonth: mergeMonth,
        parseMeta,
        requestId,
        processedAt,
        uploadName,
        uploadSize,
        persisted: {
          ...persisted,
          skippedMissingCode: validated.skippedMissingCode,
        },
        saved: true,
        sourceOfTruth: "postgresql",
      };
      if (crossCheck !== undefined) payload.crossCheck = crossCheck;
      res.json(payload);
    } catch (e) {
      const status = e instanceof ValidationError ? e.status : 500;
      res.status(status).json({
        message: e instanceof Error ? e.message : "Processing failed",
      });
    } finally {
      safeUnlink(tmpPdf);
      safeUnlink(leavePath);
      safeUnlink(wfhPath);
      safeUnlink(empJsonPath);
    }
  },
);

app.get("/api/attendance/export", (req, res) => {
  const id = typeof req.query.id === "string" ? req.query.id : undefined;
  if (!id || !downloads.has(id)) {
    res.status(404).send("Not found");
    return;
  }
  const p = downloads.get(id)!;
  res.download(p, "attendance.xlsx", (err) => {
    if (err) res.status(500).end();
  });
});

app.get("/api/db/status", async (_req, res) => {
  try {
    await query("SELECT 1 AS ok");
    res.json({ ok: true, engine: "postgresql", database: databaseLabel() });
  } catch (e) {
    res.status(500).json({ ok: false, message: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/api/employees", async (req, res) => {
  const company = typeof req.query.company === "string" ? req.query.company : undefined;
  res.json({ employees: await listEmployees(company) });
});

app.patch("/api/employees/:id", requireEditor, async (req, res) => {
  const id = parseRouteId(req.params.id);
  if (id == null) {
    res.status(400).json({ message: "Invalid employee id" });
    return;
  }
  const updated = await patchEmployee(
    id,
    req.body ?? {},
    actorFromRequest(req as AuthedRequest, req.body?.actor ?? req.headers["x-actor"]),
  );
  if (!updated) {
    res.status(404).json({ message: "Employee not found" });
    return;
  }
  res.json(updated);
});

app.get("/api/attendance/month", async (req, res) => {
  const year = Number.parseInt(String(req.query.year ?? ""), 10);
  const month = Number.parseInt(String(req.query.month ?? ""), 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    res.status(400).json({ message: "year and month (1-12) are required" });
    return;
  }
  const company = typeof req.query.company === "string" ? req.query.company : undefined;
  const authed = req as AuthedRequest;
  if (!authed.authUser) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  const scope = await resolveAttendanceScope(authed.authUser);
  res.json(
    await loadMonthSnapshot(
      year,
      month,
      company,
      scope.restrictToEmployeeIds === null ? undefined : scope.restrictToEmployeeIds,
    ),
  );
});

app.get("/api/attendance/saved-periods", requireEditor, async (req, res) => {
  const limitRaw = typeof req.query.limit === "string" ? req.query.limit : undefined;
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  const rows = await listSavedPeriods(Number.isFinite(limit) ? limit : undefined);
  res.json({
    periods: rows.map((row) => ({
      year: row.year,
      month: row.month,
      company: row.company,
      employeeCount: row.employee_count,
      lastUpdated: row.last_updated,
      approvedWeeks: row.approved_weeks,
    })),
  });
});

function mapGroupedUploadRow(row: {
  id: number;
  file_name: string;
  file_size: number | null;
  report_type: string;
  report_year: number;
  report_month: number;
  company: string | null;
  report_day: number | null;
  last_processed_at: string;
  run_count: number;
  runs: unknown;
}) {
  return {
    id: row.id,
    fileName: row.file_name,
    fileSize: row.file_size,
    reportType: row.report_type,
    reportYear: row.report_year,
    reportMonth: row.report_month,
    company: row.company,
    reportDay: row.report_day,
    lastProcessedAt: row.last_processed_at,
    runCount: row.run_count,
    runs: row.runs,
  };
}

app.get("/api/attendance/browse-registers", async (req, res) => {
  const authed = req as AuthedRequest;
  if (!authed.authUser) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  const rawType = String(req.query.reportType ?? "").trim().toLowerCase();
  if (rawType !== "daily" && rawType !== "weekly" && rawType !== "monthly") {
    res.status(400).json({ message: "reportType must be daily, weekly, or monthly" });
    return;
  }
  const scope = await resolveAttendanceScope(authed.authUser);
  if (scope.restrictToEmployeeIds === null) {
    res.status(403).json({ message: "Use attendance history for full register browse" });
    return;
  }
  const limitRaw = typeof req.query.limit === "string" ? req.query.limit : undefined;
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  const { periods, total } = await listBrowsePeriodsForScope(
    rawType,
    scope.restrictToEmployeeIds,
    Number.isFinite(limit) ? limit : undefined,
  );
  res.json({ total, periods });
});

app.get("/api/attendance/recent-uploads", requireEditor, async (req, res) => {
  const limitRaw = typeof req.query.limit === "string" ? req.query.limit : undefined;
  const offsetRaw = typeof req.query.offset === "string" ? req.query.offset : undefined;
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  const offset = offsetRaw ? Number.parseInt(offsetRaw, 10) : undefined;
  const { rows, total } = await listRecentUploads(
    Number.isFinite(limit) ? limit : undefined,
    Number.isFinite(offset) ? offset : undefined,
  );
  res.json({
    total,
    limit: Number.isFinite(limit) ? limit : 20,
    offset: Number.isFinite(offset) ? offset : 0,
    uploads: rows.map(mapGroupedUploadRow),
  });
});

app.patch("/api/attendance/daily/:id", requireEditor, async (req, res) => {
  const id = parseRouteId(req.params.id);
  if (id == null) {
    res.status(400).json({ message: "Invalid daily attendance id" });
    return;
  }
  try {
    const updated = await patchDailyAttendance(
      id,
      req.body ?? {},
      actorFromRequest(req as AuthedRequest, req.body?.actor ?? req.headers["x-actor"]),
    );
    if (!updated) {
      res.status(404).json({ message: "Daily attendance not found" });
      return;
    }
    res.json(updated);
  } catch (e) {
    if (e instanceof AttendanceLockedError) {
      res.status(409).json({ message: e.message });
      return;
    }
    res.status(500).json({ message: e instanceof Error ? e.message : String(e) });
  }
});

function sendWeeklyLockError(res: express.Response, e: unknown) {
  if (e instanceof AttendanceLockedError) {
    res.status(409).json({ message: e.message });
    return;
  }
  const message = e instanceof Error ? e.message : String(e);
  if (/approved weekly attendance cannot be modified/i.test(message) || message.includes("Locked")) {
    res.status(409).json({ message: "Approved weekly attendance cannot be modified" });
    return;
  }
  res.status(500).json({ message });
}

async function handleWeeklyWrite(req: express.Request, res: express.Response) {
  const id = Number.parseInt(String(req.params.id), 10);
  if (id == null) {
    res.status(400).json({ message: "Invalid weekly attendance id" });
    return;
  }
  try {
    const updated = await saveWeeklyEdit(id, {
      days: Array.isArray(req.body?.days) ? req.body.days : [],
      deduction: req.body?.deduction,
      requiredHours: req.body?.requiredHours ?? req.body?.required_hours,
      actor: actorFromRequest(req as AuthedRequest, req.body?.actor ?? req.headers["x-actor"]),
    });
    if (!updated) {
      res.status(404).json({ message: "Weekly attendance not found" });
      return;
    }
    res.json(updated);
  } catch (e) {
    sendWeeklyLockError(res, e);
  }
}

app.post("/api/attendance/weekly/:id/approve", requireEditor, async (req, res) => {
  const id = parseRouteId(req.params.id);
  if (id == null) {
    res.status(400).json({ message: "Invalid weekly attendance id" });
    return;
  }
  try {
    const updated = await setWeeklyStatus(id, "approved", actorFromRequest(req as AuthedRequest, req.body?.actor ?? req.headers["x-actor"]));
    if (!updated) {
      res.status(404).json({ message: "Weekly attendance not found" });
      return;
    }
    res.json(updated);
  } catch (e) {
    sendWeeklyLockError(res, e);
  }
});

app.put("/weekly/:id", requireEditor, handleWeeklyWrite);
app.patch("/weekly/:id", requireEditor, handleWeeklyWrite);
app.put("/api/weekly/:id", requireEditor, handleWeeklyWrite);
app.patch("/api/weekly/:id", requireEditor, handleWeeklyWrite);
app.put("/api/attendance/weekly/:id", requireEditor, handleWeeklyWrite);
app.patch("/api/attendance/weekly/:id", requireEditor, handleWeeklyWrite);

app.post("/api/attendance/weekly/:id/status", requireEditor, async (req, res) => {
  const id = parseRouteId(req.params.id);
  if (id == null) {
    res.status(400).json({ message: "Invalid weekly attendance id" });
    return;
  }
  const status = String(req.body?.status ?? "").trim().toLowerCase();
  if (!["draft", "pending", "approved", "locked", "rejected"].includes(status)) {
    res.status(400).json({ message: "status must be draft, pending, approved, locked, or rejected" });
    return;
  }
  try {
    const updated = await setWeeklyStatus(
      id,
      status as "draft" | "pending" | "approved" | "locked" | "rejected",
      actorFromRequest(req as AuthedRequest, req.body?.actor ?? req.headers["x-actor"]),
    );
    if (!updated) {
      res.status(404).json({ message: "Weekly attendance not found" });
      return;
    }
    res.json(updated);
  } catch (e) {
    sendWeeklyLockError(res, e);
  }
});

app.post("/api/attendance/weekly/:id/reject", requireEditor, async (req, res) => {
  const id = parseRouteId(req.params.id);
  if (id == null) {
    res.status(400).json({ message: "Invalid weekly attendance id" });
    return;
  }
  try {
    const updated = await setWeeklyStatus(id, "rejected", actorFromRequest(req as AuthedRequest, req.body?.actor ?? req.headers["x-actor"]));
    if (!updated) {
      res.status(404).json({ message: "Weekly attendance not found" });
      return;
    }
    res.json(updated);
  } catch (e) {
    sendWeeklyLockError(res, e);
  }
});

// --- Notifications (requires NOTIFICATIONS_ENABLED for scheduled late/weekly) ---

app.post("/api/notifications/send", async (req, res) => {
  const to = typeof req.body?.to === "string" ? req.body.to.trim() : "";
  const subject = typeof req.body?.subject === "string" ? req.body.subject.trim() : "";
  const body = typeof req.body?.body === "string" ? req.body.body : "";
  if (!to || !subject || !body) {
    res.status(400).json({ message: "to, subject, and body are required" });
    return;
  }
  try {
    await sendSmtpMail({ to, subject, body });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/api/notifications/late", async (req, res) => {
  try {
    const forDate = typeof req.body?.date === "string" ? req.body.date : undefined;
    res.json(await sendLateNotification({ forDate }));
  } catch (e) {
    res.status(500).json({ message: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/api/notifications/weekly", async (_req, res) => {
  try {
    res.json(await sendWeeklyHoursNotification());
  } catch (e) {
    res.status(500).json({ message: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/api/notifications/weekly-review", async (_req, res) => {
  try {
    res.json(await sendWeeklyDataReviewNotification());
  } catch (e) {
    res.status(500).json({ message: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/api/notifications/run", async (_req, res) => {
  try {
    res.json(await runScheduledNotifications());
  } catch (e) {
    res.status(500).json({ message: e instanceof Error ? e.message : String(e) });
  }
});

// --- Dashboard, reports, change history, payroll ---

app.get("/api/dashboard/summary", requireAuth, (req, res) => {
  void handleDashboardSummary(req, res);
});

app.get("/api/dashboard/notifications", requireAuth, (req, res) => {
  void handleDashboardNotifications(req, res);
});

app.get("/api/dashboard/employee-filter-options", requireAuth, (req, res) => {
  void handleDashboardEmployeeFilterOptions(req, res);
});

app.get("/api/reports", requireAuth, (req, res) => {
  void handleReportsList(req, res);
});

app.get("/api/reports/:type", requireAuth, (req, res) => {
  void handleReport(req, res);
});

app.get("/api/history", async (req, res) => {
  const entityType = typeof req.query.entityType === "string" ? req.query.entityType : undefined;
  const entityIdRaw = typeof req.query.entityId === "string" ? req.query.entityId : undefined;
  const limitRaw = typeof req.query.limit === "string" ? req.query.limit : undefined;
  const entityId = entityIdRaw ? Number.parseInt(entityIdRaw, 10) : undefined;
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  res.json({
    history: await listHistory({
      entityType,
      entityId: Number.isFinite(entityId) ? entityId : undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
    }),
  });
});

app.post("/api/salary/validate", requireEditor, upload.single("file"), (req, res) => {
  void handleSalaryValidate(req, res);
});

app.post("/api/salary/calculate", requireEditor, (req, res) => {
  void handleSalaryCalculate(req, res);
});

app.get("/api/salary/results", (req, res) => {
  void handleSalaryResults(req, res);
});

app.get("/api/salary/export", requireAuth, (req, res) => {
  void handleSalaryExport(req, res);
});

app.get("/api/salary/sheet", requireAuth, (req, res) => {
  void handleSalarySheetGet(req, res);
});

app.put("/api/salary/sheet", requireEditor, (req, res) => {
  void handleSalarySheetSave(req, res);
});

app.patch("/api/salary/sheet/row", requireEditor, (req, res) => {
  void handleSalarySheetRowSave(req, res);
});

app.post("/api/salary/sheet/preview", requireAuth, (req, res) => {
  void handleSalarySheetPreview(req, res);
});

app.post("/api/salary/base/import", requireEditor, upload.single("file"), (req, res) => {
  void handleSalaryBaseImport(req, res);
});

app.get("/api/salary/workbook", (req, res) => {
  void handlePublicSalaryWorkbook(req, res);
});

app.get("/api/salary/workbook/history", requireAuth, (req, res) => {
  void handleSalaryWorkbookHistory(req, res);
});

app.get("/api/salary/workbook/history/:id/preview", requireAuth, (req, res) => {
  void handleSalaryWorkbookHistoryPreview(req, res);
});

app.get("/api/admin/salary-workbook/history/:id/file", requireAdmin, (req, res) => {
  void handleSalaryWorkbookHistoryDownload(req, res);
});

// --- Admin: logins, people master, manager assignments, teams ---

app.get("/api/admin/users", requireAdmin, (req, res) => {
  void handleListUsers(req, res);
});

app.post("/api/admin/users", requireAdmin, (req, res) => {
  void handleCreateUser(req, res);
});

app.patch("/api/admin/users/:id", requireAdmin, (req, res) => {
  void handleUpdateUser(req, res);
});

app.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
  void handleDeleteUser(req, res);
});

app.get("/api/admin/salary-workbook", requireAdmin, (req, res) => {
  void handleGetSalaryWorkbook(req, res);
});

app.post("/api/admin/salary-workbook", requireAdmin, upload.single("file"), (req, res) => {
  void handleSaveSalaryWorkbook(req, res);
});

app.delete("/api/admin/salary-workbook", requireAdmin, (req, res) => {
  void handleDeleteSalaryWorkbook(req, res);
});

app.get("/api/admin/managers", requireAdmin, (req, res) => {
  void handleListManagers(req, res);
});

app.get("/api/admin/managers/:id/assignments", requireAdmin, (req, res) => {
  void handleGetManagerAssignments(req, res);
});

app.put("/api/admin/managers/:id/assignments", requireAdmin, (req, res) => {
  void handleSetManagerAssignments(req, res);
});

app.get("/api/admin/employees-for-assignment", requireAdmin, (req, res) => {
  void handleListEmployeesForAssignment(req, res);
});

app.get("/api/admin/employees", requireAdmin, (req, res) => {
  void handleListAdminEmployees(req, res);
});

app.get("/api/admin/employees/check-work-email", requireAdmin, (req, res) => {
  void handleCheckSimilarWorkEmail(req, res);
});

app.get("/api/admin/employees/:id", requireAdmin, (req, res) => {
  void handleGetAdminEmployee(req, res);
});

app.post("/api/admin/employees", requireAdmin, (req, res) => {
  void handleCreateAdminEmployee(req, res);
});

app.patch("/api/admin/employees/:id", requireAdmin, (req, res) => {
  void handleUpdateAdminEmployee(req, res);
});

app.get("/api/teams", requireAuth, (req, res) => {
  void handleListTeams(req, res);
});

app.get("/api/admin/teams/:id/members", requireAdmin, (req, res) => {
  void handleGetTeamMembers(req, res);
});

app.put("/api/admin/teams/:id/members", requireAdmin, (req, res) => {
  void handleSetTeamMembers(req, res);
});

app.put("/api/admin/teams/:id/manager", requireAdmin, (req, res) => {
  void handleSetTeamManager(req, res);
});

app.post("/api/admin/teams/reapply-pins", requireAdmin, (req, res) => {
  void handleReapplyTeamPins(req, res);
});

app.get("/api/holidays", requireAuth, (req, res) => {
  void handleListHolidays(req, res);
});

app.put("/api/admin/holidays", requireAuth, requireHolidayManager, (req, res) => {
  void handleSaveHolidays(req, res);
});

app.post("/api/admin/holidays/copy-from-previous", requireAuth, requireHolidayManager, (req, res) => {
  void handleCopyHolidays(req, res);
});

// --- Holidays, performance appraisal, goal sheet ---

app.get("/api/performance/meta", requireAuth, (req, res) => {
  void handleGetPerformanceMeta(req, res);
});

app.get("/api/performance/me", requireAuth, (req, res) => {
  void handleGetMyPerformance(req, res);
});

app.get("/api/performance/team", requireAuth, (req, res) => {
  void handleListTeamPerformance(req, res);
});

app.get("/api/performance/leadership", requireAuth, (req, res) => {
  void handleListLeadershipPerformance(req, res);
});

app.get("/api/performance/employees/:employeeId", requireAuth, (req, res) => {
  void handleGetPerformanceForEmployee(req, res);
});

app.patch("/api/performance/employees/:employeeId", requireAuth, (req, res) => {
  void handleSavePerformance(req, res);
});

app.get("/api/admin/performance/appraisals", requireAuth, (req, res) => {
  void handleAdminListPerformance(req, res);
});

app.get("/api/goal-sheet/meta", requireAuth, (req, res) => {
  void handleGetGoalSheetMeta(req, res);
});

app.get("/api/goal-sheet/me", requireAuth, (req, res) => {
  void handleGetMyGoalSheet(req, res);
});

app.get("/api/goal-sheet/team", requireAuth, (req, res) => {
  void handleListTeamGoalSheet(req, res);
});

app.get("/api/goal-sheet/leadership", requireAuth, (req, res) => {
  void handleListLeadershipGoalSheet(req, res);
});

app.get("/api/goal-sheet/employees/:employeeId", requireAuth, (req, res) => {
  void handleGetGoalSheetForEmployee(req, res);
});

app.patch("/api/goal-sheet/employees/:employeeId", requireAuth, (req, res) => {
  void handleSaveGoalSheet(req, res);
});

app.get("/api/admin/goal-sheet/submissions", requireAuth, (req, res) => {
  void handleAdminListGoalSheet(req, res);
});

// --- Employee requests (leave, portal in/out, reimbursement) ---

app.get("/api/leave-requests/meta", requireAuth, (req, res) => {
  void handleLeaveRequestMeta(req, res);
});

app.get("/api/leave-requests/balance", requireAuth, (req, res) => {
  void handleLeaveRequestBalance(req, res);
});

app.post("/api/leave-requests/preview", requireAuth, (req, res) => {
  void handlePreviewLeaveApply(req, res);
});

app.post("/api/leave-requests", requireAuth, (req, res) => {
  void handleCreateLeaveRequest(req, res);
});

app.get("/api/leave-requests/mine", requireAuth, (req, res) => {
  void handleListMyLeaveRequests(req, res);
});

app.get("/api/leave-requests/pending", requireAuth, (req, res) => {
  void handleListPendingLeaveRequests(req, res);
});

app.get("/api/leave-requests/scope", requireAuth, (req, res) => {
  void handleListScopedLeaveRequests(req, res);
});

app.get("/api/leave-requests/all", requireAuth, (req, res) => {
  void handleListAllLeaveRequests(req, res);
});

app.get("/api/leave-requests/employees/:employeeId/history", requireAuth, (req, res) => {
  void handleEmployeeLeaveHistory(req, res);
});

app.patch("/api/leave-requests/:id/decision", requireAuth, (req, res) => {
  void handleDecideLeaveRequest(req, res);
});

app.post("/api/leave-requests/:id/cancel", requireAuth, (req, res) => {
  void handleCancelLeaveRequest(req, res);
});

app.get("/api/portal-punch/meta", requireAuth, (req, res) => {
  void handlePortalPunchMeta(req, res);
});

app.post("/api/portal-punch/check-in", requireAuth, (req, res) => {
  void handlePortalCheckIn(req, res);
});

app.post("/api/portal-punch/check-out", requireAuth, (req, res) => {
  void handlePortalCheckOut(req, res);
});

app.get("/api/portal-punch/mine", requireAuth, (req, res) => {
  void handleListMyPortalPunches(req, res);
});

app.get("/api/portal-punch/pending", requireAuth, (req, res) => {
  void handleListPendingPortalPunches(req, res);
});

app.get("/api/portal-punch/all", requireAuth, (req, res) => {
  void handleListAllPortalPunches(req, res);
});

app.get("/api/portal-punch/scope", requireAuth, (req, res) => {
  void handleListScopedPortalPunches(req, res);
});

app.get("/api/portal-punch/employees/:employeeId/history", requireAuth, (req, res) => {
  void handleEmployeePortalPunchHistory(req, res);
});

app.patch("/api/portal-punch/:id/decision", requireAuth, (req, res) => {
  void handleDecidePortalPunch(req, res);
});

app.get("/api/reimbursement-requests/meta", requireAuth, (req, res) => {
  void handleReimbursementMeta(req, res);
});

app.put("/api/reimbursement-requests/policy/special-approval-min-amount", requireAuth, (req, res) => {
  void handleUpdateReimbursementSpecialApprovalMin(req, res);
});

app.post(
  "/api/reimbursement-requests",
  requireAuth,
  uploadReimbursementReceipts.array("receipt", 5),
  (req, res) => {
    void handleCreateReimbursement(req, res);
  },
);

app.get("/api/reimbursement-requests/mine", requireAuth, (req, res) => {
  void handleListMyReimbursements(req, res);
});

app.get("/api/reimbursement-requests/pending", requireAuth, (req, res) => {
  void handleListPendingReimbursements(req, res);
});

app.get("/api/reimbursement-requests/all", requireAuth, (req, res) => {
  void handleListAllReimbursements(req, res);
});

app.patch("/api/reimbursement-requests/:id/decision", requireAuth, (req, res) => {
  void handleDecideReimbursement(req, res);
});

app.post("/api/reimbursement-requests/:id/cancel", requireAuth, (req, res) => {
  void handleCancelReimbursement(req, res);
});

app.post(
  "/api/reimbursement-requests/:id/receipts",
  requireAuth,
  uploadReimbursementReceipts.array("receipt", 5),
  (req, res) => {
    void handleUploadReimbursementReceipts(req, res);
  },
);

app.get("/api/reimbursement-requests/receipts/:receiptId/file", requireAuth, (req, res) => {
  void handleDownloadReimbursementReceipt(req, res);
});

// --- Offer & relieving letters, employee documents ---

app.get("/api/offer-letters/meta", requireAuth, requireOfferLetterAccess, (req, res) => {
  void handleOfferLetterMeta(req, res);
});

app.post(
  "/api/offer-letters/parse-excel",
  requireAuth,
  requireOfferLetterAccess,
  uploadMemory.single("file"),
  (req, res) => {
    void handleParseOfferExcel(req, res);
  },
);

app.post("/api/offer-letters/preview-email", requireAuth, requireOfferLetterAccess, (req, res) => {
  void handlePreviewOfferEmail(req, res);
});

app.post("/api/offer-letters/preview-pdf", requireAuth, requireOfferLetterAccess, (req, res) => {
  void handlePreviewOfferPdf(req, res);
});

app.post("/api/offer-letters/send", requireAuth, requireOfferLetterAccess, (req, res) => {
  void handleSendOfferLetters(req, res);
});

app.get("/api/relieving-letters/meta", requireAuth, requireRelievingLetterAccessMiddleware, (req, res) => {
  void handleRelievingLetterMeta(req, res);
});

app.post(
  "/api/relieving-letters/generate",
  requireAuth,
  requireRelievingLetterAccessMiddleware,
  (req, res) => {
    void handleGenerateRelievingLetter(req, res);
  },
);

app.post(
  "/api/relieving-letters/generate-pdf",
  requireAuth,
  requireRelievingLetterAccessMiddleware,
  uploadRelievingSignature.single("signature"),
  (req, res) => {
    void handleGenerateRelievingLetterPdf(req, res);
  },
);

app.post(
  "/api/relieving-letters/signature",
  requireAuth,
  requireRelievingLetterAccessMiddleware,
  uploadRelievingSignature.single("signature"),
  (req, res) => {
    void handleSaveRelievingSignature(req, res);
  },
);

app.get("/api/employee-documents/meta", requireAuth, (req, res) => {
  void handleDocumentsMeta(req, res);
});

app.get("/api/employee-documents/mine", requireAuth, (req, res) => {
  void handleGetMyDocuments(req, res);
});

app.get("/api/employee-documents/admin/employees", requireAuth, (req, res) => {
  void handleListEmployeesDocuments(req, res);
});

app.get("/api/employee-documents/admin/employees/:employeeId", requireAuth, (req, res) => {
  void handleGetEmployeeDocuments(req, res);
});

app.post(
  "/api/employee-documents/upload",
  requireAuth,
  uploadEmployeeDoc.single("file"),
  (req, res) => {
    void handleUploadDocument(req, res);
  },
);

app.put("/api/employee-documents/previous-employers", requireAuth, (req, res) => {
  void handleSavePreviousEmployers(req, res);
});

app.delete("/api/employee-documents/:id", requireAuth, (req, res) => {
  void handleDeleteDocument(req, res);
});

app.get("/api/employee-documents/file/:id", requireAuth, (req, res) => {
  void handleDownloadDocument(req, res);
});

initDb()
  .then(async () => {
    if (NODE_ENV === "production" && !process.env.AUTH_SECRET?.trim()) {
      console.error("AUTH_SECRET is required when NODE_ENV=production. Set it in backend/.env");
      process.exit(1);
    }
    if (!process.env.AUTH_SECRET?.trim()) {
      console.warn("AUTH_SECRET is not set; using a development default. Set AUTH_SECRET in .env for real use.");
    }
    await bootstrapFirstUser();
    await seedTeams();
    await seedPinnedEmployeeTeams();
    await seedDefaultHolidaysIfEmpty();
    startNotificationScheduler();
    startOffboardingScheduler();
    app.listen(PORT, HOST, () => {
      const hostLabel = HOST === "0.0.0.0" ? "localhost" : HOST;
      console.log(`Attendance API http://${hostLabel}:${PORT} (listen ${HOST}:${PORT}, NODE_ENV=${NODE_ENV})`);
      console.log(`PostgreSQL ${databaseLabel()}`);
    });
  })
  .catch((err) => {
    console.error("PostgreSQL startup failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
