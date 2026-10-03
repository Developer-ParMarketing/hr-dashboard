import { cellStr, employeeCodeOf, parseHoursValue, type RawIngestEmployee } from "./helpers.js";

const MAX_DAY_HOURS = 18;
const TOKEN_HOURS_TOLERANCE = 2.5;
const MAX_ANOMALY_LINES = 8;

function hoursFromPresentToken(token: string): number | null {
  const m = token.trim().match(/^P\((\d{1,2}):(\d{2})\)$/i);
  if (!m) return null;
  const h = Number.parseInt(m[1]!, 10);
  const min = Number.parseInt(m[2]!, 10);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h + min / 60;
}

function employeeDisplayName(raw: RawIngestEmployee, code: string): string {
  const name = cellStr(raw.employeeName ?? raw.empName ?? raw.name);
  return name ? `${code} (${name})` : code;
}

/**
 * Rule + statistical checks on parsed attendance before save. Throws with a single message when blocked.
 */
export function assertIngestAnomaliesOk(
  employees: RawIngestEmployee[],
  year: number,
  month: number,
  dim: number,
): void {
  const issues: string[] = [];

  const codeCounts = new Map<string, number>();
  for (const raw of employees) {
    const code = employeeCodeOf(raw);
    if (!code) continue;
    codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
  }
  for (const [code, n] of codeCounts) {
    if (n > 1) {
      issues.push(`Duplicate employee code in upload: ${code} (${n} rows).`);
    }
  }

  for (const raw of employees) {
    const code = employeeCodeOf(raw);
    if (!code) continue;
    const label = employeeDisplayName(raw, code);

    for (let d = 1; d <= dim; d++) {
      const token = cellStr(raw[`day${d}`]).toUpperCase();
      const inTime = cellStr(raw[`day${d}InTime`]);
      const hours = parseHoursValue(raw[`day${d}Hours`]);

      if (hours != null && (hours < 0 || hours > MAX_DAY_HOURS)) {
        issues.push(`${label} day ${d}: worked hours ${hours.toFixed(2)} look invalid (expected 0-${MAX_DAY_HOURS}).`);
      }

      if (inTime && token === "AB") {
        issues.push(`${label} day ${d}: check-in time is set but the day is marked AB.`);
      }

      const fromToken = token ? hoursFromPresentToken(token) : null;
      if (fromToken != null && hours != null && Math.abs(fromToken - hours) > TOKEN_HOURS_TOLERANCE) {
        issues.push(
          `${label} day ${d}: ${token} implies ~${fromToken.toFixed(1)}h but day hours are ${hours.toFixed(1)}.`,
        );
      }
    }
  }

  if (issues.length === 0) return;

  const head = issues.slice(0, MAX_ANOMALY_LINES);
  const tail = issues.length > MAX_ANOMALY_LINES ? ` …and ${issues.length - MAX_ANOMALY_LINES} more.` : "";
  throw new Error(
    `Attendance upload failed validation:\n${head.map((l) => `• ${l}`).join("\n")}${tail}`,
  );
}
