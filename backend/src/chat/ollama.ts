/**
 * Minimal client for a local Ollama server (free, runs on our own machine).
 * Env:
 *   CHAT_ENABLED=true
 *   OLLAMA_URL=http://127.0.0.1:11434
 *   OLLAMA_MODEL=qwen2.5:7b
 *   CHAT_TIMEOUT_MS=120000
 */

export type OllamaToolCall = {
    function: { name: string; arguments: Record<string, unknown> | string };
};

export type OllamaMessage = {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    tool_calls?: OllamaToolCall[];
    /** Name of the tool this message answers (role "tool"). */
    tool_name?: string;
};

export type OllamaToolSpec = {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: {
            type: "object";
            properties: Record<string, { type: string; description?: string; enum?: string[] }>;
            required?: string[];
        };
    };
};

export function chatEnabled(): boolean {
    return /^(1|true|yes|on)$/i.test(String(process.env.CHAT_ENABLED ?? "").trim());
}

export function ollamaUrl(): string {
    return (process.env.OLLAMA_URL?.trim() || "http://127.0.0.1:11434").replace(/\/+$/, "");
}

export function ollamaModel(): string {
    return process.env.OLLAMA_MODEL?.trim() || "qwen2.5:7b";
}

function timeoutMs(): number {
    const n = Number(process.env.CHAT_TIMEOUT_MS);
    return Number.isFinite(n) && n > 0 ? n : 120_000;
}

/** One chat round. Returns the assistant message (may contain tool_calls). */
export async function ollamaChat(messages: OllamaMessage[], tools?: OllamaToolSpec[]): Promise<OllamaMessage> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs());
    try {
        const res = await fetch(`${ollamaUrl()}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
                model: ollamaModel(),
                stream: false,
                messages,
                tools: tools && tools.length ? tools : undefined,
                options: { temperature: 0.2, num_ctx: 8192 },
            }),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(`AI server error ${res.status}: ${text.slice(0, 200)}`);
        }
        const data = (await res.json()) as { message?: OllamaMessage };
        if (!data.message) throw new Error("AI server returned no message");
        return data.message;
    } catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
            throw new Error("The AI took too long to answer. Please try again.");
        }
        if (e instanceof TypeError) {
            throw new Error("The AI server is not reachable. Is Ollama running on the server?");
        }
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

/** Quick health check for the status endpoint. */
export async function ollamaReachable(): Promise<boolean> {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`${ollamaUrl()}/api/tags`, { signal: controller.signal });
        clearTimeout(timer);
        return res.ok;
    } catch {
        return false;
    }
}