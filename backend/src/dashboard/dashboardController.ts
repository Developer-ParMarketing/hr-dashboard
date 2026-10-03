import type { Request, Response } from "express";
import type { AuthedRequest } from "../auth/middleware.js";
import type { AuthUser } from "../auth/users.js";
import {
  canUseDashboardDateFilters,
  getDashboardNotifications,
  getDashboardSummary,
  listDashboardEmployeeFilterOptions,
} from "./dashboardService.js";
import {
  parseDashboardRangePreset,
  parseEmployeeIdFilter,
} from "./dateRange.js";

type ParsedDashboardQuery =
  | { error: string; status?: number }
  | {
      input: {
        year: number;
        month: number;
        company: string;
        user: AuthUser;
        preset: ReturnType<typeof parseDashboardRangePreset>;
        quarter: number | undefined;
        dateFrom: string | undefined;
        dateTo: string | undefined;
        employeeIds: number[] | null;
      };
    };

function parseDashboardSummaryQuery(req: Request, user: AuthUser): ParsedDashboardQuery {
  const q = req.query ?? {};
  const year = Number.parseInt(String(q.year ?? ""), 10);
  const month = Number.parseInt(String(q.month ?? ""), 10);
  const company =
    (typeof q.company === "string" ? q.company : typeof q.companyName === "string" ? q.companyName : "")
      .trim() || "PM";

  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return { error: "year and month (1-12) query params are required" };
  }

  const preset = parseDashboardRangePreset(typeof q.preset === "string" ? q.preset : undefined);
  const quarterRaw = typeof q.quarter === "string" ? Number.parseInt(q.quarter, 10) : undefined;
  const quarter = Number.isFinite(quarterRaw) ? quarterRaw : undefined;
  const dateFrom = typeof q.dateFrom === "string" ? q.dateFrom : undefined;
  const dateTo = typeof q.dateTo === "string" ? q.dateTo : undefined;
  const employeeIds = parseEmployeeIdFilter(
    typeof q.employeeIds === "string" ? q.employeeIds : undefined,
  );

  if (employeeIds != null && !canUseDashboardDateFilters(user)) {
    return { error: "Employee filter is not allowed for your role", status: 403 };
  }

  if (preset !== "monthly" && !canUseDashboardDateFilters(user)) {
    return { error: "Date range filters are not allowed for your role", status: 403 };
  }

  return {
    input: {
      year,
      month,
      company,
      user,
      preset,
      quarter,
      dateFrom,
      dateTo,
      employeeIds,
    },
  };
}

export async function handleDashboardSummary(req: Request, res: Response): Promise<void> {
  const authed = req as AuthedRequest;
  if (!authed.authUser) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  const parsed = parseDashboardSummaryQuery(req, authed.authUser);
  if ("error" in parsed) {
    res.status(parsed.status ?? 400).json({ message: parsed.error });
    return;
  }

  try {
    res.json({
      summary: await getDashboardSummary(parsed.input),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load dashboard";
    const isRange =
      msg.includes("dateFrom") || msg.includes("Custom range") || msg.includes("366 days");
    res.status(isRange ? 400 : 500).json({ message: msg });
  }
}

export async function handleDashboardNotifications(req: Request, res: Response): Promise<void> {
  const authed = req as AuthedRequest;
  if (!authed.authUser) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  const parsed = parseDashboardSummaryQuery(req, authed.authUser);
  if ("error" in parsed) {
    res.status(parsed.status ?? 400).json({ message: parsed.error });
    return;
  }

  try {
    res.json(await getDashboardNotifications(parsed.input));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load notifications";
    const isRange =
      msg.includes("dateFrom") || msg.includes("Custom range") || msg.includes("366 days");
    res.status(isRange ? 400 : 500).json({ message: msg });
  }
}

export async function handleDashboardEmployeeFilterOptions(req: Request, res: Response): Promise<void> {
  const authed = req as AuthedRequest;
  if (!authed.authUser) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  const company =
    (typeof req.query.company === "string" ? req.query.company : "").trim() || "PM";

  try {
    const employees = await listDashboardEmployeeFilterOptions(authed.authUser, company);
    res.json({ employees });
  } catch (e) {
    const status = e && typeof e === "object" && "status" in e ? Number((e as { status: number }).status) : 500;
    res.status(status).json({
      message: e instanceof Error ? e.message : "Failed to load employees",
    });
  }
}
