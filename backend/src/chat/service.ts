import { query } from "../db/index.js";
import type { AuthUser } from "../auth/users.js";
import { ollamaChat, ollamaModel, type OllamaMessage } from "./ollama.js";
import { buildChatContext, employeeRoster, runTool, type ChatContext } from "./tools.js";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ChatResult = {
    answer: string;
    toolsUsed: string[];
    durationMs: number;
};

const MAX_HISTORY = 6;
const MAX_MESSAGE_CHARS = 1000;
/** Old answers are cut short in the history: tables cost a lot to re-read on CPU. */
const MAX_OLD_ANSWER_CHARS = 300;

let logTableReady: Promise<void> | null = null;

/** Audit table: who asked what and when (created on first use). */
function ensureLogTable(): Promise<void> {
    logTableReady ??= query(
        `CREATE TABLE IF NOT EXISTS chat_logs (
       id SERIAL PRIMARY KEY,
       user_id INTEGER,
       user_email TEXT,
       question TEXT NOT NULL,
       answer TEXT,
       tools_used JSONB NOT NULL DEFAULT '[]'::jsonb,
       duration_ms INTEGER,
       error TEXT,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     );
     CREATE INDEX IF NOT EXISTS idx_chat_logs_created ON chat_logs (created_at DESC);`,
    )
        .then(() => undefined)
        .catch((e) => {
            logTableReady = null;
            throw e;
        });
    return logTableReady;
}

