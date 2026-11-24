/**
 * Read-only data tools the HR chatbot can call.
 *
 * Security: every tool is limited to the employees the logged-in user may see
 * (HR/admin = everyone, manager = their team + self, employee = only self).
 * The AI never writes SQL - it can only call these fixed functions.
 */
import { query } from "../db/index.js";
import { findEmployeeIdByUserEmail, resolveAttendanceScope } from "../auth/attendanceScope.js";
import { calendarTodayIso, effectiveEmploymentStatus } from "../employees/employmentStatus.js";
import type { AuthUser } from "../auth/users.js";
import type { OllamaToolSpec } from "./ollama.js";
import { policyText } from "./policies.js";

export type ChatContext = {
    user: AuthUser;
    mode: "full" | "team" | "self";
    /** null = all employees */
    allowedIds: number[] | null;
    selfEmployeeId: number | null;
    today: string;
};

const HALF_DAY_MAX_HOURS = 5;
const MAX_RANGE_DAYS = 62;
const MAX_ROWS = 120;

export async function buildChatContext(user: AuthUser): Promise<ChatContext> {
    const scope = await resolveAttendanceScope(user);
    const selfEmployeeId = await findEmployeeIdByUserEmail(user.email);
    let allowedIds = scope.restrictToEmployeeIds;
    if (allowedIds && selfEmployeeId != null && !allowedIds.includes(selfEmployeeId)) {
        allowedIds = [...allowedIds, selfEmployeeId];
    }
    return { user, mode: scope.mode, allowedIds, selfEmployeeId, today: calendarTodayIso() };
}

/* ----------------------------- helpers ----------------------------- */

type EmpRow = {
    id: number;
    employee_code: string;
    name: string;
    email: string | null;
    department: string | null;
    status: string | null;
    date_of_joining: string | null;
    date_of_leaving: string | null;
    shift_start: string | null;
    team_name: string | null;
    manager_name: string | null;
};

const EMP_SELECT = `
  SELECT e.id, e.employee_code, e.name, e.email, e.department, e.status,
         e.date_of_joining::text AS date_of_joining, e.date_of_leaving::text AS date_of_leaving,
         e.shift_start, t.name AS team_name, mu.name AS manager_name
  FROM employees e
  LEFT JOIN teams t ON t.id = e.team_id
  LEFT JOIN users mu ON mu.id = t.manager_user_id`;

/** SQL condition limiting employee alias `e` to the user's scope. Adds a param when needed. */
function scopeCond(ctx: ChatContext, params: unknown[], alias = "e"): string {
    if (ctx.allowedIds === null) return "TRUE";
    params.push(ctx.allowedIds);
    return `${alias}.id = ANY($${params.length}::int[])`;
}

