/**
 * One-time repair: undo AB marks the machine sync wrote on days when the machine recorded
 * nothing at all (before it was installed, or while it was off).
 *
 * For each such day the previous value is restored from change_history (e.g. an earlier PDF
 * upload). If there was nothing before, the day is cleared. Weekly totals are then rebuilt.
 *
 *   node --input-type=module -e "import('./dist/essl/repair.js').then(m => m.runRepairCli())" -- 2026-05-01 2026-05-31 [--apply]
 */
import { query, withTransaction } from "../db/index.js";
import { weekBoundsContaining } from "../persist/helpers.js";
import { syncEmployeeWeek } from "../persist/sync.js";
import { fetchEsslPunches } from "./client.js";

type RawRow = { id: number; employee_id: number; employee_code: string; attendance_date: string };

const RESTORE_FIELDS = [
    "in_time",
    "out_time",
    "working_hours",
    "late",
    "late_minutes",
    "source",
    "status_token",
    "daily_status",
    "note",
] as const;

export type RepairResult = {
    from: string;
    to: string;
    machineDays: number;
    noMachineDays: string[];
    restored: number;
    cleared: number;
    weeksRebuilt: number;
    applied: boolean;
    sample: { code: string; date: string; action: "restore" | "clear"; restoredTo?: string }[];
};

export async function repairNoMachineDays(from: string, to: string, apply: boolean): Promise<RepairResult> {
    const punches = await fetchEsslPunches(from, to);
    const machineDays = new Set(punches.map((p) => p.date));
    if (machineDays.size === 0) {
        throw new Error("The machine returned no punches for this range - refusing to touch anything.");
    }

    const rows = await query<RawRow>(
        `SELECT r.id, r.employee_id, e.employee_code, r.attendance_date::text AS attendance_date
     FROM daily_attendance_raw r JOIN employees e ON e.id = r.employee_id
     WHERE r.attendance_date BETWEEN $1::date AND $2::date
       AND r.source = 'essl' AND UPPER(COALESCE(r.status_token, '')) = 'AB'
     ORDER BY r.attendance_date, e.employee_code`,
        [from, to],
    );
    const bad = rows.filter((r) => !machineDays.has(r.attendance_date.slice(0, 10)));

    const result: RepairResult = {
        from,
        to,
        machineDays: machineDays.size,
        noMachineDays: [...new Set(bad.map((r) => r.attendance_date.slice(0, 10)))].sort(),
        restored: 0,
        cleared: 0,
        weeksRebuilt: 0,
        applied: apply,
        sample: [],
    };

    const weeks = new Map<string, { employeeId: number; weekStart: string; weekEnd: string }>();

    for (const row of bad) {
        const date = row.attendance_date.slice(0, 10);
        const hist = await query<{ before_json: string }>(
            `SELECT before_json FROM change_history
       WHERE entity_type = 'daily_attendance_raw' AND entity_id = $1 AND before_json IS NOT NULL
       ORDER BY id DESC`,
            [row.id],
        );
        // Latest snapshot from before the machine sync wrote this day.
        let before: Record<string, unknown> | null = null;
        for (const h of hist) {
            try {
                const b = JSON.parse(h.before_json) as Record<string, unknown>;
                if (String(b.source ?? "") !== "essl") {
                    before = b;
                    break;
                }
            } catch {
                /* skip unreadable history */
            }
        }

        const action: "restore" | "clear" = before ? "restore" : "clear";
        if (result.sample.length < 15) {
            result.sample.push({
                code: row.employee_code,
                date,
                action,
                restoredTo: before ? String(before.status_token ?? "") : undefined,
            });
        }
        if (action === "restore") result.restored += 1;
        else result.cleared += 1;

        const wb = weekBoundsContaining(date);
        weeks.set(`${row.employee_id}|${wb.weekStart}`, { employeeId: row.employee_id, ...wb });

        if (!apply) continue;
        await withTransaction(async (client) => {
            if (before) {
                const sets = RESTORE_FIELDS.map((f, i) => `${f} = $${i + 2}`).join(", ");
                await client.query(
                    `UPDATE daily_attendance_raw SET ${sets}, updated_at = NOW() WHERE id = $1`,
                    [row.id, ...RESTORE_FIELDS.map((f) => (before as Record<string, unknown>)[f] ?? null)],
                );
            } else {
                await client.query(`DELETE FROM daily_attendance_raw WHERE id = $1`, [row.id]);
                const edit = await client.query(
                    `SELECT 1 FROM daily_attendance_edits WHERE employee_id = $1 AND attendance_date = $2::date`,
                    [row.employee_id, date],
                );
                if (edit.rowCount === 0) {
                    await client.query(
                        `DELETE FROM daily_attendance WHERE employee_id = $1 AND attendance_date = $2::date`,
                        [row.employee_id, date],
                    );
                }
            }
            await client.query(
                `INSERT INTO change_history (entity_type, entity_id, action, actor, before_json, after_json, note)
         VALUES ('daily_attendance_raw', $1, $2, 'essl-repair', NULL, $3, 'machine had no punches that day')`,
                [row.id, action, before ? JSON.stringify(before) : null],
            );
        });
    }

    if (apply) {
        for (const w of weeks.values()) {
            await withTransaction((client) => syncEmployeeWeek(client, w));
            result.weeksRebuilt += 1;
        }
    }
    return result;
}

