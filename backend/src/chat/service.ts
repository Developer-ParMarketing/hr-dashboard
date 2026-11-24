import { query } from "../db/index.js";
import type { AuthUser } from "../auth/users.js";
import { ollamaChat, ollamaModel, type OllamaMessage } from "./ollama.js";
import { TOOL_SPECS, buildChatContext, employeeRoster, runTool, type ChatContext } from "./tools.js";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ChatResult = {
    answer: string;
    toolsUsed: string[];
    durationMs: number;
};

const MAX_TOOL_ROUNDS = 5;
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

/**
 * Fixed instructions - identical for every question, so Ollama can reuse them
 * from its cache instead of re-reading them each time (much faster on CPU).
 */
const STATIC_SYSTEM = [
    "You are Par HR Assistant, the HR chatbot of Par Marketing Private Limited (a marketing agency; email domain parmarketing.agency).",
    "",
    "Rules:",
    "- Facts about attendance, punch times, late marks, leaves, holidays and policy MUST come from the tools. Call a tool for every such question, including follow-up questions. Never answer these from memory.",
    "- Employee names and codes MUST come from the EMPLOYEE LIST in the context message or from tool results. Never invent a person, a code, a surname, a job role or a time. If someone is not in the list, say so.",
    "- If several people match a name (for example two people called Ganesh), list them and ask which one.",
    "- If a tool returns an error (for example access denied), explain it politely in one sentence. Do not ask the user for their own code: use \"me\".",
    "- shiftStartsAt is the usual shift start time, not a joining date. Do not mention fields that are empty.",
    "- Convert relative dates (today, yesterday, this week = Monday to today, this month, last month) to YYYY-MM-DD using today's date from the context message.",
    "- Times are 24-hour HH:MM. Worked hours are H:MM. half_day = present but worked under 5 hours.",
    "- Reply in the user's language (English, Hindi or Hinglish). Be brief. Use a small table when listing several people or days.",
    "- Never show salary or passwords. Only help with HR, attendance, leave, holidays and company policy.",
].join("\n");

function contextMessage(ctx: ChatContext, roster: string, self: { code: string; name: string } | null): string {
    const d = new Date(`${ctx.today}T00:00:00Z`);
    const todayLabel = d.toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
    });
    const who = self
        ? `${self.name} (employee code ${self.code}, login ${ctx.user.email}, role ${ctx.user.role})`
        : `${ctx.user.name || ctx.user.email} (role ${ctx.user.role}, not linked to an employee record)`;
    const scope =
        ctx.mode === "full"
            ? "They are HR/admin and may see ALL employees."
            : ctx.mode === "team"
                ? "They are a manager and may only see their own team and themselves."
                : "They are an employee and may only see their OWN data. Politely refuse questions about other people.";
    const iso = (x: Date) => x.toISOString().slice(0, 10);
    const shift = (days: number) => {
        const x = new Date(d);
        x.setUTCDate(x.getUTCDate() + days);
        return x;
    };
    const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
    const weekStart = shift(-dow);
    const lastWeekStart = shift(-dow - 7);
    const lastWeekEnd = shift(-dow - 1);
    const monthStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const lastMonthStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
    const lastMonthEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
    return [
        `CONTEXT (background info, not a question) - Today is ${todayLabel} (${ctx.today}), India time.`,
        `Dates: yesterday=${iso(shift(-1))}; this week=${iso(weekStart)} to ${ctx.today}; last week=${iso(lastWeekStart)} to ${iso(lastWeekEnd)}; this month=${iso(monthStart)} to ${ctx.today} (month ${ctx.today.slice(0, 7)}); last month=${iso(lastMonthStart)} to ${iso(lastMonthEnd)} (month ${iso(lastMonthStart).slice(0, 7)}).`,
        `You are talking to ${who}. When they say me / my / I / mera, use "me" as the employee.`,
        scope,
        "",
        "EMPLOYEE LIST (code | name | team) - the only people that exist:",
        roster || "(none)",
    ].join("\n");
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
        // Order matters for speed: [fixed instructions + tool list] is the same for everyone, so Ollama
        // keeps it cached. The per-user context goes into the first user message, after that block.
        const messages: OllamaMessage[] = [
            { role: "system", content: STATIC_SYSTEM },
            { role: "user", content: contextMessage(ctx, roster, selfRow) },
            ...turns.map((t) => ({ role: t.role, content: t.content }) as OllamaMessage),
        ];

        let answer = "";
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
            const reply = await ollamaChat(messages, round < MAX_TOOL_ROUNDS ? TOOL_SPECS : undefined);
            const calls = reply.tool_calls ?? [];
            if (calls.length === 0) {
                answer = (reply.content ?? "").trim();
                break;
            }
            messages.push({ role: "assistant", content: reply.content ?? "", tool_calls: calls });
            const runs = [];
            for (const call of calls.slice(0, 3)) {
                const name = call.function?.name ?? "";
                toolsUsed.push(name);
                const run = await runTool(ctx, name, call.function?.arguments);
                runs.push(run);
                messages.push({ role: "tool", tool_name: name, content: run.json });
            }
            // Fast path: the data already answers the question as a ready-made table -> no second AI round.
            if (runs.length > 0 && runs.every((r) => r.display)) {
                answer = runs.map((r) => r.display).join("\n\n");
                break;
            }
        }
        // Safety net: the answer mentions an employee code that doesn't exist -> ask once more.
        const bad = answer ? unknownCodes(answer, roster) : [];
        if (bad.length > 0) {
            messages.push({ role: "assistant", content: answer });
            messages.push({
                role: "user",
                content: `Your answer mentioned ${bad.join(", ")}, which is not in the EMPLOYEE LIST. Answer my previous question again using only the employee list and tool results.`,
            });
            const retry = await ollamaChat(messages, TOOL_SPECS);
            if (retry.tool_calls?.length) {
                messages.push({ role: "assistant", content: retry.content ?? "", tool_calls: retry.tool_calls });
                for (const call of retry.tool_calls.slice(0, 4)) {
                    const name = call.function?.name ?? "";
                    toolsUsed.push(name);
                    messages.push({ role: "tool", tool_name: name, content: (await runTool(ctx, name, call.function?.arguments)).json });
                }
                answer = ((await ollamaChat(messages)).content ?? "").trim();
            } else {
                answer = (retry.content ?? "").trim();
            }
            if (unknownCodes(answer, roster).length > 0) {
                answer = "Sorry, I couldn't find a reliable answer for that. Please check the attendance pages.";
            }
        }
        if (!answer) answer = "Sorry, I couldn't work that out. Please try asking in a different way.";

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