function isIsoDate(s: unknown): s is string {
    return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

function addDays(iso: string, days: number): string {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
    return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function hm(hours: number | string | null | undefined): string | null {
    const n = Number(hours);
    if (!Number.isFinite(n) || n <= 0) return null;
    const totalMin = Math.round(n * 60);
    return `${Math.floor(totalMin / 60)}:${String(totalMin % 60).padStart(2, "0")}`;
}

function weekday(iso: string): string {
    return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
}

function str(v: unknown): string {
    return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

function scopeLabel(ctx: ChatContext): string {
    if (ctx.mode === "full") return "all employees";
    if (ctx.mode === "team") return "your team";
    return "your own records";
}

/** Find one employee (code, name, or "me") inside the user's scope. */
async function resolveEmployee(
    ctx: ChatContext,
    ref: unknown,
): Promise<{ emp: EmpRow } | { error: string; candidates?: Array<{ code: string; name: string }> }> {
    const raw = str(ref);
    if (!raw || /^(me|my|myself|self|i)$/i.test(raw)) {
        if (ctx.selfEmployeeId == null) {
            return { error: "Your login is not linked to an employee record (work email must match)." };
        }
        const rows = await query<EmpRow>(`${EMP_SELECT} WHERE e.id = $1`, [ctx.selfEmployeeId]);
        return rows[0] ? { emp: rows[0] } : { error: "Employee record not found." };
    }
    const params: unknown[] = [raw];
    const cond = scopeCond(ctx, params);
    const rows = await query<EmpRow>(
        `${EMP_SELECT}
     WHERE ${cond}
       AND (upper(e.employee_code) = upper($1) OR e.name ILIKE '%' || $1 || '%')
     ORDER BY (upper(e.employee_code) = upper($1)) DESC, e.employee_code
     LIMIT 10`,
        params,
    );
    if (rows.length === 0) {
        if (ctx.mode !== "full") {
            const anywhere = await query<{ n: number }>(
                `SELECT COUNT(*)::int AS n FROM employees e
                 WHERE upper(e.employee_code) = upper($1) OR e.name ILIKE '%' || $1 || '%'`,
                [raw],
            );
            if ((anywhere[0]?.n ?? 0) > 0) {
                return {
                    error:
                        ctx.mode === "self"
                            ? `Access denied: employees can only see their own data, not "${raw}". Tell the user politely.`
                            : `Access denied: "${raw}" is not in your team. Managers can only see their own team.`,
                };
            }
        }
        return { error: `No employee named or coded "${raw}" exists. Do not guess a name.` };
    }
    const exact = rows.find((r) => r.employee_code.toUpperCase() === raw.toUpperCase());
    if (exact) return { emp: exact };
    if (rows.length === 1) return { emp: rows[0]! };
    const full = rows.filter((r) => r.name.toLowerCase() === raw.toLowerCase());
    if (full.length === 1) return { emp: full[0]! };
    // "santosh" -> Santosh Choudhary, not Sneha Santosh Mohite (first name wins)
    const startsWith = rows.filter((r) => r.name.toLowerCase().startsWith(raw.toLowerCase()));
    if (startsWith.length === 1 && raw.length >= 3) return { emp: startsWith[0]! };
    return {
        error: `More than one employee matches "${raw}". Ask which one.`,
        candidates: rows.map((r) => ({ code: r.employee_code, name: r.name })),
    };
}

function empBrief(e: EmpRow, today: string) {
    return {
        code: e.employee_code,
        name: e.name,
        team: e.team_name ?? e.department ?? null,
        manager: e.manager_name ?? null,
        status: effectiveEmploymentStatus(e.status, e.date_of_leaving, today),
        dateOfJoining: e.date_of_joining,
        dateOfLeaving: e.date_of_leaving,
        shiftStartsAt: e.shift_start,
        workEmail: e.email,
    };
}

type DayRow = {
    employee_id: number;
    attendance_date: string;
    in_time: string | null;
    out_time: string | null;
    working_hours: string | null;
    late: number;
    late_minutes: number | null;
    status_token: string | null;
    daily_status: string | null;
    note: string | null;
    origin: string | null;
};

type DayKind = "present" | "half_day" | "absent" | "wfh" | "leave" | "weekly_off" | "other";

function classifyDay(r: DayRow, today: string): DayKind {
    const st = (r.daily_status ?? "").toLowerCase();
    const tok = (r.status_token ?? "").toUpperCase();
    if (st === "wfh" || tok.startsWith("WFH")) return "wfh";
    if (st === "leave" || /^(PL|SL|CL|ML|LWP|CO)\b/.test(tok)) return "leave";
    if (st === "weekly_off" || tok === "WO" || tok === "DA") return "weekly_off";
    if (st === "absent" || tok === "AB") return "absent";
    if (st === "present" || st === "late" || tok.startsWith("P")) {
        const h = Number(r.working_hours);
        if (Number.isFinite(h) && h > 0 && h < HALF_DAY_MAX_HOURS && r.attendance_date < today && r.out_time) {
            return "half_day";
        }
        return "present";
    }
    return "other";
}

function dayView(r: DayRow, today: string) {
    const kind = classifyDay(r, today);
    return {
        date: r.attendance_date,
        day: weekday(r.attendance_date),
        status: kind,
        mark: r.status_token,
        punchIn: r.in_time,
        punchOut: r.out_time,
        worked: hm(r.working_hours),
        late: Boolean(r.late),
        lateMinutes: r.late ? r.late_minutes : null,
        editedByHr: r.origin === "hr_edit" ? true : undefined,
        note: r.note || undefined,
    };
}

const DAY_SELECT = `
  SELECT d.employee_id, d.attendance_date::text AS attendance_date, d.in_time, d.out_time,
         d.working_hours::text AS working_hours, d.late, d.late_minutes, d.status_token,
         d.daily_status, d.note, d.origin
  FROM daily_attendance d`;

/* ------------------------------ tools ------------------------------ */

type ToolArgs = Record<string, unknown>;
type ToolImpl = (ctx: ChatContext, args: ToolArgs) => Promise<unknown>;

async function findEmployees(ctx: ChatContext, args: ToolArgs) {
    const q = str(args.query);
    const team = str(args.team);
    const includeInactive = args.include_inactive === true || str(args.include_inactive) === "true";
    const params: unknown[] = [];
    const conds = [scopeCond(ctx, params)];
    if (q) {
        params.push(q);
        conds.push(`(upper(e.employee_code) = upper($${params.length}) OR e.name ILIKE '%' || $${params.length} || '%')`);
    }
    if (team) {
        params.push(team);
        conds.push(`(t.name ILIKE '%' || $${params.length} || '%' OR e.department ILIKE '%' || $${params.length} || '%')`);
    }
    const rows = await query<EmpRow>(
        `${EMP_SELECT} WHERE ${conds.join(" AND ")} ORDER BY e.employee_code LIMIT ${MAX_ROWS}`,
        params,
    );
    const list = rows
        .map((r) => empBrief(r, ctx.today))
        .filter((r) => includeInactive || r.status === "active");
    return { count: list.length, employees: list };
}

async function getEmployeeAttendance(ctx: ChatContext, args: ToolArgs) {
    const found = await resolveEmployee(ctx, args.employee);
    if ("error" in found) return found;
    let from = isIsoDate(args.from) ? args.from : ctx.today.slice(0, 8) + "01";
    let to = isIsoDate(args.to) ? args.to : ctx.today;
    if (to < from) [from, to] = [to, from];
    if (daysBetween(from, to) > MAX_RANGE_DAYS) from = addDays(to, -MAX_RANGE_DAYS);
    const rows = await query<DayRow>(
        `${DAY_SELECT} WHERE d.employee_id = $1 AND d.attendance_date BETWEEN $2::date AND $3::date
     ORDER BY d.attendance_date`,
        [found.emp.id, from, to],
    );
    const days = rows.map((r) => dayView(r, ctx.today));
    const summary = {
        present: days.filter((d) => d.status === "present" || d.status === "half_day").length,
        halfDays: days.filter((d) => d.status === "half_day").length,
        absent: days.filter((d) => d.status === "absent").length,
        late: days.filter((d) => d.late).length,
        wfh: days.filter((d) => d.status === "wfh").length,
        leave: days.filter((d) => d.status === "leave").length,
        totalWorked: hm(rows.reduce((s, r) => s + (Number(r.working_hours) || 0), 0)),
    };
    return {
        employee: empBrief(found.emp, ctx.today),
        from,
        to,
        summary,
        days,
        note: days.length === 0 ? "No attendance saved for this period." : undefined,
    };
}

async function getAttendanceOnDate(ctx: ChatContext, args: ToolArgs) {
    const date = isIsoDate(args.date) ? args.date : ctx.today;
    const filter = str(args.filter).toLowerCase() || "all";
    const params: unknown[] = [date];
    const cond = scopeCond(ctx, params);
    const emps = await query<EmpRow>(
        `${EMP_SELECT}
     WHERE ${cond}
       AND lower(trim(coalesce(e.status, 'active'))) = 'active'
       AND (e.date_of_leaving IS NULL OR e.date_of_leaving >= $1::date)
       AND (e.date_of_joining IS NULL OR e.date_of_joining <= $1::date)
     ORDER BY e.employee_code`,
        params,
    );
    const ids = emps.map((e) => e.id);
    const dayRows = ids.length
        ? await query<DayRow>(`${DAY_SELECT} WHERE d.attendance_date = $1::date AND d.employee_id = ANY($2::int[])`, [
            date,
            ids,
        ])
        : [];
    const byId = new Map(dayRows.map((r) => [r.employee_id, r]));
    const list = emps.map((e) => {
        const r = byId.get(e.id);
        const view = r ? dayView(r, ctx.today) : null;
        return {
            code: e.employee_code,
            name: e.name,
            team: e.team_name ?? e.department ?? null,
            status: view?.status ?? (date === ctx.today ? "not_punched_in_yet" : "no_record"),
            punchIn: view?.punchIn ?? null,
            punchOut: view?.punchOut ?? null,
            worked: view?.worked ?? null,
            late: view?.late ?? false,
            lateMinutes: view?.lateMinutes ?? null,
        };
    });
    const filtered = list.filter((x) => {
        switch (filter) {
            case "present":
                return x.status === "present" || x.status === "half_day";
            case "absent":
                return x.status === "absent";
            case "late":
                return x.late;
            case "wfh":
                return x.status === "wfh";
            case "leave":
                return x.status === "leave";
            case "half_day":
                return x.status === "half_day";
            case "not_punched_in":
                return !x.punchIn && x.status !== "leave" && x.status !== "weekly_off" && x.status !== "wfh";
            default:
                return true;
        }
    });
    return {
        date,
        day: weekday(date),
        filter,
        isToday: date === ctx.today,
        note:
            date === ctx.today
                ? "Today's data updates every 15 minutes from the door machines. Someone without a punch yet may still arrive."
                : undefined,
        count: filtered.length,
        totalEmployees: list.length,
        employees: filtered.slice(0, MAX_ROWS),
    };
}

async function getMonthlySummary(ctx: ChatContext, args: ToolArgs) {
    const month = /^\d{4}-\d{2}$/.test(str(args.month)) ? str(args.month) : ctx.today.slice(0, 7);
    const from = `${month}-01`;
    const to = addDays(addDays(from, 32).slice(0, 8) + "01", -1);
    let empFilter: number[] | null = null;
    let employee: ReturnType<typeof empBrief> | undefined;
    if (str(args.employee)) {
        const found = await resolveEmployee(ctx, args.employee);
        if ("error" in found) return found;
        empFilter = [found.emp.id];
        employee = empBrief(found.emp, ctx.today);
    }
    const params: unknown[] = [];
    const cond = scopeCond(ctx, params);
    let extra = "";
    if (empFilter) {
        params.push(empFilter);
        extra = ` AND e.id = ANY($${params.length}::int[])`;
    }
    const emps = await query<EmpRow>(`${EMP_SELECT} WHERE ${cond}${extra} ORDER BY e.employee_code`, params);
    const ids = emps.map((e) => e.id);
    const rows = ids.length
        ? await query<DayRow>(
            `${DAY_SELECT} WHERE d.employee_id = ANY($1::int[]) AND d.attendance_date BETWEEN $2::date AND $3::date`,
            [ids, from, to],
        )
        : [];
    const byEmp = new Map<number, DayRow[]>();
    for (const r of rows) {
        const list = byEmp.get(r.employee_id) ?? [];
        list.push(r);
        byEmp.set(r.employee_id, list);
    }
    const summaries = emps
        .filter((e) => byEmp.has(e.id))
        .map((e) => {
            const list = byEmp.get(e.id)!;
            const kinds = list.map((r) => classifyDay(r, ctx.today));
            return {
                code: e.employee_code,
                name: e.name,
                team: e.team_name ?? e.department ?? null,
                present: kinds.filter((k) => k === "present" || k === "half_day").length,
                halfDays: kinds.filter((k) => k === "half_day").length,
                absent: kinds.filter((k) => k === "absent").length,
                late: list.filter((r) => r.late).length,
                wfh: kinds.filter((k) => k === "wfh").length,
                leave: kinds.filter((k) => k === "leave").length,
                totalWorked: hm(list.reduce((s, r) => s + (Number(r.working_hours) || 0), 0)),
            };
        });
    return {
        month,
        employee,
        count: summaries.length,
        employees: summaries.slice(0, MAX_ROWS),
        note: summaries.length === 0 ? "No attendance saved for this month." : undefined,
    };
}

async function getLeaveRequests(ctx: ChatContext, args: ToolArgs) {
    const params: unknown[] = [];
    const conds = [scopeCond(ctx, params)];
    let employee: ReturnType<typeof empBrief> | undefined;
    if (str(args.employee)) {
        const found = await resolveEmployee(ctx, args.employee);
        if ("error" in found) return found;
        params.push(found.emp.id);
        conds.push(`e.id = $${params.length}`);
        employee = empBrief(found.emp, ctx.today);
    }
    const from = isIsoDate(args.from) ? args.from : addDays(ctx.today, -30);
    const to = isIsoDate(args.to) ? args.to : addDays(ctx.today, 60);
    params.push(from, to);
    conds.push(`lr.end_date >= $${params.length - 1}::date AND lr.start_date <= $${params.length}::date`);
    const status = str(args.status).toLowerCase();
    if (["pending", "approved", "rejected", "cancelled"].includes(status)) {
        params.push(status);
        conds.push(`lr.status = $${params.length}`);
    }
    const rows = await query<{
        employee_code: string;
        name: string;
        leave_type: string;
        start_date: string;
        end_date: string;
        status: string;
        reason: string;
        decided_at: string | null;
        decided_by: string | null;
    }>(
        `SELECT e.employee_code, e.name, lr.leave_type, lr.start_date::text AS start_date,
            lr.end_date::text AS end_date, lr.status, lr.reason, lr.decided_at::text AS decided_at,
            du.name AS decided_by
     FROM leave_requests lr
     JOIN employees e ON e.id = lr.employee_id
     LEFT JOIN users du ON du.id = lr.decided_by_user_id
     WHERE ${conds.join(" AND ")}
     ORDER BY lr.start_date DESC
     LIMIT ${MAX_ROWS}`,
        params,
    );
    return {
        from,
        to,
        employee,
        count: rows.length,
        leaves: rows.map((r) => ({
            code: r.employee_code,
            name: r.name,
            type: r.leave_type.toUpperCase(),
            from: r.start_date,
            to: r.end_date,
            days: daysBetween(r.start_date, r.end_date) + 1,
            status: r.status,
            reason: r.reason || undefined,
            decidedBy: r.decided_by ?? undefined,
        })),
    };
}

async function getPendingApprovals(ctx: ChatContext) {
    const params: unknown[] = [];
    let cond: string;
    if (ctx.mode === "full") {
        cond = "TRUE";
    } else if (ctx.mode === "team") {
        params.push(ctx.user.id);
        const sc = scopeCond(ctx, params);
        cond = `(x.assigned_approver_user_id = $1 OR ${sc})`;
    } else {
        params.push(ctx.selfEmployeeId ?? -1);
        cond = `e.id = $1`;
    }
    const leaves = await query<{ employee_code: string; name: string; leave_type: string; start_date: string; end_date: string; reason: string }>(
        `SELECT e.employee_code, e.name, x.leave_type, x.start_date::text AS start_date, x.end_date::text AS end_date, x.reason
     FROM leave_requests x JOIN employees e ON e.id = x.employee_id
     WHERE x.status = 'pending' AND ${cond}
     ORDER BY x.start_date LIMIT ${MAX_ROWS}`,
        params,
    );
    const punches = await query<{ employee_code: string; name: string; attendance_date: string; in_time: string | null; out_time: string | null }>(
        `SELECT e.employee_code, e.name, x.attendance_date::text AS attendance_date, x.in_time, x.out_time
     FROM portal_punch_days x JOIN employees e ON e.id = x.employee_id
     WHERE x.status = 'pending' AND ${cond}
     ORDER BY x.attendance_date LIMIT ${MAX_ROWS}`,
        params,
    ).catch(() => []);
    return {
        pendingLeaveRequests: leaves.map((r) => ({
            code: r.employee_code,
            name: r.name,
            type: r.leave_type.toUpperCase(),
            from: r.start_date,
            to: r.end_date,
            reason: r.reason || undefined,
        })),
        pendingInOutRequests: punches.map((r) => ({
            code: r.employee_code,
            name: r.name,
            date: r.attendance_date,
            in: r.in_time,
            out: r.out_time,
        })),
    };
}

async function getHolidays(ctx: ChatContext, args: ToolArgs) {
    const year = Number.parseInt(str(args.year), 10) || Number(ctx.today.slice(0, 4));
    const rows = await query<{ holiday_date: string; name: string; day_type: string | null }>(
        `SELECT holiday_date::text AS holiday_date, name, day_type FROM company_holidays
     WHERE year = $1 ORDER BY holiday_date`,
        [year],
    ).catch(() => []);
    return {
        year,
        holidays: rows.map((r) => ({
            date: r.holiday_date,
            day: weekday(r.holiday_date),
            name: r.name,
            type: r.day_type === "half" ? "half day" : "full day",
            upcoming: r.holiday_date >= ctx.today,
        })),
    };
}

async function getPolicy(_ctx: ChatContext, args: ToolArgs) {
    const topic = str(args.topic);
    const text = policyText(topic) || policyText();
    return { topic: topic || "all", text };
}

const IMPLS: Record<string, ToolImpl> = {
    find_employees: findEmployees,
    get_employee_attendance: getEmployeeAttendance,
    get_attendance_on_date: getAttendanceOnDate,
    get_monthly_summary: getMonthlySummary,
    get_leave_requests: getLeaveRequests,
    get_pending_approvals: (ctx) => getPendingApprovals(ctx),
    get_holidays: getHolidays,
    get_policy: getPolicy,
};

export const TOOL_SPECS: OllamaToolSpec[] = [
    {
        type: "function",
        function: {
            name: "find_employees",
            description:
                "List or search employees: code, name, team, manager, status, joining/leaving date, shift start, work email. Use to answer who is in a team, who someone's manager is, or to find an employee code.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Employee code (e.g. PMPL03) or part of a name. Leave empty to list all." },
                    team: { type: "string", description: "Team or department name, e.g. Product, Design" },
                    include_inactive: { type: "boolean", description: "Include people who have left" },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_employee_attendance",
            description:
                "Day-by-day attendance of ONE employee for a date range: punch-in, punch-out, hours worked, late (minutes), status (present, half_day, absent, wfh, leave, weekly_off) and totals.",
            parameters: {
                type: "object",
                properties: {
                    employee: { type: "string", description: 'Employee code, name, or "me" for the person asking' },
                    from: { type: "string", description: "Start date YYYY-MM-DD (default: first day of this month)" },
                    to: { type: "string", description: "End date YYYY-MM-DD (default: today)" },
                },
                required: ["employee"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_attendance_on_date",
            description:
                "Everyone's attendance on ONE date. Use for questions like who is late today, who is absent, who has not punched in yet, who is on WFH or leave on a date.",
            parameters: {
                type: "object",
                properties: {
                    date: { type: "string", description: "Date YYYY-MM-DD (default: today)" },
                    filter: {
                        type: "string",
                        enum: ["all", "present", "absent", "late", "wfh", "leave", "half_day", "not_punched_in"],
                        description: "Which people to return",
                    },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_monthly_summary",
            description:
                "Per-employee totals for a month: present days, half days, absent, late count, WFH, leave, total hours. Use for rankings like most late marks or lowest hours.",
            parameters: {
                type: "object",
                properties: {
                    month: { type: "string", description: "Month YYYY-MM (default: this month)" },
                    employee: { type: "string", description: "Optional: only this employee (code or name)" },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_leave_requests",
            description: "Leave requests (PL, SL, CL) with dates, status and reason.",
            parameters: {
                type: "object",
                properties: {
                    employee: { type: "string", description: "Optional employee code or name" },
                    from: { type: "string", description: "YYYY-MM-DD (default: 30 days ago)" },
                    to: { type: "string", description: "YYYY-MM-DD (default: 60 days ahead)" },
                    status: { type: "string", enum: ["pending", "approved", "rejected", "cancelled"] },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_pending_approvals",
            description: "Leave requests and in/out (WFH punch) requests waiting for approval.",
            parameters: { type: "object", properties: {} },
        },
    },
    {
        type: "function",
        function: {
            name: "get_holidays",
            description: "Company holiday list for a year (date, name, full or half day).",
            parameters: {
                type: "object",
                properties: { year: { type: "string", description: "Year, e.g. 2026 (default: this year)" } },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_policy",
            description:
                "Company and attendance policy text (late marks, half day, leave, WFH, conduct, confidentiality, IT, benefits).",
            parameters: {
                type: "object",
                properties: { topic: { type: "string", description: "Optional keyword, e.g. late, leave, wfh, half day" } },
            },
        },
    },
];

/** Run one tool call safely. Always returns a JSON string for the model. */
export async function runTool(ctx: ChatContext, name: string, rawArgs: unknown): Promise<string> {
    const impl = IMPLS[name];
    if (!impl) return JSON.stringify({ error: `Unknown tool ${name}` });
    let args: ToolArgs = {};
    if (typeof rawArgs === "string") {
        try {
            args = JSON.parse(rawArgs) as ToolArgs;
        } catch {
            args = {};
        }
    } else if (rawArgs && typeof rawArgs === "object") {
        args = rawArgs as ToolArgs;
    }
    try {
        const result = await impl(ctx, args);
        let json = JSON.stringify(result);
        if (json.length > 24_000) {
            json = json.slice(0, 24_000) + '..."(truncated: ask a narrower question)"';
        }
        return json;
    } catch (e) {
        console.error(`[chat] tool ${name} failed:`, e);
        return JSON.stringify({ error: "Could not read that data right now." });
    }
}

/** Compact list of the employees this user may see (put in the prompt so the AI never invents names). */
export async function employeeRoster(ctx: ChatContext): Promise<string> {
    const params: unknown[] = [];
    const cond = scopeCond(ctx, params);
    const rows = await query<EmpRow>(`${EMP_SELECT} WHERE ${cond} ORDER BY e.employee_code LIMIT 200`, params);
    return rows
        .map((r) => {
            const status = effectiveEmploymentStatus(r.status, r.date_of_leaving, ctx.today);
            const team = r.team_name ?? r.department ?? "-";
            return `${r.employee_code} | ${r.name} | ${team}${status === "active" ? "" : " | LEFT"}`;
        })
        .join("\n");
}