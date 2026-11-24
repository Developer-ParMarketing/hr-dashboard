import { query } from "../db/index.js";
import type { AuthUser } from "../auth/users.js";
import { ollamaChat, ollamaModel, type OllamaMessage } from "./ollama.js";
import { TOOL_SPECS, buildChatContext, runTool, type ChatContext } from "./tools.js";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ChatResult = {
    answer: string;
    toolsUsed: string[];
    durationMs: number;
};

const MAX_TOOL_ROUNDS = 5;
const MAX_HISTORY = 10;
const MAX_MESSAGE_CHARS = 2000;

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

function systemPrompt(ctx: ChatContext): string {
    const scope =
        ctx.mode === "full"
            ? "This user is HR/admin and may see data for ALL employees."
            : ctx.mode === "team"
                ? "This user is a manager and may only see their own team and themselves. The tools already enforce this."
                : "This user is an employee and may only see their OWN data. The tools already enforce this. Politely refuse questions about other people.";
    const d = new Date(`${ctx.today}T00:00:00Z`);
    const todayLabel = d.toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
    });
    return [
        "You are Par HR Assistant, the helpful HR chatbot of Par Marketing.",
        `Today is ${todayLabel} (${ctx.today}). Time zone: India (IST).`,
        `You are talking to ${ctx.user.name || ctx.user.email} (role: ${ctx.user.role}). When they say "me", "my" or "I", pass "me" as the employee.`,
        scope,
        "",
        "Rules:",
        "- ALWAYS use the tools to get attendance, leave, employee, holiday and policy facts. Never guess or invent names, times or numbers.",
        "- If a tool returns an error or several candidates, tell the user and ask which one they mean.",
        "- Convert relative dates (today, yesterday, this week, last month) to YYYY-MM-DD yourself using today's date.",
        "- Times are 24-hour HH:MM. Worked hours are H:MM. 'half_day' means present but worked under 5 hours.",
        "- Answer briefly and clearly. Use a short list or a small table when listing several people or days.",
        "- Never show salary, passwords or anything not returned by the tools.",
        "- If the question is not about HR, attendance, leave, holidays or company policy, say you can only help with HR topics.",
    ].join("\n");
}

function cleanHistory(history: ChatTurn[]): ChatTurn[] {
    return history
        .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .map((m) => ({ role: m.role, content: m.content.trim().slice(0, MAX_MESSAGE_CHARS) }))
        .filter((m) => m.content.length > 0)
        .slice(-MAX_HISTORY);
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
        const messages: OllamaMessage[] = [
            { role: "system", content: systemPrompt(ctx) },
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
            for (const call of calls.slice(0, 4)) {
                const name = call.function?.name ?? "";
                toolsUsed.push(name);
                const result = await runTool(ctx, name, call.function?.arguments);
                messages.push({ role: "tool", tool_name: name, content: result });
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