// Auto-sync punches from the eSSL biometric server every ESSL_SYNC_INTERVAL_MINUTES.
// Syncs the current month; during the first ESSL_PREVIOUS_MONTH_DAYS days it also re-syncs last month
// so late punches / corrections on the machine for the final days still land.

import { calendarTodayIso } from "../employees/employmentStatus.js";
import { esslConfig } from "./client.js";
import { syncEsslMonth } from "./sync.js";

let timer: ReturnType<typeof setInterval> | null = null;

export function esslAutoSyncEnabled(): boolean {
    const flag = (process.env.ESSL_SYNC_ENABLED ?? "false").trim().toLowerCase();
    return flag === "true" || flag === "1" || flag === "yes" || flag === "on";
}

export function esslSyncIntervalMinutes(): number {
    const n = Number.parseInt(process.env.ESSL_SYNC_INTERVAL_MINUTES ?? "15", 10);
    return Number.isFinite(n) && n >= 1 ? n : 15;
}

async function tick() {
    const today = calendarTodayIso();
    const year = Number.parseInt(today.slice(0, 4), 10);
    const month = Number.parseInt(today.slice(5, 7), 10);
    const day = Number.parseInt(today.slice(8, 10), 10);
    const prevDays = Number.parseInt(process.env.ESSL_PREVIOUS_MONTH_DAYS ?? "3", 10) || 0;

    const targets: [number, number][] = [];
    if (day <= prevDays) targets.push(month === 1 ? [year - 1, 12] : [year, month - 1]);
    targets.push([year, month]);

    for (const [y, m] of targets) {
        const r = await syncEsslMonth({ year: y, month: m, actor: "essl-sync", trigger: "schedule" });
        if (r.error) {
            console.error(`[essl] sync ${y}-${String(m).padStart(2, "0")} failed: ${r.error}`);
        } else if (r.daysChanged > 0) {
            console.log(
                `[essl] sync ${y}-${String(m).padStart(2, "0")}: ${r.punches} punches, ${r.employeesUpdated} employees, ${r.daysChanged} days updated`,
            );
        }
        if (r.unmatchedCodes.length > 0 && r.daysChanged > 0) {
            console.warn(`[essl] machine codes not in Admin → People: ${r.unmatchedCodes.join(", ")}`);
        }
    }
}

export function startEsslSyncScheduler() {
    if (timer) return;
    if (!esslAutoSyncEnabled()) {
        console.log("[essl] auto-sync off (set ESSL_SYNC_ENABLED=true to pull punches from the biometric machine)");
        return;
    }
    if (!esslConfig()) {
        console.warn("[essl] ESSL_SYNC_ENABLED=true but ESSL_API_URL / ESSL_SERIAL_NUMBERS / ESSL_USERNAME are missing");
        return;
    }
    const minutes = esslSyncIntervalMinutes();
    void tick();
    timer = setInterval(() => void tick(), minutes * 60_000);
    console.log(`[essl] auto-sync every ${minutes} min`);
}