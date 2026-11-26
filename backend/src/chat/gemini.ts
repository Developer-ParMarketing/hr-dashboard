/**
 * Google Gemini (free API key) - used ONLY to word answers that contain no personal data:
 * company policy text, portal how-to help, and small talk.
 * Attendance / leave / employee answers never go to Gemini.
 *
 * Env:
 *   GEMINI_API_KEY=...            (from aistudio.google.com; leave empty to switch Gemini off)
 *   GEMINI_MODEL=gemini-flash-latest   (optional; copy another model id from AI Studio if you want)
 *   GEMINI_TIMEOUT_MS=15000       (optional)
 */

export function geminiEnabled(): boolean {
    return Boolean(process.env.GEMINI_API_KEY?.trim());
}

function geminiModel(): string {
    return process.env.GEMINI_MODEL?.trim() || "gemini-flash-latest";
}

function geminiTimeout(): number {
    const n = Number(process.env.GEMINI_TIMEOUT_MS);
    return Number.isFinite(n) && n > 0 ? n : 15_000;
}

/** After a 429 (free limit used up) we stop calling Gemini for a while and use the normal answers. */
let pausedUntil = 0;

/**
 * Ask Gemini. Returns the text, or null on any problem (no key, timeout, limit, error) -
 * the caller then shows the normal built-in answer, so the chat never breaks because of Gemini.
 */
export async function geminiGenerate(system: string, prompt: string, maxTokens = 1024): Promise<string | null> {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key || Date.now() < pausedUntil) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), geminiTimeout());
    try {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel())}:generateContent`,
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
            console.warn("[chat] Gemini free limit reached - using built-in answers for 10 minutes");
            return null;
        }
        if (!res.ok) {
            console.error(`[chat] Gemini error ${res.status}: ${(await res.text()).slice(0, 300)}`);
            return null;
        }
        const data = (await res.json()) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
        };
        const text = (data.candidates?.[0]?.content?.parts ?? [])
            .filter((p) => !p.thought && typeof p.text === "string")
            .map((p) => p.text)
            .join("")
            .trim();
        return text || null;
    } catch (e) {
        console.error("[chat] Gemini request failed:", e instanceof Error ? e.message : e);
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Remove personal data before anything is sent to Google:
 * employee names and codes from the roster, emails and phone numbers.
 * `roster` lines look like "PMPL28 | Ganesh Sardar | Product".
 */
/** First names that are also normal words in questions ("late mark") - never masked on their own. */
const COMMON_WORDS = new Set([
    "mark", "will", "joy", "hope", "grace", "rose", "ray", "late", "leave", "half", "day", "shift", "team",
    "sales", "design", "product", "policy", "dev", "content", "ads", "seo",
]);

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