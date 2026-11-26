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
import { policySections, policyText } from "./policies.js";
import { findHelp, helpTopicTitles } from "./help.js";

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
       AND (upper(e.employee_code) = upper($1) OR (e.name ILIKE $1 || '%' OR e.name ILIKE '% ' || $1 || '%'))
     ORDER BY (upper(e.employee_code) = upper($1)) DESC, e.employee_code
     LIMIT 10`,
        params,
    );
    if (rows.length === 0) {
        if (ctx.mode !== "full") {
            const anywhere = await query<{ n: number }>(
                `SELECT COUNT(*)::int AS n FROM employees e
                 WHERE upper(e.employee_code) = upper($1) OR (e.name ILIKE $1 || '%' OR e.name ILIKE '% ' || $1 || '%')`,
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
        conds.push(
            `(upper(e.employee_code) = upper($${params.length}) OR e.name ILIKE $${params.length} || '%' OR e.name ILIKE '% ' || $${params.length} || '%')`,
        );
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
        only: ["late", "absent", "wfh", "leave", "half_day"].includes(str(args.only)) ? str(args.only) : undefined,
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
        counts: {
            punchedIn: list.filter((x) => x.punchIn).length,
            late: list.filter((x) => x.late).length,
            absent: list.filter((x) => x.status === "absent").length,
            wfh: list.filter((x) => x.status === "wfh").length,
            leave: list.filter((x) => x.status === "leave").length,
            halfDay: list.filter((x) => x.status === "half_day").length,
            notPunchedIn: list.filter(
                (x) => !x.punchIn && x.status !== "leave" && x.status !== "weekly_off" && x.status !== "wfh",
            ).length,
        },
        employees: filtered.slice(0, MAX_ROWS),
    };
}

/** People with HR / admin access in the portal (anyone may ask who HR is). */
async function getHrContacts(_ctx: ChatContext, _args: ToolArgs) {
    const rows = await query<{ name: string; email: string; role: string; code: string | null; team: string | null }>(
        `SELECT COALESCE(NULLIF(e.name, ''), NULLIF(u.name, ''), u.email) AS name, u.email, u.role,
                e.employee_code AS code, COALESCE(t.name, e.department) AS team
           FROM users u
           LEFT JOIN employees e ON lower(e.email) = lower(u.email)
           LEFT JOIN teams t ON t.id = e.team_id
          WHERE u.role IN ('hr', 'admin') AND COALESCE(u.account_disabled, FALSE) = FALSE
          ORDER BY (u.role = 'hr') DESC, name`,
    ).catch(() => []);
    return {
        hr: rows.filter((r) => r.role === "hr").map((r) => ({ name: r.name, code: r.code, email: r.email, team: r.team })),
        admins: rows.filter((r) => r.role === "admin").map((r) => ({ name: r.name, code: r.code, email: r.email, team: r.team })),
    };
}

/** Teams with their manager and members (managers see only their own team). */
async function listTeams(ctx: ChatContext, args: ToolArgs) {
    const q = str(args.team) || str(args.query);
    const params: unknown[] = [];
    const cond = scopeCond(ctx, params);
    const emps = await query<EmpRow & { team_id: number | null }>(
        `${EMP_SELECT.replace("SELECT e.id,", "SELECT e.team_id, e.id,")}
         WHERE ${cond}
           AND lower(trim(coalesce(e.status, 'active'))) = 'active'
           AND (e.date_of_leaving IS NULL OR e.date_of_leaving >= $${params.push(ctx.today)}::date)
         ORDER BY e.employee_code`,
        params,
    );
    const teams = await query<{ id: number; name: string; manager_name: string | null; manager_email: string | null }>(
        `SELECT t.id, t.name, mu.name AS manager_name, mu.email AS manager_email
         FROM teams t LEFT JOIN users mu ON mu.id = t.manager_user_id
         ORDER BY t.sort_order, t.name`,
    );
    const visibleTeamIds = new Set(emps.map((e) => e.team_id).filter((x): x is number => x != null));
    const list = teams
        .filter((t) => ctx.mode === "full" || visibleTeamIds.has(t.id))
        .filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()) || (t.manager_name ?? "").toLowerCase().includes(q.toLowerCase()))
        .map((t) => {
            const members = emps.filter((e) => e.team_id === t.id);
            return {
                team: t.name,
                manager: t.manager_name ?? null,
                memberCount: members.length,
                members: members.map((m) => `${m.name} (${m.employee_code})`),
            };
        });
    const unassigned = ctx.mode === "full" && !q ? emps.filter((e) => e.team_id == null).map((m) => `${m.name} (${m.employee_code})`) : [];
    return { count: list.length, teams: list, unassigned };
}

async function getTodayOverview(ctx: ChatContext, args: ToolArgs) {
    return getAttendanceOnDate(ctx, { date: isIsoDate(args.date) ? args.date : ctx.today, filter: "all" });
}

async function getHelp(_ctx: ChatContext, args: ToolArgs) {
    const question = str(args.question) || str(args.topic);
    return { question, topics: findHelp(question), allTopics: helpTopicTitles() };
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
                hoursNum: list.reduce((s, r) => s + (Number(r.working_hours) || 0), 0),
            };
        });
    const sortBy = ["late", "absent", "present", "hours_low", "hours_high", "wfh", "leave"].includes(str(args.sort_by))
        ? str(args.sort_by)
        : "late";
    const key = (x: (typeof summaries)[number]): number =>
        sortBy === "hours_low" ? -x.hoursNum : sortBy === "hours_high" ? x.hoursNum : Number(x[sortBy as "late"]);
    summaries.sort((a, b) => key(b) - key(a) || a.code.localeCompare(b.code));
    return {
        month,
        sortBy,
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
    // brief: 0 = full policy, 1 = short (default), 2 = shortest (one line per section)
    const brief = args.brief === true ? 1 : typeof args.brief === "number" ? args.brief : 0;
    if (!topic) return { topic: "all", brief, found: true, markdown: await policyText(), allTitles: [] as string[] };
    return { topic, brief, ...(await policySections(topic)) };
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
    list_teams: listTeams,
    get_hr_contacts: getHrContacts,
    get_today_overview: getTodayOverview,
    get_help: getHelp,
};

/* ---- short tool descriptions: every word here is re-read on each question (slow on CPU) ---- */
const S = (type: string, description?: string, e?: string[]) => ({ type, ...(description ? { description } : {}), ...(e ? { enum: e } : {}) });
const tool = (
    name: string,
    description: string,
    properties: Record<string, { type: string; description?: string; enum?: string[] }>,
    required?: string[],
): OllamaToolSpec => ({ type: "function", function: { name, description, parameters: { type: "object", properties, ...(required ? { required } : {}) } } });

export const TOOL_SPECS: OllamaToolSpec[] = [
    tool("find_employees", "Search employees (code, name, team, manager, shift).", {
        query: S("string", "code or name"),
        team: S("string"),
    }),
    tool(
        "get_employee_attendance",
        "One employee's daily attendance for a date range (punch in/out, hours, late).",
        { employee: S("string", 'code, name or "me"'), from: S("string", "YYYY-MM-DD"), to: S("string", "YYYY-MM-DD") },
        ["employee"],
    ),
    tool("get_attendance_on_date", "Everyone's attendance on one date (who is late/absent/not punched in/WFH/leave).", {
        date: S("string", "YYYY-MM-DD"),
        filter: S("string", undefined, ["all", "present", "absent", "late", "wfh", "leave", "half_day", "not_punched_in"]),
    }),
    tool("get_monthly_summary", "Monthly totals per employee: present, absent, late count, WFH, leave, hours. Use sort_by for rankings.", {
        month: S("string", "YYYY-MM"),
        employee: S("string", "optional code or name"),
        sort_by: S("string", "most first", ["late", "absent", "present", "hours_low", "hours_high", "wfh", "leave"]),
    }),
    tool("get_leave_requests", "Leave requests with dates and status.", {
        employee: S("string"),
        from: S("string"),
        to: S("string"),
        status: S("string", undefined, ["pending", "approved", "rejected"]),
    }),
    tool("get_pending_approvals", "Leave and in/out requests waiting for approval.", {}),
    tool("get_holidays", "Company holiday list.", { year: S("string") }),
    tool("get_policy", "Company / attendance policy text.", { topic: S("string", "e.g. late, leave, wfh") }),
    tool("list_teams", "Teams, their managers and members.", { team: S("string") }),
    tool("get_hr_contacts", "Who is HR / admin in the portal and how many.", {}),
    tool("get_today_overview", "Today's attendance counts.", {}),
    tool("get_help", "How to use the HR portal.", { question: S("string") }),
];

/* ---------------- ready-made answers (no second AI round = much faster) ---------------- */

type Obj = Record<string, unknown>;
const KIND: Record<string, string> = {
    present: "Present",
    half_day: "Half day",
    absent: "Absent",
    wfh: "WFH",
    leave: "Leave",
    weekly_off: "Weekly off",
    not_punched_in_yet: "Not punched in yet",
    no_record: "No record",
    other: "-",
};
const FILTER_LABEL: Record<string, string> = {
    all: "",
    present: "present",
    absent: "absent",
    late: "late",
    wfh: "on WFH",
    leave: "on leave",
    half_day: "on half day",
    not_punched_in: "not punched in",
};
const cell = (v: unknown) => (v == null || v === "" ? "-" : String(v).replace(/\|/g, "/"));
function table(head: string[], rows: unknown[][]): string {
    return [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
}
function niceDate(iso: string): string {
    return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
}

function errorDisplay(r: Obj): string {
    const msg = String(r.error).replace(/\s*(Tell the user politely\.|Do not guess a name\.|Ask which one\.)\s*$/, "");
    const c = r.candidates as Array<{ code: string; name: string }> | undefined;
    return c?.length ? `${msg}\n\n${c.map((x) => `- ${x.code} - ${x.name}`).join("\n")}\n\nWhich one do you mean?` : msg;
}

/** Markdown answer straight from the data, or null when the AI should summarise. */
const first = (name: unknown) => String(name ?? "").split(" ")[0] || String(name ?? "");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "A, B and C" (+N more) */
function nameList(names: string[], max = 6): string {
    if (names.length === 0) return "";
    const shown = names.slice(0, max);
    const more = names.length - shown.length;
    const body = shown.length === 1 ? shown[0]! : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
    return more > 0 ? `${shown.join(", ")} and ${more} more` : body;
}

/**
 * Short version of policy markdown: each section's title + summary + its first 2 rules (trimmed).
 * Works on the markdown policySections/policyText return ("**Title** (Doc)", summary line, "- rule" lines).
 */
function briefPolicy(markdown: string, maxRules = 2): string {
    const out: string[] = [];
    let rulesShown = 0;
    let summaryDone = false;
    let summaryLine = "";
    for (const raw of markdown.split("\n")) {
        const line = raw.trim();
        if (!line || line.startsWith("Note:") || line.startsWith("_Note")) continue;
        const heading = line.match(/^(?:#+\s*|\*\*)(.+?)(?:\*\*)?(?:\s*\((?:Attendance|Company) policy\))?$/);
        if ((line.startsWith("**") && line.includes("**", 2)) || line.startsWith("#")) {
            const title = (heading?.[1] ?? line).replace(/\*\*/g, "").replace(/\s*\((Attendance|Company) policy\)\s*$/, "").trim();
            if (/^(Attendance|Company) policy$/i.test(title)) continue;
            out.push(`- **${title}**`);
            rulesShown = 0;
            summaryDone = false;
            summaryLine = "";
            continue;
        }
        const clip = (t: string) => (t.length > 140 ? `${t.slice(0, 137).trimEnd()}...` : t);
        if (line.startsWith("- ")) {
            const rule = line.slice(2);
            const head = (t: string) => t.toLowerCase().split(/\s+/).slice(0, 4).join(" ");
            if (summaryLine && head(rule) === head(summaryLine)) continue; // same as the summary
            if (rulesShown < maxRules) out.push(`  - ${clip(rule)}`);
            rulesShown++;
        } else if (!summaryDone && out.length) {
            out[out.length - 1] += `: ${clip(line)}`;
            summaryLine = line;
            summaryDone = true;
        }
    }
    return out.join("\n");
}

/** Friendly answer (a sentence + the real table) straight from the data, or null when the AI should handle it. */
function displayFor(name: string, r: Obj): string | null {
    if (r.error) return errorDisplay(r);
    switch (name) {
        case "find_employees": {
            const list = r.employees as Obj[];
            if (!list.length) return "I couldn't find anyone with that name or code. Try the employee code (e.g. PMPL03) or ask \"list of managers\".";
            if (list.length === 1) {
                const e = list[0]!;
                const bits = [
                    e.team ? `in the **${e.team}** team` : null,
                    e.manager ? `reporting to **${e.manager}**` : null,
                    e.shiftStartsAt ? `shift starts at ${e.shiftStartsAt}` : null,
                    e.dateOfJoining ? `joined on ${niceDate(String(e.dateOfJoining))} ${String(e.dateOfJoining).slice(0, 4)}` : null,
                ].filter(Boolean);
                return `**${e.name}** (${e.code}) is ${e.status === "active" ? "an active employee" : "no longer with the company"}${bits.length ? `, ${bits.join(", ")}` : ""}.` +
                    (e.workEmail ? `\n\nWork email: ${e.workEmail}` : "");
            }
            return `I found **${list.length} people**: ${nameList(list.map((e) => `${e.name} (${e.code})`))}.\n\n` +
                table(["Code", "Name", "Team", "Manager", "Shift start"], list.map((e) => [e.code, e.name, e.team, e.manager, e.shiftStartsAt]));
        }
        case "get_hr_contacts": {
            const hr = r.hr as Obj[];
            const admins = r.admins as Obj[];
            const who = (p: Obj) => `${p.name}${p.code ? ` (${p.code})` : ""}`;
            if (!hr.length && !admins.length) return "No HR accounts are set up in the portal yet.";
            const intro = hr.length
                ? `There ${hr.length === 1 ? "is" : "are"} **${plural(hr.length, "HR person", "HR people")}**: ${nameList(hr.map((p) => `**${who(p)}**`), 10)}.`
                : "No one has the HR role yet.";
            const adm = admins.length ? ` ${plural(admins.length, "admin")} also ${admins.length === 1 ? "has" : "have"} full access: ${nameList(admins.map(who), 10)}.` : "";
            return `${intro}${adm}\n\n` + table(["Name", "Role", "Email"], [...hr.map((p) => [who(p), "HR", p.email]), ...admins.map((p) => [who(p), "Admin", p.email])]);
        }
        case "list_teams": {
            const teams = r.teams as Obj[];
            const unassigned = (r.unassigned as string[]) ?? [];
            if (!teams.length) return "No teams are set up yet. HR can create them in **Admin -> Teams**.";
            const managers = teams.filter((t) => t.manager).map((t) => `**${t.manager}** (${t.team})`);
            const intro =
                teams.length === 1
                    ? `The **${teams[0]!.team}** team ${teams[0]!.manager ? `is managed by **${teams[0]!.manager}**` : "has no manager assigned"} and has ${plural(Number(teams[0]!.memberCount), "member")}.`
                    : `There are **${teams.length} teams**. Managers: ${managers.length ? nameList(managers, 10) : "none assigned yet"}.`;
            return `${intro}\n\n` +
                table(["Team", "Manager", "Members", "People"], teams.map((t) => [t.team, t.manager ?? "-", t.memberCount, (t.members as string[]).join(", ")])) +
                (unassigned.length ? `\n\nNot in any team yet: ${nameList(unassigned, 10)}.` : "");
        }
        case "get_today_overview": {
            const c = r.counts as Obj;
            const when = r.isToday ? "today" : `on ${niceDate(String(r.date))}`;
            const list = r.employees as Obj[];
            const lateNames = list
                .filter((x) => x.late)
                .sort((a, b) => Number(b.lateMinutes ?? 0) - Number(a.lateMinutes ?? 0))
                .map((x) => `${first(x.name)} (${x.lateMinutes ?? "?"} min)`);
            const lines = [
                `Here's attendance ${when} (${niceDate(String(r.date))}):`,
                `- **${c.punchedIn} of ${r.totalEmployees}** have punched in`,
                `- Late: **${c.late}**${lateNames.length ? ` - ${nameList(lateNames)}` : ""}`,
                `- Not punched in yet: **${c.notPunchedIn}**`,
                `- WFH: **${c.wfh}** · Leave: **${c.leave}**${Number(c.absent) ? ` · Absent: **${c.absent}**` : ""}`,
            ];
            return lines.join("\n") + (r.note ? `\n\nNote: ${r.note}` : "") + `\n\nAsk "today's punch-in" for the full list.`;
        }
        case "get_employee_attendance": {
            const e = r.employee as Obj;
            const sm = r.summary as Obj;
            const days = r.days as Obj[];
            const period = `${niceDate(String(r.from))} to ${niceDate(String(r.to))}`;
            if (!days.length) return `I don't have any attendance saved for **${e.name}** (${e.code}) from ${period}.`;
            const fn = first(e.name);
            const only = r.only ? String(r.only) : "";
            if (only) {
                const pick = days.filter((d) => (only === "late" ? d.late : d.status === only));
                const label: Record<string, [string, string]> = {
                    late: ["late", "was never late"],
                    absent: ["absent", "had no absences"],
                    wfh: ["on WFH", "had no WFH days"],
                    leave: ["on leave", "took no leave"],
                    half_day: ["on a half day (under 5 hours)", "had no half days"],
                };
                const [word, none] = label[only]!;
                if (!pick.length) return `**${e.name}** (${e.code}) ${none} from ${period}.`;
                const dates = nameList(pick.map((d) => `${niceDate(String(d.date))}${only === "late" && d.lateMinutes ? ` (${d.lateMinutes} min)` : ""}`), 12);
                return `**${e.name}** (${e.code}) was ${word} ${only === "late" ? `**${plural(pick.length, "time")}**` : `on **${plural(pick.length, "day")}**`} from ${period}: ${dates}.\n\n` +
                    table(["Date", "Status", "In", "Out", "Worked", "Late"], pick.map((d) => [niceDate(String(d.date)), KIND[String(d.status)] ?? d.mark, d.punchIn, d.punchOut, d.worked, d.late ? `${d.lateMinutes ?? ""} min` : ""]));
            }
            const parts = [`present on **${plural(Number(sm.present), "day")}**`];
            if (Number(sm.halfDays)) parts.push(`${plural(Number(sm.halfDays), "half day")}`);
            parts.push(Number(sm.absent) ? `absent **${plural(Number(sm.absent), "day")}**` : "no absences");
            parts.push(Number(sm.late) ? `late **${plural(Number(sm.late), "time")}**` : "never late");
            if (Number(sm.wfh)) parts.push(`${plural(Number(sm.wfh), "WFH day")}`);
            if (Number(sm.leave)) parts.push(`${plural(Number(sm.leave), "leave day")}`);
            const intro = `From ${period}, **${e.name}** (${e.code}) was ${parts.join(", ")}, with **${sm.totalWorked ?? "0:00"}** hours worked in total.`;
            return `${intro}\n\n` + table(
                ["Date", "Status", "In", "Out", "Worked", "Late"],
                days.map((d) => [niceDate(String(d.date)), KIND[String(d.status)] ?? d.mark, d.punchIn, d.punchOut, d.worked, d.late ? `${d.lateMinutes ?? ""} min` : ""]),
            ) + (Number(sm.late) || Number(sm.absent) ? "" : `\n\nNice - ${fn} has a clean record for this period.`);
        }
        case "get_attendance_on_date": {
            const list = r.employees as Obj[];
            const c = (r.counts ?? {}) as Obj;
            const when = r.isToday ? `today (${niceDate(String(r.date))})` : `on ${niceDate(String(r.date))}`;
            const sofar = r.isToday ? " so far" : "";
            const note = r.note ? `\n\nNote: ${r.note}` : "";
            const filter = String(r.filter);
            const rows = [...list].sort((a, b) => String(a.punchIn ?? "99:99").localeCompare(String(b.punchIn ?? "99:99")));
            const tableMd = () =>
                table(["Code", "Name", "Status", "In", "Out", "Late"], rows.map((x) => [x.code, x.name, KIND[String(x.status)] ?? x.status, x.punchIn, x.punchOut, x.late ? `${x.lateMinutes ?? ""} min` : ""]));
            const names = (fmt: (x: Obj) => string) => nameList(rows.map(fmt));
            switch (filter) {
                case "late":
                    if (!list.length) {
                        if (!Number(c.punchedIn)) return `Nobody has punched in ${when} yet, so there are no late marks yet.${note}`;
                        return `Good news - nobody has been late ${when}${sofar}. ${c.punchedIn} of ${r.totalEmployees} people have punched in.${note}`;
                    }
                    return `**${plural(list.length, "person", "people")}** ${list.length === 1 ? "was" : "were"} late ${when}${sofar}: ${names((x) => `${x.name} (${x.lateMinutes ?? "?"} min)`)}.\n\n${tableMd()}${note}`;
                case "not_punched_in":
                    if (!list.length) return `Everyone has punched in ${when} (or is on WFH / leave).${note}`;
                    return `**${plural(list.length, "person", "people")}** ${list.length === 1 ? "hasn't" : "haven't"} punched in ${when}${sofar}: ${names((x) => String(x.name))}.\n\n${tableMd()}${note}`;
                case "absent":
                    if (!list.length) return `Nobody is marked absent ${when}.${note}`;
                    return `**${plural(list.length, "person", "people")}** ${list.length === 1 ? "is" : "are"} marked absent ${when}: ${names((x) => String(x.name))}.\n\n${tableMd()}`;
                case "wfh":
                    if (!list.length) return `Nobody is on WFH ${when}.`;
                    return `**${plural(list.length, "person", "people")}** ${list.length === 1 ? "is" : "are"} working from home ${when}: ${names((x) => String(x.name))}.\n\n${tableMd()}`;
                case "leave":
                    if (!list.length) return `Nobody is on leave ${when}.`;
                    return `**${plural(list.length, "person", "people")}** ${list.length === 1 ? "is" : "are"} on leave ${when}: ${names((x) => String(x.name))}.\n\n${tableMd()}`;
                case "half_day":
                    if (!list.length) return `No half days ${when}.`;
                    return `**${plural(list.length, "person", "people")}** worked under 5 hours ${when}: ${names((x) => `${x.name} (${x.worked ?? "-"})`)}.\n\n${tableMd()}`;
                case "present":
                    if (!list.length) return `Nobody is marked present ${when} yet.${note}`;
                    return `**${list.length} of ${r.totalEmployees}** are present ${when}.\n\n${tableMd()}${note}`;
                default: {
                    if (!list.length) return `No employees found ${when}.`;
                    const punched = rows.filter((x) => x.punchIn);
                    const earliest = punched[0];
                    const latest = punched[punched.length - 1];
                    const intro =
                        punched.length === 0
                            ? `Nobody has punched in ${when}${sofar}.`
                            : `**${punched.length} of ${r.totalEmployees}** have punched in ${when}${sofar}. ` +
                            `Earliest: ${earliest!.name} at ${earliest!.punchIn}` +
                            (punched.length > 1 ? `; latest: ${latest!.name} at ${latest!.punchIn}` : "") +
                            `.${Number(c.late) ? ` ${plural(Number(c.late), "person was", "people were")} late.` : ""}`;
                    return `${intro}\n\n${tableMd()}${note}`;
                }
            }
        }
        case "get_monthly_summary": {
            const e = r.employee as Obj | undefined;
            const list = r.employees as Obj[];
            const monthLabel = new Date(`${r.month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
            if (!e) {
                if (!list.length) return `I don't have any attendance saved for ${monthLabel} yet.`;
                const top = list[0]!;
                const by = String(r.sortBy);
                const tiedLate = list.filter((x) => Number(x.late) === Number(top.late));
                const nextLate = list.filter((x) => Number(x.late) < Number(top.late) && Number(x.late) > 0).slice(0, 2);
                const intro =
                    by === "late"
                        ? Number(top.late) === 0
                            ? `Nobody has a late mark in ${monthLabel} - great punctuality!`
                            : tiedLate.length > 1
                                ? `${nameList(tiedLate.map((x) => `**${x.name}** (${x.code})`))} are tied for the most late marks in ${monthLabel}, with **${top.late}** each.`
                                : `**${top.name}** (${top.code}) has the most late marks in ${monthLabel}: **${top.late}**.` +
                                (nextLate.length ? ` Next: ${nextLate.map((x) => `${x.name} (${x.late})`).join(", ")}.` : "")
                        : by === "absent"
                            ? `**${top.name}** (${top.code}) has the most absences in ${monthLabel}: **${plural(Number(top.absent), "day")}**.`
                            : by === "hours_low"
                                ? `**${top.name}** (${top.code}) has the lowest hours in ${monthLabel}: **${top.totalWorked ?? "0:00"}**.`
                                : by === "hours_high"
                                    ? `**${top.name}** (${top.code}) has worked the most hours in ${monthLabel}: **${top.totalWorked ?? "0:00"}**.`
                                    : by === "wfh"
                                        ? `**${top.name}** (${top.code}) has the most WFH days in ${monthLabel}: **${top.wfh}**.`
                                        : by === "leave"
                                            ? `**${top.name}** (${top.code}) has the most leave days in ${monthLabel}: **${top.leave}**.`
                                            : `Here's the ${monthLabel} summary for ${plural(list.length, "employee")}.`;
                return `${intro}\n\n` +
                    table(
                        ["Code", "Name", "Present", "Absent", "Late", "WFH", "Leave", "Worked"],
                        list.slice(0, 30).map((x) => [x.code, x.name, x.present, x.absent, x.late, x.wfh, x.leave, x.totalWorked]),
                    );
            }
            const x = list[0];
            if (!x) return `I don't have any attendance saved for **${e.name}** (${e.code}) in ${monthLabel}.`;
            const lateLine =
                Number(x.late) === 0
                    ? "no late marks"
                    : `**${plural(Number(x.late), "late mark")}**${Number(x.late) >= 4 ? " (4 or more means a salary cut as per the late mark policy)" : Number(x.late) === 3 ? " (one more and the late-mark salary cut applies)" : ""}`;
            return `In ${monthLabel}, **${x.name}** (${x.code}) has ${lateLine}, ` +
                `was present **${plural(Number(x.present), "day")}**${Number(x.halfDays) ? ` (${plural(Number(x.halfDays), "half day")})` : ""}, ` +
                `absent **${plural(Number(x.absent), "day")}**, WFH ${x.wfh}, leave ${x.leave}, and worked **${x.totalWorked ?? "0:00"}** hours.`;
        }
        case "get_leave_requests": {
            const list = r.leaves as Obj[];
            if (!list.length) return `There are no leave requests between ${niceDate(String(r.from))} and ${niceDate(String(r.to))}.`;
            const pending = list.filter((l) => l.status === "pending").length;
            return `I found **${plural(list.length, "leave request")}**${pending ? `, ${pending} still pending` : ""}.\n\n` +
                table(["Code", "Name", "Type", "From", "To", "Days", "Status"], list.map((l) => [l.code, l.name, l.type, l.from, l.to, l.days, l.status]));
        }
        case "get_pending_approvals": {
            const lv = r.pendingLeaveRequests as Obj[];
            const io = r.pendingInOutRequests as Obj[];
            if (!lv.length && !io.length) return "All clear - nothing is waiting for approval right now.";
            const parts: string[] = [`There ${lv.length + io.length === 1 ? "is" : "are"} **${lv.length + io.length}** request${lv.length + io.length === 1 ? "" : "s"} waiting for approval.`];
            if (lv.length) parts.push(`**Leave (${lv.length})**\n\n` + table(["Code", "Name", "Type", "From", "To"], lv.map((l) => [l.code, l.name, l.type, l.from, l.to])));
            if (io.length) parts.push(`**In/out (${io.length})**\n\n` + table(["Code", "Name", "Date", "In", "Out"], io.map((l) => [l.code, l.name, l.date, l.in, l.out])));
            return parts.join("\n\n");
        }
        case "get_holidays": {
            const list = r.holidays as Obj[];
            if (!list.length) return `No holidays have been added for ${r.year} yet.`;
            const next = list.find((h) => h.upcoming);
            const left = list.filter((h) => h.upcoming).length;
            const intro = next
                ? `The next holiday is **${next.name}** on **${niceDate(String(next.date))}**. ${left > 1 ? `${left} holidays are left in ${r.year}.` : "It's the last one this year."}`
                : `All ${plural(list.length, "holiday")} for ${r.year} have passed.`;
            return `${intro}\n\n` + table(["Date", "Holiday", "Type"], list.map((h) => [niceDate(String(h.date)), h.name, h.type]));
        }
        case "get_policy": {
            if (r.brief && r.found) {
                const intro = r.topic === "all" ? "Here are our policies in short:" : `Here's the **${r.topic}** policy in short:`;
                return `${intro}\n\n${briefPolicy(String(r.markdown), r.brief === 2 ? 0 : 2)}\n\nWant every rule? Just say **"full policy"**.`;
            }
            if (r.topic === "all") return `Here are the company and attendance policies:\n\n${String(r.markdown).replace(/^#+ (.*)$/gm, "**$1**")}`;
            if (r.found && r.titleMatch) return `Here's what the policy says:\n\n${r.markdown}`;
            if (r.found) {
                return `There is no separate **${r.topic}** policy yet. The closest rules are:\n\n${r.markdown}\n\nFor anything more, please check with HR.`;
            }
            const titles = (r.allTitles as string[]).join(", ");
            return `I couldn't find a policy about **${r.topic}**.\n\nPolicies we have: ${titles}.\n\nPlease check with HR for anything not listed.`;
        }
        case "get_help": {
            const topics = r.topics as Array<{ title: string; markdown: string }>;
            if (!topics.length) {
                return `I'm not sure which part of the portal you mean. I can explain: ${(r.allTopics as string[]).join(", ")}.`;
            }
            return topics.map((t) => t.markdown).join("\n\n");
        }
        default:
            return null;
    }
}

/** Drop empty fields so the AI has less to read. */
function compactJson(v: unknown): string {
    return JSON.stringify(v, (_k, val) => (val === null || val === undefined || val === false || val === "" ? undefined : val));
}

export type ToolRun = { json: string; display: string | null };

/** Run one tool call safely. `json` goes back to the AI; `display` (if any) can be shown to the user directly. */
export async function runTool(ctx: ChatContext, name: string, rawArgs: unknown): Promise<ToolRun> {
    const impl = IMPLS[name];
    if (!impl) return { json: JSON.stringify({ error: `Unknown tool ${name}` }), display: null };
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
        const result = (await impl(ctx, args)) as Obj;
        let json = compactJson(result);
        if (json.length > 12_000) json = json.slice(0, 12_000) + '..."(truncated)"';
        let display: string | null = null;
        try {
            display = displayFor(name, result);
        } catch (e) {
            console.error(`[chat] display for ${name} failed:`, e);
        }
        return { json, display };
    } catch (e) {
        console.error(`[chat] tool ${name} failed:`, e);
        return { json: JSON.stringify({ error: "Could not read that data right now." }), display: "Sorry, I couldn't read that data right now." };
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