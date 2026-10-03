import { cellStr } from "../persist/helpers.js";
import { formatDisplayDate } from "../displayDate.js";

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toIso(y: number, m: number, d: number): string | null {
  if (m < 0 || m > 11 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m || dt.getUTCDate() !== d) return null;
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

/** Parse DOJ from ISO, Excel serial, or sheet text like `20-May-26` / `1-Oct-19`. */
export function parseFlexibleDoj(v: unknown): string | null {
  if (v == null || v === "" || v === "-") return null;
  if (typeof v === "number" && Number.isFinite(v) && v > 1000) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(excelEpoch.getTime() + v * 86400000);
    return toIso(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  const s = cellStr(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const slash = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slash) {
    const day = Number.parseInt(slash[1]!, 10);
    const month = Number.parseInt(slash[2]!, 10) - 1;
    const year = Number.parseInt(slash[3]!, 10);
    return toIso(year, month, day);
  }

  const dash = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (dash) {
    const day = Number.parseInt(dash[1]!, 10);
    const monKey = dash[2]!.toLowerCase().slice(0, 3);
    const month = MONTHS[monKey];
    if (month == null) return null;
    let year = Number.parseInt(dash[3]!, 10);
    if (dash[3]!.length === 2) {
      year = year >= 50 ? 1900 + year : 2000 + year;
    }
    return toIso(year, month, day);
  }

  const parsed = Date.parse(s.replace(/-/g, " "));
  if (Number.isFinite(parsed)) {
    const d = new Date(parsed);
    return toIso(d.getFullYear(), d.getMonth(), d.getDate());
  }

  return null;
}

/** Format ISO date as DD-MM-YYYY for exports and messages. */
export function formatDojDdMmYyyy(iso: string | null | undefined): string {
  return formatDisplayDate(iso);
}

export { formatDisplayDate, formatDisplayDateRange, formatDisplayDateTime } from "../displayDate.js";
