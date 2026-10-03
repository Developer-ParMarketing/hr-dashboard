import { query } from "../db/index.js";
import { daysInMonth, isoDate } from "../persist/helpers.js";
import type { HolidayDayType } from "./types.js";

export function parseHolidayDayType(raw: unknown): HolidayDayType {
  const t = String(raw ?? "full").trim().toLowerCase();
  return t === "half" ? "half" : "full";
}

export async function loadHolidayTypeMapForDates(
  dates: string[],
): Promise<Map<string, HolidayDayType>> {
  const map = new Map<string, HolidayDayType>();
  if (dates.length === 0) return map;
  const unique = [...new Set(dates.map((d) => d.slice(0, 10)).filter(Boolean))];
  const rows = await query<{ holiday_date: string; day_type: string }>(
    `SELECT holiday_date::text AS holiday_date, day_type
     FROM company_holidays
     WHERE holiday_date = ANY($1::date[])`,
    [unique],
  );
  for (const row of rows) {
    map.set(String(row.holiday_date).slice(0, 10), parseHolidayDayType(row.day_type));
  }
  return map;
}

export async function loadHolidayTypeMapForMonth(
  year: number,
  month: number,
): Promise<Map<string, HolidayDayType>> {
  const from = isoDate(year, month, 1);
  const to = isoDate(year, month, daysInMonth(year, month));
  const rows = await query<{ holiday_date: string; day_type: string }>(
    `SELECT holiday_date::text AS holiday_date, day_type
     FROM company_holidays
     WHERE holiday_date BETWEEN $1::date AND $2::date`,
    [from, to],
  );
  const map = new Map<string, HolidayDayType>();
  for (const row of rows) {
    map.set(String(row.holiday_date).slice(0, 10), parseHolidayDayType(row.day_type));
  }
  return map;
}

export async function listHolidaysForMonth(year: number, month: number) {
  const from = isoDate(year, month, 1);
  const to = isoDate(year, month, daysInMonth(year, month));
  const rows = await query<{ holiday_date: string; day_type: string; name: string }>(
    `SELECT holiday_date::text AS holiday_date, day_type, name
     FROM company_holidays
     WHERE holiday_date BETWEEN $1::date AND $2::date
     ORDER BY holiday_date`,
    [from, to],
  );
  return rows.map((row) => ({
    holidayDate: String(row.holiday_date).slice(0, 10),
    dayType: parseHolidayDayType(row.day_type),
    name: row.name,
  }));
}