async function logChat(row: {
    user: AuthUser;
    question: string;
    answer: string | null;
    toolsUsed: string[];
    durationMs: number;
    error: string | null;
}): Promise<void> {
    try {
        await ensureLogTable();
        await query(
            `INSERT INTO chat_logs (user_id, user_email, question, answer, tools_used, duration_ms, error)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
            [
                row.user.id,
                row.user.email,
                row.question.slice(0, 4000),
                row.answer?.slice(0, 8000) ?? null,
                JSON.stringify(row.toolsUsed),
                row.durationMs,
                row.error,
            ],
        );
    } catch (e) {
        console.error("[chat] could not write chat log:", e);
    }
}

/* ------------------------------------------------------------------------------------------
 * How a question is answered (accuracy first):
 *  1. ROUTER: the AI must reply with JSON naming ONE lookup (forced by Ollama "format").
 *     It never writes attendance numbers itself.
 *  2. The backend runs that lookup and shows the real data as a ready-made table.
 *  3. Only small talk ("hi", "what is my name") gets a free-text AI reply - and that reply
 *     is blocked if it contains times or tables (= made-up data).
 * ------------------------------------------------------------------------------------------ */

const TOOL_NAMES = [
    "get_employee_attendance",
    "get_attendance_on_date",
    "get_monthly_summary",
    "find_employees",
    "get_leave_requests",
    "get_pending_approvals",
    "get_holidays",
    "get_policy",
    "none",
] as const;

const PERIODS = ["today", "yesterday", "this_week", "last_week", "this_month", "last_month", "custom"] as const;

const ROUTER_SCHEMA: Record<string, unknown> = {
    type: "object",
    properties: {
        tool: { type: "string", enum: [...TOOL_NAMES] },
        employee: { type: "string" },
        period: { type: "string", enum: [...PERIODS] },
        from: { type: "string" },
        to: { type: "string" },
        filter: {
            type: "string",
            enum: ["all", "present", "absent", "late", "wfh", "leave", "half_day", "not_punched_in"],
        },
        sort_by: { type: "string", enum: ["late", "absent", "present", "hours_low", "hours_high", "wfh", "leave"] },
        query: { type: "string" },
        team: { type: "string" },
        topic: { type: "string" },
        status: { type: "string", enum: ["pending", "approved", "rejected", "any"] },
        year: { type: "string" },
    },
    required: ["tool"],
};

/** Fixed router instructions - identical for everyone, so Ollama keeps them cached. */
const ROUTER_SYSTEM = [
    "You are the router of an HR chatbot for Par Marketing. Read the conversation and pick ONE lookup for the LAST user message.",
    "Reply ONLY with JSON. Never answer the question yourself.",
    "",
    "tools:",
    "- get_employee_attendance: one person's days (punch in/out, hours, late). needs employee + period.",
    "- get_attendance_on_date: everyone on one day. period today/yesterday (or custom with from=YYYY-MM-DD) + filter (late, absent, not_punched_in, wfh, leave, half_day, present, all).",
    "- get_monthly_summary: month totals. With employee = that person's late marks/absent/present count. Without employee = ranking, use sort_by. period this_month/last_month.",
    "- find_employees: who is someone, how many people named X, team members, someone's manager. query = name/code, team = team name.",
    "- get_leave_requests: leaves (employee optional, status).",
    "- get_pending_approvals: requests waiting for approval.",
    "- get_holidays: holidays (year optional).",
    "- get_policy: any policy / rule question. topic = short keyword (late, leave, wfh, half day, posh, laptop, conduct...).",
    "- none: greetings, thanks, 'what is my name', company name, or anything not about HR data.",
    "",
    "employee: a code (PMPL03), a name, or \"me\" when the user means themselves (I, my, me, mera, mujhe).",
    "For 'he/his/her/uska/iska', use the person from the previous messages (prefer their code).",
    "period: today, yesterday, this_week, last_week, this_month, last_month, or custom (then give from/to as YYYY-MM-DD).",
    "",
    "examples:",
    "who is late today -> {\"tool\":\"get_attendance_on_date\",\"period\":\"today\",\"filter\":\"late\"}",
    "who hasn't punched in -> {\"tool\":\"get_attendance_on_date\",\"period\":\"today\",\"filter\":\"not_punched_in\"}",
    "ganesh attendance this month -> {\"tool\":\"get_employee_attendance\",\"employee\":\"ganesh\",\"period\":\"this_month\"}",
    "his attendance last week (after talking about PMPL28) -> {\"tool\":\"get_employee_attendance\",\"employee\":\"PMPL28\",\"period\":\"last_week\"}",
    "how many late marks do I have -> {\"tool\":\"get_monthly_summary\",\"employee\":\"me\",\"period\":\"this_month\"}",
    "most late marks this month -> {\"tool\":\"get_monthly_summary\",\"period\":\"this_month\",\"sort_by\":\"late\"}",
    "how many ganesh are there -> {\"tool\":\"find_employees\",\"query\":\"ganesh\"}",
    "what is the posh policy -> {\"tool\":\"get_policy\",\"topic\":\"posh\"}",
    "hi -> {\"tool\":\"none\"}",
].join("\n");

/** Fixed instructions for small talk (no data). */
const CHAT_SYSTEM = [
    "You are Par HR Assistant, the friendly HR chatbot of Par Marketing Private Limited (a marketing agency; email domain parmarketing.agency).",
    "This reply is small talk only. You have NO attendance, leave or policy data in this step.",
    "Never write punch times, hours, dates, counts, tables or policy rules. Never invent people.",
    "If the user wants data, ask them to name the person and period, e.g. 'Ganesh Sardar attendance this month'.",
    "You can say what you can help with: attendance, punch times, late marks, leaves, holidays, company policy.",
    "Reply in the user's language (English, Hindi or Hinglish), in 1-3 short sentences.",
].join("\n");

type Ranges = {
    today: string;
    yesterday: string;
    weekStart: string;
    lastWeekStart: string;
    lastWeekEnd: string;
    monthStart: string;
    lastMonthStart: string;
    lastMonthEnd: string;
};

function dateRanges(today: string): Ranges {
    const d = new Date(`${today}T00:00:00Z`);
    const iso = (x: Date) => x.toISOString().slice(0, 10);
    const shift = (days: number) => {
        const x = new Date(d);
        x.setUTCDate(x.getUTCDate() + days);
        return iso(x);
    };
    const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
    return {
        today,
        yesterday: shift(-1),
        weekStart: shift(-dow),
        lastWeekStart: shift(-dow - 7),
        lastWeekEnd: shift(-dow - 1),
        monthStart: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))),
        lastMonthStart: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))),
        lastMonthEnd: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0))),
    };
}

function contextMessage(ctx: ChatContext, roster: string, self: { code: string; name: string } | null): string {
    const todayLabel = new Date(`${ctx.today}T00:00:00Z`).toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
    });
    const who = self
        ? `${self.name} (employee code ${self.code}, role ${ctx.user.role})`
        : `${ctx.user.name || ctx.user.email} (role ${ctx.user.role}, not linked to an employee record)`;
    return [
        `CONTEXT (background info, not a question) - Today is ${todayLabel} (${ctx.today}).`,
        `The user is ${who}.`,
        "EMPLOYEE LIST (code | name | team):",
        roster || "(none)",
    ].join("\n");
}

const isIso = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Turn the router's JSON into real tool arguments (dates are worked out here, not by the AI). */
function toolArgs(route: Record<string, unknown>, today: string): { name: string; args: Record<string, unknown> } {
    const name = String(route.tool);
    const r = dateRanges(today);
    const period = String(route.period ?? "");
    const custom = period === "custom" || (!period && (isIso(route.from) || isIso(route.to)));
    const range = (): [string, string] => {
        switch (period) {
            case "today":
                return [r.today, r.today];
            case "yesterday":
                return [r.yesterday, r.yesterday];
            case "this_week":
                return [r.weekStart, r.today];
            case "last_week":
                return [r.lastWeekStart, r.lastWeekEnd];
            case "last_month":
                return [r.lastMonthStart, r.lastMonthEnd];
            default:
                if (custom && isIso(route.from)) return [route.from, isIso(route.to) ? route.to : route.from];
                return [r.monthStart, r.today]; // this_month / not given
        }
    };
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
    switch (name) {
        case "get_employee_attendance": {
            const [from, to] = range();
            return { name, args: { employee: str(route.employee) ?? "me", from, to } };
        }
        case "get_attendance_on_date": {
            const date = period === "yesterday" ? r.yesterday : custom && isIso(route.from) ? route.from : r.today;
            return { name, args: { date, filter: str(route.filter) ?? "all" } };
        }
        case "get_monthly_summary": {
            const [from] = range();
            return { name, args: { month: from.slice(0, 7), employee: str(route.employee), sort_by: str(route.sort_by) } };
        }
        case "find_employees":
            return { name, args: { query: str(route.query) ?? str(route.employee), team: str(route.team) } };
        case "get_leave_requests": {
            const [from, to] = period ? range() : [undefined, undefined];
            const status = str(route.status);
            return { name, args: { employee: str(route.employee), from, to, status: status === "any" ? undefined : status } };
        }
        case "get_holidays":
            return { name, args: { year: str(route.year) } };
        case "get_policy":
            return { name, args: { topic: str(route.topic) } };
        default:
            return { name, args: {} };
    }
}

/** A small-talk reply that contains times or a table is made-up data - never show it. */
function looksLikeInventedData(text: string): boolean {
    const times = text.match(/\b\d{1,2}:\d{2}\b/g) ?? [];
    return times.length >= 2 || /\n\s*\|.*\|/.test(text);
}

/** Employee codes mentioned in an answer that are not real (sign of a made-up answer). */
function unknownCodes(answer: string, roster: string): string[] {
    const known = new Set(roster.split("\n").map((l) => l.split("|")[0]!.trim().toUpperCase()));
    const found = answer.toUpperCase().match(/\b[A-Z]{2,5}\d{2,4}\b/g) ?? [];
    return [...new Set(found)].filter((c) => !known.has(c));
}

function cleanHistory(history: ChatTurn[]): ChatTurn[] {
    return history
        .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .map((m) => ({ role: m.role, content: m.content.trim().slice(0, MAX_MESSAGE_CHARS) }))
        .filter((m) => m.content.length > 0)
        .slice(-MAX_HISTORY)
        .map((m) =>
            m.role === "assistant" && m.content.length > MAX_OLD_ANSWER_CHARS
                ? { ...m, content: m.content.slice(0, MAX_OLD_ANSWER_CHARS) + " ..." }
                : m,
        );
}

const NOT_SURE =
    "Sorry, I couldn't understand that. Try for example: \"Ganesh Sardar attendance this month\", \"who is late today\" or \"late mark policy\".";

/** Ask the assistant. `history` is the conversation so far; the last item must be the user's question. */
export async function runChat(user: AuthUser, history: ChatTurn[]): Promise<ChatResult> {
    const started = Date.now();
    const turns = cleanHistory(history);
    const last = turns[turns.length - 1];
    if (!last || last.role !== "user") {
        throw Object.assign(new Error("Ask a question first."), { status: 400 });
    }
    const toolsUsed: string[] = [];
    try {
        const ctx = await buildChatContext(user);
        const roster = await employeeRoster(ctx);
        const selfRow =
            ctx.selfEmployeeId != null
                ? (
                    await query<{ code: string; name: string }>(
                        `SELECT employee_code AS code, name FROM employees WHERE id = $1`,
                        [ctx.selfEmployeeId],
                    )
                )[0] ?? null
                : null;
        const context = contextMessage(ctx, roster, selfRow);
        const convo = turns.map((t) => ({ role: t.role, content: t.content }) as OllamaMessage);

        // 1) Router: forced JSON, short reply (~30 tokens).
        let route: Record<string, unknown> = { tool: "none" };
        try {
            const routed = await ollamaChat(
                [{ role: "system", content: ROUTER_SYSTEM }, { role: "user", content: context }, ...convo],
                undefined,
                ROUTER_SCHEMA,
                120,
            );
            const parsed = JSON.parse(routed.content || "{}") as Record<string, unknown>;
            if (typeof parsed.tool === "string" && (TOOL_NAMES as readonly string[]).includes(parsed.tool)) route = parsed;
        } catch (e) {
            console.error("[chat] router reply was not valid JSON:", e);
        }

        let answer = "";
        if (route.tool !== "none") {
            // 2) Real data, shown as a ready-made table.
            const { name, args } = toolArgs(route, ctx.today);
            toolsUsed.push(name);
            const run = await runTool(ctx, name, args);
            answer = run.display ?? NOT_SURE;
        } else {
            // 3) Small talk only.
            const reply = await ollamaChat(
                [{ role: "system", content: CHAT_SYSTEM }, { role: "user", content: context }, ...convo],
                undefined,
                undefined,
                160,
            );
            answer = (reply.content ?? "").trim();
            if (!answer || looksLikeInventedData(answer) || unknownCodes(answer, roster).length > 0) answer = NOT_SURE;
        }

        const durationMs = Date.now() - started;
        void logChat({ user, question: last.content, answer, toolsUsed, durationMs, error: null });
        return { answer, toolsUsed, durationMs };
    } catch (e) {
        const durationMs = Date.now() - started;
        const message = e instanceof Error ? e.message : "Chat failed";
        void logChat({ user, question: last.content, answer: null, toolsUsed, durationMs, error: message });
        throw e;
    }
}

export function chatModelName(): string {
    return ollamaModel();
}