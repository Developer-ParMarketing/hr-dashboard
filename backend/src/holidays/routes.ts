import type { Request, Response } from "express";
import type { AuthedRequest } from "../auth/middleware.js";
import { actorFromRequest } from "../auth/middleware.js";
import {
  assertCanManageCompanyHolidays,
  assertCanViewHolidayYear,
  canManageCompanyHolidays,
  currentHolidayCalendarYear,
  holidayYearOptionsForEditors,
} from "./access.js";
import {
  copyHolidaysFromPreviousYear,
  dayLabelForDate,
  listHolidays,
  previewCopyHolidaysToYear,
  replaceYearHolidays,
  shortDisplayDate,
  suggestedHolidayCopySourceYear,
} from "./holidays.js";

function parseYear(raw: unknown): number | null {
  const year = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(year) || year < 2000 || year > 2100) return null;
  return year;
}

function statusFromError(e: unknown): number {
  if (e && typeof e === "object" && "status" in e && typeof (e as { status: unknown }).status === "number") {
    return (e as { status: number }).status;
  }
  return 500;
}

export async function handleListHolidays(req: Request, res: Response): Promise<void> {
  const user = (req as AuthedRequest).authUser;
  const year = parseYear(req.query.year) ?? currentHolidayCalendarYear();
  try {
    assertCanViewHolidayYear(user, year);
    const canManage = canManageCompanyHolidays(user);
    const holidays = await listHolidays(year);
    const copySourceYear = canManage ? await suggestedHolidayCopySourceYear(year) : null;
    res.json({
      year,
      holidays: holidays.map((row) => ({
        ...row,
        dayLabel: dayLabelForDate(row.holidayDate),
        shortDateLabel: shortDisplayDate(row.holidayDate),
      })),
      meta: {
        canManage,
        yearOptions: canManage ? holidayYearOptionsForEditors() : [currentHolidayCalendarYear()],
        copySourceYear,
      },
    });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to load holidays" });
  }
}

export async function handleSaveHolidays(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const year = parseYear(body.year ?? req.query.year);
  if (year == null) {
    res.status(400).json({ message: "year (2000-2100) is required" });
    return;
  }

  const items = Array.isArray(body.holidays)
    ? body.holidays.map((row) => {
        const item = row as Record<string, unknown>;
        return {
          holidayDate: String(item.holidayDate ?? item.date ?? ""),
          name: String(item.name ?? item.holiday ?? ""),
          dayType: String(item.dayType ?? item.day_type ?? "full"),
        };
      })
    : [];

  try {
    assertCanManageCompanyHolidays((req as AuthedRequest).authUser);
    const holidays = await replaceYearHolidays(
      year,
      items,
      actorFromRequest(req as AuthedRequest, body.actor),
    );
    res.json({
      year,
      holidays: holidays.map((row) => ({
        ...row,
        dayLabel: dayLabelForDate(row.holidayDate),
        shortDateLabel: shortDisplayDate(row.holidayDate),
      })),
    });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to save holidays" });
  }
}

export async function handleCopyHolidays(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const year = parseYear(body.year ?? req.query.year);
  if (year == null) {
    res.status(400).json({ message: "year (2000-2100) is required" });
    return;
  }

  const preview = body.preview === true || body.preview === "true";

  try {
    assertCanManageCompanyHolidays((req as AuthedRequest).authUser);
    if (preview) {
      const { sourceYear, items } = await previewCopyHolidaysToYear(year);
      res.json({
        year,
        sourceYear,
        holidays: items.map((row) => ({
          holidayDate: row.holidayDate,
          name: row.name,
          dayType: row.dayType,
          dayLabel: dayLabelForDate(row.holidayDate),
          shortDateLabel: shortDisplayDate(row.holidayDate),
        })),
      });
      return;
    }
    const holidays = await copyHolidaysFromPreviousYear(
      year,
      actorFromRequest(req as AuthedRequest, body.actor),
    );
    res.json({
      year,
      holidays: holidays.map((row) => ({
        ...row,
        dayLabel: dayLabelForDate(row.holidayDate),
        shortDateLabel: shortDisplayDate(row.holidayDate),
      })),
    });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to copy holidays" });
  }
}
