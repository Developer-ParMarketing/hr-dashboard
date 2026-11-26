/**
 * Google Gemini (free API key) - used ONLY to word answers that contain no personal data:
 * company policy text, portal how-to help, and small talk.
 * Attendance / leave / employee answers never go to Gemini.
 *
 * Env:
 *   GEMINI_API_KEY=...       (from aistudio.google.com; leave empty to switch Gemini off)
 *   GEMINI_MODEL=gemini-flash-lite-latest,gemini-flash-latest
 *                            (optional; comma list - tried in order, next one if busy/slow)
 *   GEMINI_TIMEOUT_MS=8000   (optional; per model attempt)
 */

export function geminiEnabled(): boolean {
    return Boolean(process.env.GEMINI_API_KEY?.trim());
}

function geminiModels(): string[] {
    const list = (process.env.GEMINI_MODEL ?? "")
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean);
    return list.length ? list : ["gemini-flash-lite-latest", "gemini-flash-latest"];
}

function geminiTimeout(): number {
    const n = Number(process.env.GEMINI_TIMEOUT_MS);
    return Number.isFinite(n) && n > 0 ? n : 8_000;
}

/** After a 429 (free limit used up) we stop calling Gemini for a while and use the normal answers. */
let pausedUntil = 0;

type Attempt = { text: string | null; retry: boolean };

async function callModel(model: string, key: string, system: string, prompt: string, maxTokens: number): Promise<Attempt> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), geminiTimeout());
    const started = Date.now();
    try {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
            {
                method: "POST",
                headers: { "content-type": "application/json", "x-goog-api-key": key },
                body: JSON.stringify({
                    systemInstruction: { parts: [{ text: system }] },
                    contents: [{ role: "user", parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens },
                }),
                signal: controller.signal,
            },
        );
        if (res.status === 429) {
            pausedUntil = Date.now() + 10 * 60_000;
            console.warn(`[chat] Gemini ${model}: free limit reached - built-in answers for 10 minutes`);
            return { text: null, retry: false };
        }
        if (!res.ok) {
            const body = (await res.text()).replace(/\s+/g, " ").slice(0, 200);
            console.error(`[chat] Gemini ${model} error ${res.status}: ${body}`);
            // 503 overloaded / 500 / 404 unknown model -> try the next model
            return { text: null, retry: res.status >= 500 || res.status === 404 };
        }
        const data = (await res.json()) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
        };
        const text = (data.candidates?.[0]?.content?.parts ?? [])
            .filter((p) => !p.thought && typeof p.text === "string")
            .map((p) => p.text)
            .join("")
            .trim();
        console.log(`[chat] Gemini ${model} answered in ${Date.now() - started} ms`);
        return { text: text || null, retry: !text };
    } catch (e) {
        const aborted = e instanceof Error && e.name === "AbortError";
        console.error(`[chat] Gemini ${model} ${aborted ? `timed out after ${geminiTimeout()} ms` : `failed: ${e instanceof Error ? e.message : e}`}`);
        return { text: null, retry: true };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Ask Gemini. Tries each model in GEMINI_MODEL in order (next one when busy / slow / unknown).
 * Returns the text, or null on any problem - the caller then shows the normal built-in answer,
 * so the chat never breaks because of Gemini.
 */
export async function geminiGenerate(system: string, prompt: string, maxTokens = 1024): Promise<string | null> {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key || Date.now() < pausedUntil) return null;
    for (const model of geminiModels()) {
        const { text, retry } = await callModel(model, key, system, prompt, maxTokens);
        if (text) return text;
        if (!retry) return null;
    }
    return null;
}

/** First names that are also normal words in questions ("late mark") - never masked on their own. */
const COMMON_WORDS = new Set([
    "mark", "will", "joy", "hope", "grace", "rose", "ray", "late", "leave", "half", "day", "shift", "team",
    "sales", "design", "product", "policy", "dev", "content", "ads", "seo",
]);

/**
 * Remove personal data before anything is sent to Google:
 * employee names and codes from the roster, emails and phone numbers.
 * `roster` lines look like "PMPL28 | Ganesh Sardar | Product".
 */
export function maskPersonalData(text: string, roster: string): string {
    let out = text
        .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
        .replace(/\+?\d[\d\s-]{8,}\d/g, (m) => (m.replace(/\D/g, "").length >= 10 ? "[phone]" : m));
    const words = new Set<string>();
    for (const line of roster.split("\n")) {
        const [code, name] = line.split("|").map((s) => s?.trim() ?? "");
        if (code) words.add(code);
        if (name) {
            words.add(name);
            for (const part of name.split(/\s+/)) {
                if (part.length >= 3 && !COMMON_WORDS.has(part.toLowerCase())) words.add(part);
            }
        }
    }
    // Longest first so "Ganesh Sardar" is replaced before "Ganesh".
    for (const w of [...words].sort((a, b) => b.length - a.length)) {
        const safe = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        out = out.replace(new RegExp(`\\b${safe}\\b`, "gi"), "a colleague");
    }
    return out;
}