import { query } from "../db/index.js";
import type { AuthUser } from "../auth/users.js";
import { ollamaChat, ollamaModel, type OllamaMessage } from "./ollama.js";
import { buildChatContext, employeeRoster, runTool, type ChatContext } from "./tools.js";
import { geminiEnabled, geminiGenerate, maskPersonalData, maskReversible, newMaskMap, unmask } from "./gemini.js";
import { policyText } from "./policies.js";
import { dateFromQuestion, type QuestionDate } from "./dates.js";

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
    "list_teams",
    "get_hr_contacts",
    "get_leave_balance",
    "get_today_overview",
    "get_help",
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
    "- list_teams: managers, list of managers, teams, who is in a team, team size. team = team or manager name (optional).",
    "- get_hr_contacts: who is HR, how many HR people, HR contact, admins of the portal.",
    "- get_leave_balance: leave balance, how many leaves left, kitni chhutti bachi (PL/SL/CL). employee optional (default me).",
    "- get_today_overview: today's attendance summary / status / how many came today (counts only).",
    "- get_help: HOW TO use this HR portal: apply leave, in/out request, reimbursement, where to see attendance/payslip/goal sheet/appraisal/holidays, offer or relieving letter, salary, add employee, reset password, what the chatbot can do.",
    "- none: greetings, thanks, 'what is my name', company name, or anything not about HR data.",
    "",
    "employee: a code (PMPL03), a name, or \"me\" when the user means themselves (I, my, me, mera, mujhe).",
    "For 'he/his/her/uska/iska', use the person from the previous messages (prefer their code).",
    "period: today, yesterday, this_week, last_week, this_month, last_month, or custom (then give from/to as YYYY-MM-DD).",
    "",
    "examples:",
    "who is late today -> {\"tool\":\"get_attendance_on_date\",\"period\":\"today\",\"filter\":\"late\"}",
    "who hasn't punched in -> {\"tool\":\"get_attendance_on_date\",\"period\":\"today\",\"filter\":\"not_punched_in\"}",
    "today punch in time of everyone / sabka punch in -> {\"tool\":\"get_attendance_on_date\",\"period\":\"today\",\"filter\":\"all\"}",
    "ganesh attendance this month -> {\"tool\":\"get_employee_attendance\",\"employee\":\"ganesh\",\"period\":\"this_month\"}",
    "his attendance last week (after talking about PMPL28) -> {\"tool\":\"get_employee_attendance\",\"employee\":\"PMPL28\",\"period\":\"last_week\"}",
    "how many late marks do I have -> {\"tool\":\"get_monthly_summary\",\"employee\":\"me\",\"period\":\"this_month\"}",
    "most late marks this month -> {\"tool\":\"get_monthly_summary\",\"period\":\"this_month\",\"sort_by\":\"late\"}",
    "how many ganesh are there -> {\"tool\":\"find_employees\",\"query\":\"ganesh\"}",
    "what is the posh policy -> {\"tool\":\"get_policy\",\"topic\":\"posh\"}",
    "list of managers -> {\"tool\":\"list_teams\"}",
    "who is in design team -> {\"tool\":\"list_teams\",\"team\":\"design\"}",
    "how many hr are there -> {\"tool\":\"get_hr_contacts\"}",
    "how many leaves do I have left -> {\"tool\":\"get_leave_balance\",\"employee\":\"me\"}",
    "my pending leave requests -> {\"tool\":\"get_leave_requests\",\"employee\":\"me\",\"status\":\"pending\"}",
    "aaj ka attendance status -> {\"tool\":\"get_today_overview\"}",
    "how do I apply for leave -> {\"tool\":\"get_help\"}",
    "leave kaise apply kare -> {\"tool\":\"get_help\"}",
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
function toolArgs(
    route: Record<string, unknown>,
    today: string,
    question = "",
    asked: QuestionDate | null = null,
): { name: string; args: Record<string, unknown> } {
    const name = String(route.tool);
    const r = dateRanges(today);
    const period = String(route.period ?? "");
    const custom = period === "custom" || (!period && (isIso(route.from) || isIso(route.to)));
    // A date written in the question ("on tuesday", "25 nov", "kal") always wins over the AI's guess.
    const askedDay = asked?.single ? asked.from : null;
    const range = (): [string, string] => {
        if (asked) return [asked.from, asked.to];
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
            // "kab kab late aya", "absent days", "WFH days" -> show only those days
            const only = /\b(late|lates|der|der se)\b/i.test(question)
                ? "late"
                : /\b(absent|absence|absences|nahi aya|nahi aaya|nahi aayi)\b/i.test(question)
                    ? "absent"
                    : /\b(wfh|work from home)\b/i.test(question)
                        ? "wfh"
                        : /\b(half day|half days|half-day)\b/i.test(question)
                            ? "half_day"
                            : /\b(leave|leaves|chhutti|chutti)\b/i.test(question)
                                ? "leave"
                                : undefined;
            return { name, args: { employee: str(route.employee) ?? "me", from, to, only } };
        }
        case "get_attendance_on_date": {
            const date = askedDay ?? (period === "yesterday" ? r.yesterday : custom && isIso(route.from) ? route.from : r.today);
            let filter = str(route.filter) ?? "all";
            // Safety: only list "not punched in" when the question actually says so.
            if (filter === "not_punched_in" && !/\b(not|n't|nahi|nahin|nhi|missing|without|abhi tak|absent|yet)\b|n't/i.test(question)) {
                filter = "all";
            }
            // "everyone / all / sab" means the full list, whatever filter the router picked
            if (/\b(all|everyone|everybody|sab|sabka|sabhi|full list)\b/i.test(question) && !/\b(late|absent|wfh|leave|half)\b/i.test(question) && !/\b(not|nahi|n't)\b|n't/i.test(question)) {
                filter = "all";
            }
            return { name, args: { date, filter } };
        }
        case "get_monthly_summary": {
            const [from] = range();
            return { name, args: { month: from.slice(0, 7), employee: str(route.employee), sort_by: str(route.sort_by) } };
        }
        case "find_employees":
            return { name, args: { query: str(route.query) ?? str(route.employee), team: str(route.team), about: str(route.about) } };
        case "get_leave_requests": {
            const [from, to] = period || (asked && !asked.single) ? range() : [undefined, undefined];
            const status = str(route.status);
            return { name, args: { employee: str(route.employee), from, to, status: status === "any" ? undefined : status } };
        }
        case "get_holidays":
            return { name, args: { year: str(route.year) } };
        case "get_policy":
            // Short answer by default (like a chat); the full policy only when asked ("full", "details", "poora").
            return {
                name,
                args: { topic: str(route.topic), brief: FULL_RE.test(question) ? 0 : SHORTEST_RE.test(question) ? 2 : 1 },
            };
        case "list_teams":
            return { name, args: { team: str(route.team) ?? str(route.query), question } };
        case "get_today_overview":
            return { name, args: { date: askedDay ?? (period === "yesterday" ? r.yesterday : r.today) } };
        case "get_leave_balance":
            return { name, args: { employee: str(route.employee) ?? "me", year: str(route.year) } };
        case "get_help":
            return { name, args: { question } };
        default:
            return { name, args: {} };
    }
}

/** "make it short", "summary", "in short", "chhota karo" */
const BRIEF_RE = /\b(short|shorter|summary|summarize|summarise|summery|summeries|summaries|summeiries|brief|briefly|chhota|chota|kam me|in short|tldr|quick)\b/i;

/** "one line", "even shorter", "aur chhota" */
const SHORTEST_RE = /\b(one line|1 line|ek line|shorter|very short|more short|aur chhota|aur chota|shortest|__shorter__)\b/i;

/** "full policy", "in detail", "all rules", "poora batao" */
const FULL_RE = /\b(full|fully|detail|details|detailed|complete|all rules|every rule|explain all|poora|pura|puri|poori|sab rules|sabhi rules)\b/i;

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

const GREETING_RE = /^(hi+|hello+|hey+|hii+|helo|namaste|namaskar|good (morning|afternoon|evening)|gm|yo)\b[\s!.,?]*(there|bro|buddy|ji|sir|ma'?am)?[\s!.,?]*((how are (u|you)|kaise ho|kya haal hai|how r u|wassup|what'?s up)[\s!.,?]*)?$/i;

