import type { Request, Response } from "express";
import type { AuthedRequest } from "../auth/middleware.js";
import { chatEnabled, ollamaModel, ollamaReachable } from "./ollama.js";
import { runChat, type ChatTurn } from "./service.js";

/** Simple per-user limit: 30 questions per 10 minutes. */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 30;
const hits = new Map<number, number[]>();

function allow(userId: number): boolean {
    const now = Date.now();
    const list = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
    if (list.length >= MAX_PER_WINDOW) {
        hits.set(userId, list);
        return false;
    }
    list.push(now);
    hits.set(userId, list);
    return true;
}

/** One question at a time per user (the AI answers one by one anyway). */
const busy = new Set<number>();

export async function handleChatStatus(_req: Request, res: Response): Promise<void> {
    const enabled = chatEnabled();
    res.json({
        enabled,
        model: enabled ? ollamaModel() : null,
        reachable: enabled ? await ollamaReachable() : false,
    });
}

export async function handleChat(req: Request, res: Response): Promise<void> {
    const user = (req as AuthedRequest).authUser;
    if (!user) {
        res.status(401).json({ message: "Authentication required" });
        return;
    }
    if (!chatEnabled()) {
        res.status(503).json({ message: "The HR assistant is turned off on this server." });
        return;
    }
    const body = (req.body ?? {}) as { messages?: unknown };
    const messages = Array.isArray(body.messages) ? (body.messages as ChatTurn[]) : [];
    if (messages.length === 0) {
        res.status(400).json({ message: "Ask a question first." });
        return;
    }
    if (!allow(user.id)) {
        res.status(429).json({ message: "Too many questions. Please wait a few minutes." });
        return;
    }
    if (busy.has(user.id)) {
        res.status(429).json({ message: "Please wait for the previous answer." });
        return;
    }
    busy.add(user.id);
    try {
        const result = await runChat(user, messages);
        res.json(result);
    } catch (e) {
        const status =
            e && typeof e === "object" && "status" in e && typeof (e as { status: unknown }).status === "number"
                ? (e as { status: number }).status
                : 502;
        res.status(status).json({ message: e instanceof Error ? e.message : "The assistant could not answer." });
    } finally {
        busy.delete(user.id);
    }
}