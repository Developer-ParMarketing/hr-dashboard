import { query } from "../db/index.js";

export type LeaveApplyWarning = string;

function eachIsoDateInclusive(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const cur = new Date(Date.UTC(sy!, sm! - 1, sd!));
  const end = new Date(Date.UTC(ey!, em! - 1, ed!));
  while (cur.getTime() <= end.getTime()) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function isFridayIso(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() === 5;
}

export async function buildLeaveApplyWarnings(input: {
  employeeId: number;
  startDate: string;
  endDate: string;
}): Promise<LeaveApplyWarning[]> {
  const warnings: LeaveApplyWarning[] = [];
  const days = eachIsoDateInclusive(input.startDate, input.endDate);

  const holidays = await query<{ holiday_date: string; name: string }>(
    `SELECT holiday_date::text AS holiday_date, name
     FROM company_holidays
     WHERE holiday_date >= $1::date AND holiday_date <= $2::date
     ORDER BY holiday_date ASC`,
    [input.startDate, input.endDate],
  );
  for (const h of holidays) {
    const iso = String(h.holiday_date).slice(0, 10);
    warnings.push(`Your leave includes company holiday ${iso} (${h.name}).`);
  }

  const overlaps = await query<{
    id: number;
    start_date: string;
    end_date: string;
    leave_type: string;
  }>(
    `SELECT id, start_date::text AS start_date, end_date::text AS end_date, leave_type
     FROM leave_requests
     WHERE employee_id = $1
       AND status = 'approved'
       AND start_date <= $3::date
       AND end_date >= $2::date
     ORDER BY start_date ASC`,
    [input.employeeId, input.startDate, input.endDate],
  );
  for (const row of overlaps) {
    warnings.push(
      `Overlaps approved ${String(row.leave_type).toUpperCase()} leave ${row.start_date} to ${row.end_date} (request #${row.id}).`,
    );
  }

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 365);
  const sinceIso = since.toISOString().slice(0, 10);

  const fridayRow = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n
     FROM leave_requests
     WHERE employee_id = $1
       AND status IN ('approved', 'pending')
       AND start_date = end_date
       AND EXTRACT(DOW FROM start_date) = 5
       AND start_date >= $2::date`,
    [input.employeeId, sinceIso],
  );
  const fridayCount = fridayRow[0]?.n ?? 0;
  const requestIsSingleFriday =
    input.startDate === input.endDate && isFridayIso(input.startDate);

  if (fridayCount >= 4 && requestIsSingleFriday) {
    warnings.push(
      `You already have ${fridayCount} single-day Friday leave request(s) in the last 12 months - managers may review this pattern.`,
    );
  } else if (fridayCount >= 4 && !requestIsSingleFriday) {
    warnings.push(
      `Note: ${fridayCount} single-day Friday leave requests in the last 12 months on your record.`,
    );
  }

  return warnings;
}