function greeting(name: string): string {
    const first = name.trim().split(/\s+/)[0] ?? "";
    return [
        `Hi${first ? ` ${first}` : ""}! I'm doing great, thanks for asking 😊`,
        "",
        "I can help you with:",
        "- **Attendance** - \"my attendance this month\", \"who is late today\"",
        "- **Leaves & approvals** - \"pending approvals\", \"how do I apply leave\"",
        "- **Teams & people** - \"list of managers\", \"who is HR\"",
        "- **Policies & holidays** - \"leave policy\", \"next holiday\"",
        "",
        "What would you like to know?",
    ].join("\n");
}

/**
 * Router via Gemini (fast, ~1-2 s) - only the user's last questions are sent, with every name, code,
 * email and phone replaced by a token like [[P1]] that is swapped back here. Null = use the local AI.
 */
async function geminiRoute(turns: ChatTurn[], roster: string, today: string): Promise<Record<string, unknown> | null> {
    if (!geminiEnabled()) return null;
    const map = newMaskMap();
    const qs = turns.filter((t) => t.role === "user").slice(-3).map((t) => maskReversible(t.content, roster, map));
    const lastQ = qs.pop() ?? "";
    const weekday = new Date(`${today}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
    const system =
        ROUTER_SYSTEM +
        "\n\nPeople are hidden as tokens like [[P1]] - copy the token exactly into employee / query." +
        `\nToday is ${weekday} ${today}. For a named day or date use period custom with from (and to) as YYYY-MM-DD.`;
    const prompt =
        (qs.length ? `Earlier questions (oldest first):\n${qs.map((x) => `- ${x}`).join("\n")}\n\n` : "") +
        `LAST message: ${lastQ}\n\nJSON:`;
    const raw = await geminiGenerate(system, prompt, 200, { json: true, timeoutMs: 5000 });
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw.replace(/^```(json)?|```$/g, "").trim()) as Record<string, unknown>;
        if (typeof parsed.tool !== "string" || !(TOOL_NAMES as readonly string[]).includes(parsed.tool)) return null;
        for (const k of Object.keys(parsed)) {
            if (typeof parsed[k] === "string") parsed[k] = unmask(parsed[k] as string, map);
        }
        if (parsed.period && !(PERIODS as readonly string[]).includes(String(parsed.period))) delete parsed.period;
        return parsed;
    } catch {
        return null;
    }
}

/** Which single profile fact a question asks for, if any. */
function profileField(q: string): string | null {
    if (/\b(join|joined|joining|doj|since when|how long|tenure|experience|which year|kab (aya|aaya|aayi|ayi|join)|kab se|kitne saal|kitne time)\b/.test(q)) return "joining";
    if (/\b(left|leaving|relieved|resigned|resign|last day|dol)\b/.test(q)) return "leaving";
    if (/\b(e-?mail|mail id)\b/.test(q)) return "email";
    if (/\b(shift|timing|timings|office time|kitne baje)\b/.test(q)) return "shift";
    if (/\b(manager|boss|reporting|reports to|report to)\b/.test(q)) return "manager";
    if (/\b(designation|job title|title|role|position)\b/.test(q)) return "designation";
    if (/\b(employee code|emp code|code|employee id|emp id)\b/.test(q)) return "code";
    if (/\b(still working|active|status|working here)\b/.test(q)) return "status";
    if (/\b(which team|team|department)\b/.test(q)) return "team";
    return null;
}

/** The user's last few questions (no answers - they may hold data), masked for sending to Gemini. */
function recentQuestions(turns: ChatTurn[], roster: string): string {
    const qs = turns.filter((t) => t.role === "user").slice(-3).map((t) => maskPersonalData(t.content, roster));
    const lastQ = qs.pop() ?? "";
    return (qs.length ? `Earlier questions (oldest first):\n${qs.map((x) => `- ${x}`).join("\n")}\n\n` : "") + `Question: ${lastQ}`;
}

const POLICY_SYSTEM = [
    "You are Par HR Assistant, the friendly HR chatbot of Par Marketing Private Limited.",
    "Answer ONLY from the company text given below. Never invent rules, numbers, days, amounts or deadlines.",
    "If the text does not cover the question, say so in one sentence and suggest asking HR.",
    "Answer only what was asked - not every section. Talk like a helpful colleague in a chat, not like a document.",
    "Length: by default 2-5 short bullet points or 2-3 sentences.",
    "If the user asks for 'full', 'details' or 'all rules', cover every relevant rule.",
    "If the user asks for 'short', 'summary', 'one line' or 'shorter', give 1-2 sentences.",
    "Reply in the user's language (English, Hindi or Hinglish - match how they write).",
    "Format: plain text with **bold** and '- ' bullets only. No tables, no headings.",
].join("\n");

const HELP_SYSTEM = [
    "You are Par HR Assistant, the friendly HR chatbot of Par Marketing Private Limited's HR portal.",
    "Explain how to do things in the portal using ONLY the help text given below. Never invent menus, buttons or pages.",
    "If the help text does not cover it, say so and suggest asking HR or the admin.",
    "Give short numbered steps (max 6). Reply in the user's language (English, Hindi or Hinglish).",
    "Format: plain text with **bold** and numbered steps only. No tables, no headings.",
].join("\n");

/** Gemini wording for policy / help answers. Sends company text + the user's (masked) questions only. */
async function geminiAnswer(name: string, toolJson: string, turns: ChatTurn[], roster: string): Promise<string | null> {
    let source = "";
    if (name === "get_policy") {
        // The whole policy, so Gemini can pick the right part (it is company text, not personal data).
        source = String(await policyText());
    } else {
        try {
            const r = JSON.parse(toolJson) as { topics?: Array<{ markdown: string }> };
            source = (r.topics ?? []).map((t) => t.markdown).join("\n\n");
        } catch {
            source = "";
        }
        // HR's own policy pages can also answer "how" questions (ticket process, payslip, POSH complaint...).
        source = `${source}\n\n--- Company policies ---\n${String(await policyText())}`;
    }
    // Names, emails and phone numbers (e.g. POSH committee contacts) go out as tokens and come back real.
    const map = newMaskMap();
    const qs = turns.filter((t) => t.role === "user").slice(-3).map((t) => maskReversible(t.content, roster, map));
    const lastQ = qs.pop() ?? "";
    const prompt =
        `Company text:\n<<<\n${maskReversible(source.slice(0, 20_000), roster, map)}\n>>>\n\n` +
        (qs.length ? `Earlier questions (oldest first):\n${qs.map((x) => `- ${x}`).join("\n")}\n\n` : "") +
        `Question: ${lastQ}\n\nKeep tokens like [[P1]] exactly as written - they are names, emails or phone numbers.`;
    const ai = await geminiGenerate(name === "get_policy" ? POLICY_SYSTEM : HELP_SYSTEM, prompt, 1024);
    return ai ? unmask(ai, map) : null;
}

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
        const isGreeting = GREETING_RE.test(last.content.trim());
        const geminiRouted = isGreeting ? null : await geminiRoute(turns, roster, ctx.today);
        if (geminiRouted) {
            route = geminiRouted;
            toolsUsed.push("gemini-router");
        } else if (!isGreeting) {
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
        }

        // "make it short" / "summary" on its own -> answer the previous question again, briefly.
        let question = last.content;
        if ((BRIEF_RE.test(last.content) || FULL_RE.test(last.content)) && last.content.split(/\s+/).length <= 8) {
            const prevUser = [...turns].reverse().find((t, i) => i > 0 && t.role === "user");
            let rerouted = false;
            if (prevUser && (route.tool === "none" || route.tool === "get_help")) {
                rerouted = true;
                try {
                    const again = await ollamaChat(
                        [{ role: "system", content: ROUTER_SYSTEM }, { role: "user", content: context }, { role: "user", content: prevUser.content }],
                        undefined,
                        ROUTER_SCHEMA,
                        120,
                    );
                    const parsed = JSON.parse(again.content || "{}") as Record<string, unknown>;
                    if (typeof parsed.tool === "string" && (TOOL_NAMES as readonly string[]).includes(parsed.tool)) route = parsed;
                } catch {
                    /* keep the first route */
                }
            }
            if (rerouted || route.tool === "get_policy") question = `${prevUser?.content ?? ""} ${last.content}`;
            const prevAnswer = [...turns].reverse().find((t) => t.role === "assistant")?.content ?? "";
            if (BRIEF_RE.test(last.content) && /in short:/i.test(prevAnswer)) question += " __shorter__";
        }

        // Safety overrides for common slips of the small model.
        const q = last.content.toLowerCase();
        if (/\bmanagers?\b|\bteams?\b|\breporting\b/.test(q) && (route.tool === "find_employees" || route.tool === "none")) {
            const named = typeof route.query === "string" && route.query && !/manager|team/i.test(route.query);
            if (!named) route = { tool: "list_teams", team: route.team };
        }
        // "all managers", "how many managers", "in parmarketing": the whole company, not a team from earlier.
        if (route.tool === "list_teams" && /\b(all|sab|saare|sare|every|how many|how manay|kitne|not only|company|parmarketing|par marketing|whole|entire|total|managers|list of|teams)\b/.test(q)) {
            route = { tool: "list_teams" };
        }
        // Questions about yourself: "who is my manager", "about me", "my team", "my designation".
        // ("show me Ganesh's profile" is about Ganesh, so a bare "me" doesn't count.)
        const aboutSelf = /\b(my|mera|meri|mere|mujhe|who am i|apna|apni|myself|about me|for me)\b/.test(q);
        const aboutData = /\b(attendance|late|absent|leaves?|wfh|punch|hours|salary|balance|holidays?|polic(y|ies)|approvals?|requests?|chhutti|chutti)\b/.test(q);
        if (aboutSelf && !aboutData) {
            if (/\b(manager|manahger|maneger|boss|reporting|report to|reports to|lead|senior)\b/.test(q)) {
                route = { tool: "find_employees", query: "me", about: "manager" };
            } else if (/\b(designation|job title|title|role|position|post)\b/.test(q)) {
                route = { tool: "find_employees", query: "me", about: "designation" };
            } else if (/\bteam\b/.test(q)) {
                route = { tool: "list_teams", team: "my" };
            } else if (/\b(about me|who am i|profile|details?|info|information|joining|joined|shift|email|code|myself)\b/.test(q)) {
                route = { tool: "find_employees", query: "me", about: "profile" };
            }
        }
        // One fact about a person ("when did she join", "which year", "his email"): answer only that.
        // A short follow-up like "which year" takes its meaning from the previous question.
        if (route.tool === "find_employees" && !route.about) {
            const prevQ = [...turns].reverse().filter((t) => t.role === "user")[1]?.content ?? "";
            const field = profileField(q) ?? (q.split(/\s+/).length <= 5 ? profileField(prevQ.toLowerCase()) : null);
            if (field) route = { ...route, about: field };
        }
        if (/\b(hr|human resources?|admins?)\b/.test(q) && /\b(who|how many|kitne|kitni|kaun|list|contact|people|persons?|team|about)\b/.test(q) && !/\bpolic(y|ies)\b/.test(q)) {
            route = { tool: "get_hr_contacts" };
        }
        if (/\b(balance|leaves? (left|remaining|baki|bachi|bache)|kitni (leave|chhutti|chutti)|remaining leaves?)\b/.test(q) && !/\bpolic(y|ies)\b/.test(q)) {
            route = { ...route, tool: "get_leave_balance" };
        }
        // "my attendance", "mera attendance": the router sometimes drops the person - it's the user.
        if (
            ["get_employee_attendance", "get_leave_requests", "get_leave_balance"].includes(String(route.tool)) &&
            (!route.employee || /^(mine|meri|mera|mere|mujhe|apna|apni)$/i.test(String(route.employee))) &&
            /\b(my|me|mine|i|mera|meri|mere|mujhe|main|apna|apni)\b/.test(q)
        ) {
            route = { ...route, employee: "me" };
        }
        if (/\b(how (do|can|to)|kaise|where (is|can|do)|kahan|steps?)\b/.test(q) && route.tool === "none") {
            route = { tool: "get_help" };
        }

        let answer = "";
        if (route.tool !== "none") {
            // 2) Real data, shown as a ready-made table.
            const { name, args } = toolArgs(route, ctx.today, question, dateFromQuestion(last.content, ctx.today));
            toolsUsed.push(name);
            const run = await runTool(ctx, name, args);
            answer = run.display ?? NOT_SURE;
            // Policy / how-to answers: let Gemini word them like a chat (no personal data is sent).
            if ((name === "get_policy" || name === "get_help") && geminiEnabled()) {
                const ai = await geminiAnswer(name, run.json, turns, roster);
                if (ai && unknownCodes(ai, roster).length === 0 && !/\n\s*\|.*\|/.test(ai)) {
                    answer = ai;
                    toolsUsed.push("gemini");
                }
            }
        } else if (isGreeting) {
            // 3a) Plain greeting - instant, no AI needed.
            answer = greeting(selfRow?.name ?? user.name ?? "");
        }
        if (!answer && geminiEnabled()) {
            // 3b) Small talk via Gemini - only the user's questions are sent, with names/codes/emails masked.
            const ai = await geminiGenerate(CHAT_SYSTEM, recentQuestions(turns, roster), 400);
            if (ai && !looksLikeInventedData(ai) && unknownCodes(ai, roster).length === 0) {
                answer = ai;
                toolsUsed.push("gemini");
            }
        }
        if (!answer) {
            // 3c) Small talk with the local AI (also the fallback when Gemini is off or fails).
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