/** CLI: node ... -- <from> <to> [--apply] */
export async function runRepairCli() {
    const args = process.argv.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a) || a === "--apply");
    const [from, to] = args.filter((a) => a !== "--apply");
    const apply = args.includes("--apply");
    if (!from || !to) {
        console.error("usage: ... -- YYYY-MM-DD YYYY-MM-DD [--apply]");
        process.exit(1);
    }
    try {
        const r = await repairNoMachineDays(from, to, apply);
        console.log(apply ? "APPLIED" : "PREVIEW (nothing changed - add --apply to fix)");
        console.log(`range ${r.from}..${r.to}, machine had punches on ${r.machineDays} days`);
        console.log(`days with no machine data that had AB: ${r.noMachineDays.join(" ") || "none"}`);
        console.log(`restore earlier value: ${r.restored} | clear (nothing before): ${r.cleared}${apply ? ` | weeks rebuilt: ${r.weeksRebuilt}` : ""}`);
        for (const s of r.sample) {
            console.log(`  ${s.code} ${s.date} -> ${s.action === "restore" ? `restore "${s.restoredTo}"` : "clear"}`);
        }
        process.exit(0);
    } catch (e) {
        console.error("repair failed:", e instanceof Error ? e.message : e);
        process.exit(1);
    }
}

/* ------------------------------------------------------------------------------------------ */
/* Stale manual edits: the old weekly editor saved every day of the week, empty days as AB.   */
/* ------------------------------------------------------------------------------------------ */

type EditRow = {
    employee_id: number;
    employee_code: string;
    name: string;
    attendance_date: string;
    token: string;
    edited_on: string;
    raw_token: string | null;
    raw_hours: number | null;
};

export type EditRepairResult = {
    applied: boolean;
    rows: { code: string; name: string; date: string; edit: string; machine: string; why: string }[];
    weeksRebuilt: number;
};

/**
 * Auto mode: AB edits saved for a day that had not happened yet, or that hide a machine/WFH day.
 * Manual mode (code given): every edit for that employee between from..to.
 */
