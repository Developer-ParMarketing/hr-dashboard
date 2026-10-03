import { query, withTransaction } from "../db/index.js";
import { parseHolidayDayType } from "./holidayAttendance.js";
import { resyncOpenWeeksForYear } from "./resync.js";
import type { HolidayDayType } from "./types.js";

export type HolidayRow = {
  id: number;
  year: number;
  holidayDate: string;
  name: string;
  dayType: HolidayDayType;
  sortOrder: number;
  updatedBy: string | null;
  updatedAt: string;
};

type DbHolidayRow = {
  id: number;
  year: number;
  holiday_date: string;
  name: string;
  day_type: string;
  sort_order: number;
  updated_by: string | null;
  updated_at: Date;
};

const DEFAULT_2026: Array<{ month: number; day: number; name: string }> = [
  { month: 1, day: 1, name: "New Year's Day" },
  { month: 1, day: 26, name: "Republic Day" },
  { month: 2, day: 19, name: "Ramadan" },
  { month: 3, day: 4, name: "Holi" },
  { month: 5, day: 1, name: "Maharashtra Day" },
  { month: 5, day: 27, name: "Bakrid" },
  { month: 8, day: 15, name: "Independence Day" },
  { month: 8, day: 28, name: "Raksha Bandhan" },
  { month: 9, day: 14, name: "Ganesh Chaturthi" },
  { month: 10, day: 2, name: "Mahatma Gandhi Jayanti" },
  { month: 11, day: 11, name: "Bhai Duj" },
  { month: 12, day: 25, name: "Christmas" },
];

function mapRow(row: DbHolidayRow): HolidayRow {
  return {
    id: row.id,
    year: row.year,
    holidayDate: String(row.holiday_date).slice(0, 10),
    name: row.name,
    dayType: parseHolidayDayType(row.day_type),
    sortOrder: row.sort_order,
    updatedBy: row.updated_by,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function dayLabelForDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-IN", { weekday: "long" });
}

import { formatDisplayDate } from "../displayDate.js";

export function shortDisplayDate(iso: string): string {
  return formatDisplayDate(iso);
}

export async function listHolidays(year: number): Promise<HolidayRow[]> {
  const rows = await query<DbHolidayRow>(
    `SELECT id, year, holiday_date, name, day_type, sort_order, updated_by, updated_at
     FROM company_holidays
     WHERE year = $1
     ORDER BY holiday_date, sort_order, id`,
    [year],
  );
  return rows.map(mapRow);
}

export async function countHolidaysForYear(year: number): Promise<number> {
  const row = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM company_holidays WHERE year = $1`,
    [year],
  );
  return Number(row[0]?.count ?? 0);
}

export async function replaceYearHolidays(
  year: number,
  items: Array<{ holidayDate: string; name: string; dayType?: HolidayDayType | string }>,
  actor: string,
): Promise<HolidayRow[]> {
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    throw Object.assign(new Error("Invalid year"), { status: 400 });
  }

  const normalized = items
    .map((item, index) => {
      const holidayDate = String(item.holidayDate ?? "").slice(0, 10);
      const name = String(item.name ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(holidayDate)) {
        throw Object.assign(new Error(`Invalid date: ${holidayDate || "(empty)"}`), { status: 400 });
      }
      const itemYear = Number.parseInt(holidayDate.slice(0, 4), 10);
      if (itemYear !== year) {
        throw Object.assign(new Error(`Date ${holidayDate} must fall in ${year}`), { status: 400 });
      }
      if (!name) {
        throw Object.assign(new Error("Holiday name is required"), { status: 400 });
      }
      return { holidayDate, name, dayType: parseHolidayDayType(item.dayType), sortOrder: index + 1 };
    })
    .sort((a, b) => a.holidayDate.localeCompare(b.holidayDate));

  const seenDates = new Set<string>();
  for (const item of normalized) {
    if (seenDates.has(item.holidayDate)) {
      throw Object.assign(new Error(`Duplicate date: ${item.holidayDate}`), { status: 400 });
    }
    seenDates.add(item.holidayDate);
  }

  await withTransaction(async (client) => {
    await client.query(`DELETE FROM company_holidays WHERE year = $1`, [year]);
    for (const item of normalized) {
      await client.query(
        `INSERT INTO company_holidays (year, holiday_date, name, day_type, sort_order, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [year, item.holidayDate, item.name, item.dayType, item.sortOrder, actor],
      );
    }
  });

  await resyncOpenWeeksForYear(year);

  return listHolidays(year);
}

export async function seedDefaultHolidaysIfEmpty(): Promise<void> {
  const year = 2026;
  const count = await countHolidaysForYear(year);
  if (count > 0) return;

  await replaceYearHolidays(
    year,
    DEFAULT_2026.map((item) => ({
      holidayDate: isoDate(year, item.month, item.day),
      name: item.name,
    })),
    "system",
  );
}

export async function suggestedHolidayCopySourceYear(targetYear: number): Promise<number | null> {
  if (!Number.isFinite(targetYear)) return null;
  for (let y = targetYear - 1; y >= 2000; y -= 1) {
    if ((await countHolidaysForYear(y)) > 0) return y;
  }
  return null;
}

export function mapHolidayRowsToTargetYear(
  source: HolidayRow[],
  targetYear: number,
): Array<{ holidayDate: string; name: string; dayType: HolidayDayType }> {
  return source.map((row) => {
    const [, month, day] = row.holidayDate.split("-");
    return {
      holidayDate: isoDate(targetYear, Number.parseInt(month, 10), Number.parseInt(day, 10)),
      name: row.name,
      dayType: row.dayType,
    };
  });
}

export async function previewCopyHolidaysToYear(targetYear: number): Promise<{
  sourceYear: number;
  items: Array<{ holidayDate: string; name: string; dayType: HolidayDayType }>;
}> {
  const sourceYear = await suggestedHolidayCopySourceYear(targetYear);
  if (sourceYear == null) {
    throw Object.assign(new Error("No earlier holiday list found to copy"), { status: 400 });
  }
  const source = await listHolidays(sourceYear);
  return { sourceYear, items: mapHolidayRowsToTargetYear(source, targetYear) };
}

export async function copyHolidaysFromPreviousYear(
  targetYear: number,
  actor: string,
): Promise<HolidayRow[]> {
  const { items } = await previewCopyHolidaysToYear(targetYear);
  return replaceYearHolidays(targetYear, items, actor);
}
