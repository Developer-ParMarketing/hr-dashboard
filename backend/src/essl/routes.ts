import type express from "express";
import { actorFromRequest, type AuthedRequest } from "../auth/middleware.js";
import { calendarTodayIso } from "../employees/employmentStatus.js";
import { esslConfig } from "./client.js";
import { esslAutoSyncEnabled, esslSyncIntervalMinutes } from "./schedule.js";
import { esslSyncRunning, lastEsslSyncResult, syncEsslMonth } from "./sync.js";

/** GET /api/attendance/essl/status */
export function handleEsslStatus(_req: express.Request, res: express.Response) {
    const cfg = esslConfig();
    res.json({
        configured: Boolean(cfg),
        autoSync: esslAutoSyncEnabled() && Boolean(cfg),
        intervalMinutes: esslSyncIntervalMinutes(),
        devices: cfg?.serialNumbers.length ?? 0,
        running: esslSyncRunning(),
        last: lastEsslSyncResult(),
    });
}

/** POST /api/attendance/essl/sync  { year?, month? } — defaults to the current month. */
export async function handleEsslSync(req: express.Request, res: express.Response) {
    if (!esslConfig()) {
        res.status(400).json({
            error:
                "Biometric machine is not configured. Set ESSL_API_URL, ESSL_SERIAL_NUMBERS, ESSL_USERNAME and ESSL_PASSWORD in backend/.env",
        });
        return;
    }
    const today = calendarTodayIso();
    const body = (req.body ?? {}) as { year?: unknown; month?: unknown };
    let year = Number.parseInt(String(body.year ?? ""), 10);
    let month = Number.parseInt(String(body.month ?? ""), 10);
    if (!Number.isFinite(year) || year < 2000 || year > 2100) year = Number.parseInt(today.slice(0, 4), 10);
    if (!Number.isFinite(month) || month < 1 || month > 12) month = Number.parseInt(today.slice(5, 7), 10);

    const result = await syncEsslMonth({
        year,
        month,
        actor: actorFromRequest(req as AuthedRequest),
        trigger: "manual",
    });
    res.json(result);
}