export async function repairStaleEdits(opts: {
    from: string;
    to: string;
    code?: string;
    apply: boolean;
}): Promise<EditRepairResult> {
    const params: unknown[] = [opts.from, opts.to];
    let filter = `(
      (UPPER(COALESCE(ed.patch->>'status_token','')) = 'AB'
        AND (ed.attendance_date > (ed.updated_at AT TIME ZONE 'Asia/Kolkata')::date
             OR UPPER(COALESCE(r.status_token,'')) LIKE 'P%'
             OR UPPER(COALESCE(r.status_token,'')) LIKE 'WFH%'))
    )`;
    if (opts.code) {
        params.push(opts.code.trim().toUpperCase());
        filter = `UPPER(e.employee_code) = $3`;
    }
    const rows = await query<EditRow>(
        `SELECT ed.employee_id, e.employee_code, e.name, ed.attendance_date::text AS attendance_date,
            COALESCE(ed.patch->>'status_token','') AS token,
            (ed.updated_at AT TIME ZONE 'Asia/Kolkata')::date::text AS edited_on,
            r.status_token AS raw_token, r.working_hours AS raw_hours
     FROM daily_attendance_edits ed
     JOIN employees e ON e.id = ed.employee_id
     LEFT JOIN daily_attendance_raw r ON r.employee_id = ed.employee_id AND r.attendance_date = ed.attendance_date
     WHERE ed.attendance_date BETWEEN $1::date AND $2::date AND ${filter}
     ORDER BY e.employee_code, ed.attendance_date`,
        params,
    );

    const result: EditRepairResult = { applied: opts.apply, rows: [], weeksRebuilt: 0 };
    const weeks = new Map<string, { employeeId: number; weekStart: string; weekEnd: string }>();
    for (const r of rows) {
        const date = r.attendance_date.slice(0, 10);
        const future = date > r.edited_on.slice(0, 10);
        result.rows.push({
            code: r.employee_code,
            name: r.name,
            date,
            edit: r.token || "-",
            machine: r.raw_token ? `${r.raw_token}${r.raw_hours != null ? ` ${Number(r.raw_hours).toFixed(2)}h` : ""}` : "-",
            why: opts.code ? "requested" : future ? `saved on ${r.edited_on} for a future day` : "hides machine/WFH data",
        });
        const wb = weekBoundsContaining(date);
        weeks.set(`${r.employee_id}|${wb.weekStart}`, { employeeId: r.employee_id, ...wb });
    }
    if (!opts.apply || rows.length === 0) return result;

    await withTransaction(async (client) => {
        for (const r of rows) {
            const date = r.attendance_date.slice(0, 10);
            await client.query(
                `DELETE FROM daily_attendance_edits WHERE employee_id = $1 AND attendance_date = $2::date`,
                [r.employee_id, date],
            );
            // No machine/upload row underneath -> the day becomes empty again.
            await client.query(
                `DELETE FROM daily_attendance d WHERE d.employee_id = $1 AND d.attendance_date = $2::date
           AND NOT EXISTS (SELECT 1 FROM daily_attendance_raw r
                           WHERE r.employee_id = d.employee_id AND r.attendance_date = d.attendance_date)`,
                [r.employee_id, date],
            );
            await client.query(
                `INSERT INTO change_history (entity_type, entity_id, action, actor, before_json, after_json, note)
         VALUES ('daily_attendance_edit', $1, 'delete', 'essl-repair', $2, NULL, 'stale manual edit removed')`,
                [r.employee_id, JSON.stringify({ date, token: r.token })],
            );
        }
        for (const w of weeks.values()) {
            await syncEmployeeWeek(client, w);
            result.weeksRebuilt += 1;
        }
    });
    return result;
}

/** CLI: node ... -- <from> <to> [CODE] [--apply] */
export async function runEditRepairCli() {
    const dates = process.argv.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
    const code = process.argv.find((a) => /^[A-Za-z]+\d+$/.test(a));
    const apply = process.argv.includes("--apply");
    if (dates.length < 2) {
        console.error("usage: ... -- YYYY-MM-DD YYYY-MM-DD [EMPCODE] [--apply]");
        process.exit(1);
    }
    try {
        const r = await repairStaleEdits({ from: dates[0], to: dates[1], code, apply });
        console.log(apply ? "APPLIED" : "PREVIEW (nothing changed - add --apply to fix)");
        console.log(`manual edits ${apply ? "removed" : "to remove"}: ${r.rows.length}${apply ? ` | weeks rebuilt: ${r.weeksRebuilt}` : ""}`);
        for (const x of r.rows) {
            console.log(`  ${x.code} ${x.name} ${x.date}  edit=${x.edit}  machine=${x.machine}  (${x.why})`);
        }
        process.exit(0);
    } catch (e) {
        console.error("edit repair failed:", e instanceof Error ? e.message : e);
        process.exit(1);
    }
}