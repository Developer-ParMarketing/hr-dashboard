import { parseFlexibleDoj } from "./dojParse.js";

const TZ = () => process.env.NOTIFICATIONS_TZ?.trim() || "Asia/Kolkata";

/** Calendar YYYY-MM-DD in company notification timezone. */
export function calendarTodayIso(at = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

export function parseDateOfLeavingInput(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") return undefined;
  const parsed = parseFlexibleDoj(raw);
  if (parsed) return parsed;
  if (!raw.trim()) return null;
  throw Object.assign(new Error("dateOfLeaving must be DD-MM-YYYY"), { status: 400 });
}

/** Inactive from the calendar day after date of leaving. */
export function shouldBeInactiveAfterLeaving(dateOfLeavingIso: string, todayIso: string): boolean {
  return todayIso > dateOfLeavingIso.slice(0, 10);
}

export function effectiveEmploymentStatus(
  storedStatus: string | null | undefined,
  dateOfLeavingIso: string | null | undefined,
  todayIso = calendarTodayIso(),
): "active" | "inactive" {
  if ((storedStatus ?? "active").trim().toLowerCase() === "inactive") return "inactive";
  if (dateOfLeavingIso && shouldBeInactiveAfterLeaving(dateOfLeavingIso, todayIso)) return "inactive";
  return "active";
}

/** SQL fragment: employee row `e` is operational on calendar date $n (YYYY-MM-DD). */
export function sqlEmployeeOperationalOnDate(alias = "e", dateParamIndex = 1): string {
  return `(lower(trim(coalesce(${alias}.status, 'active'))) = 'active'
    AND (${alias}.date_of_leaving IS NULL OR ${alias}.date_of_leaving >= $${dateParamIndex}::date))`;
}
