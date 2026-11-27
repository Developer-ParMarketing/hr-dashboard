/**
 * Policies stored in the database so HR can add / edit them in the app.
 * Tables are created on first use and filled once from defaults.ts.
 * The Policies page and the HR chatbot both read from here (one source).
 */
import { query } from "../db/index.js";
import { DEFAULT_POLICIES, type PolicyDocument, type PolicySection } from "./defaults.js";

export type PolicyDocId = "attendance" | "company";
export const POLICY_DOC_IDS: PolicyDocId[] = ["attendance", "company"];

export type StoredPolicySection = PolicySection & {
    dbId: number;
    docId: PolicyDocId;
    sortOrder: number;
    hidden: boolean;
    /** true once HR changed it in the app (seeded text = false) */
    edited: boolean;
    updatedAt: string;
    updatedBy: string | null;
};

export type StoredPolicyDocument = Omit<PolicyDocument, "sections"> & {
    sections: StoredPolicySection[];
    /** last time HR changed something in this document (null = original text) */
    editedAt: string | null;
    /** download URL of the PDF HR uploaded (overrides staticPdfPath) */
    pdfUrl?: string;
    uploadedPdf: PolicyFileInfo | null;
};

type Row = {
    id: number;
    doc_id: PolicyDocId;
    slug: string;
    title: string;
    summary: string;
    rules: string[];
    note: string | null;
    sort_order: number;
    hidden: boolean;
    edited: boolean;
    updated_at: string;
    updated_by_name: string | null;
};

let ready: Promise<void> | null = null;

export function ensurePolicyTables(): Promise<void> {
    ready ??= (async () => {
        await query(`
            CREATE TABLE IF NOT EXISTS policy_sections (
                id SERIAL PRIMARY KEY,
                doc_id TEXT NOT NULL CHECK (doc_id IN ('attendance', 'company')),
                slug TEXT NOT NULL,
                title TEXT NOT NULL,
                summary TEXT NOT NULL DEFAULT '',
                rules JSONB NOT NULL DEFAULT '[]'::jsonb,
                note TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                hidden BOOLEAN NOT NULL DEFAULT FALSE,
                edited BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_by_user_id INTEGER,
                updated_by_name TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_policy_sections_doc ON policy_sections (doc_id, sort_order);
            CREATE TABLE IF NOT EXISTS policy_change_log (
                id SERIAL PRIMARY KEY,
                doc_id TEXT NOT NULL,
                section_id INTEGER,
                action TEXT NOT NULL,
                title TEXT NOT NULL,
                before_json JSONB,
                after_json JSONB,
                changed_by_user_id INTEGER,
                changed_by_name TEXT,
                changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_policy_change_log_at ON policy_change_log (changed_at DESC);
            -- The downloadable PDF copy HR uploads (Policies -> Manage -> Downloadable PDF). One per document.
            CREATE TABLE IF NOT EXISTS policy_files (
                doc_id TEXT PRIMARY KEY,
                file_name TEXT NOT NULL,
                content BYTEA NOT NULL,
                size_bytes INTEGER NOT NULL,
                uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                uploaded_by_user_id INTEGER,
                uploaded_by_name TEXT
            );
        `);
        const existing = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM policy_sections`);
        if ((existing[0]?.n ?? 0) === 0) {
            for (const doc of DEFAULT_POLICIES) {
                let order = 0;
                for (const s of doc.sections) {
                    order += 10;
                    await query(
                        `INSERT INTO policy_sections (doc_id, slug, title, summary, rules, note, sort_order)
                         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
                        [doc.id, s.id, s.title, s.summary, JSON.stringify(s.rules), s.note ?? null, order],
                    );
                }
            }
            console.log("[policies] policy_sections filled from the default policy text");
        }
    })().catch((e) => {
        ready = null;
        throw e;
    });
    return ready;
}

function toSection(r: Row): StoredPolicySection {
    return {
        id: r.slug,
        dbId: r.id,
        docId: r.doc_id,
        title: r.title,
        summary: r.summary,
        rules: Array.isArray(r.rules) ? r.rules : [],
        note: r.note ?? undefined,
        sortOrder: r.sort_order,
        hidden: r.hidden,
        edited: r.edited,
        updatedAt: r.updated_at,
        updatedBy: r.updated_by_name,
    };
}

/** Policy documents with their sections. `includeHidden` only for the HR editor. */
export async function listPolicyDocuments(includeHidden = false): Promise<StoredPolicyDocument[]> {
    await ensurePolicyTables();
    const rows = await query<Row>(
        `SELECT id, doc_id, slug, title, summary, rules, note, sort_order, hidden, edited,
                updated_at::text AS updated_at, updated_by_name
         FROM policy_sections
         ${includeHidden ? "" : "WHERE hidden = FALSE"}
         ORDER BY doc_id, sort_order, id`,
    );
    const lastChange = await query<{ doc_id: string; at: string }>(
        `SELECT doc_id, MAX(changed_at)::text AS at FROM policy_change_log GROUP BY doc_id`,
    );
    const editedAt = new Map(lastChange.map((r) => [r.doc_id, r.at]));
    const files = new Map((await listPolicyFiles()).map((f) => [f.docId, f]));
    return DEFAULT_POLICIES.map((doc) => {
        const changed = editedAt.get(doc.id) ?? null;
        const file = files.get(doc.id);
        return {
            ...doc,
            // HR's uploaded PDF wins; otherwise the built-in static PDF until HR edits the text.
            staticPdfPath: file ? undefined : changed ? undefined : doc.staticPdfPath,
            pdfUrl: file ? `/api/policies/file/${doc.id}` : undefined,
            pdfFileName: file ? file.fileName : doc.pdfFileName,
            uploadedPdf: file ?? null,
            sections: rows.filter((r) => r.doc_id === doc.id).map(toSection),
            editedAt: changed,
        };
    });
}

export type SectionInput = {
    docId?: unknown;
    title?: unknown;
    summary?: unknown;
    rules?: unknown;
    note?: unknown;
};

type Actor = { userId: number | null; name: string };

function bad(message: string): Error {
    return Object.assign(new Error(message), { status: 400 });
}

function cleanInput(input: SectionInput, requireDoc: boolean) {
    const docId = String(input.docId ?? "").trim() as PolicyDocId;
    if (requireDoc && !POLICY_DOC_IDS.includes(docId)) throw bad("Choose Attendance policy or Company policy.");
    const title = String(input.title ?? "").trim();
    if (!title) throw bad("Title is required.");
    if (title.length > 120) throw bad("Title is too long (max 120 characters).");
    const summary = String(input.summary ?? "").trim().slice(0, 1000);
    const rawRules = Array.isArray(input.rules) ? input.rules : String(input.rules ?? "").split("\n");
    const rules = rawRules
        .map((r) => String(r).replace(/^\s*[-*•]\s*/, "").trim())
        .filter(Boolean)
        .map((r) => r.slice(0, 2000))
        .slice(0, 80);
    if (!summary && rules.length === 0) throw bad("Add a summary or at least one rule.");
    const note = String(input.note ?? "").trim().slice(0, 1000) || null;
    return { docId, title, summary, rules, note };
}

function slugify(title: string): string {
    const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "section";
    return `${base}-${Date.now().toString(36)}`;
}

async function getRow(id: number): Promise<Row> {
    const rows = await query<Row>(
        `SELECT id, doc_id, slug, title, summary, rules, note, sort_order, hidden, edited,
                updated_at::text AS updated_at, updated_by_name
         FROM policy_sections WHERE id = $1`,
        [id],
    );
    if (!rows[0]) throw Object.assign(new Error("Policy section not found."), { status: 404 });
    return rows[0];
}

async function logChange(
    docId: string,
    sectionId: number | null,
    action: string,
    title: string,
    before: unknown,
    after: unknown,
    actor: Actor,
): Promise<void> {
    await query(
        `INSERT INTO policy_change_log (doc_id, section_id, action, title, before_json, after_json, changed_by_user_id, changed_by_name)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
        [docId, sectionId, action, title, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, actor.userId, actor.name],
    );
}

export async function addPolicySection(input: SectionInput, actor: Actor): Promise<StoredPolicySection> {
    await ensurePolicyTables();
    const v = cleanInput(input, true);
    const maxOrder = await query<{ m: number | null }>(
        `SELECT MAX(sort_order) AS m FROM policy_sections WHERE doc_id = $1`,
        [v.docId],
    );
    const rows = await query<{ id: number }>(
        `INSERT INTO policy_sections (doc_id, slug, title, summary, rules, note, sort_order, edited, updated_by_user_id, updated_by_name)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, TRUE, $8, $9) RETURNING id`,
        [v.docId, slugify(v.title), v.title, v.summary, JSON.stringify(v.rules), v.note, (maxOrder[0]?.m ?? 0) + 10, actor.userId, actor.name],
    );
    const row = await getRow(rows[0]!.id);
    await logChange(v.docId, row.id, "added", v.title, null, v, actor);
    return toSection(row);
}

export async function updatePolicySection(id: number, input: SectionInput, actor: Actor): Promise<StoredPolicySection> {
    await ensurePolicyTables();
    const before = await getRow(id);
    const v = cleanInput(input, false);
    await query(
        `UPDATE policy_sections
         SET title = $2, summary = $3, rules = $4::jsonb, note = $5, edited = TRUE,
             updated_at = NOW(), updated_by_user_id = $6, updated_by_name = $7
         WHERE id = $1`,
        [id, v.title, v.summary, JSON.stringify(v.rules), v.note, actor.userId, actor.name],
    );
    await logChange(
        before.doc_id,
        id,
        "updated",
        v.title,
        { title: before.title, summary: before.summary, rules: before.rules, note: before.note },
        { title: v.title, summary: v.summary, rules: v.rules, note: v.note },
        actor,
    );
    return toSection(await getRow(id));
}

export async function setPolicySectionHidden(id: number, hidden: boolean, actor: Actor): Promise<StoredPolicySection> {
    await ensurePolicyTables();
    const before = await getRow(id);
    await query(
        `UPDATE policy_sections SET hidden = $2, updated_at = NOW(), updated_by_user_id = $3, updated_by_name = $4 WHERE id = $1`,
        [id, hidden, actor.userId, actor.name],
    );
    await logChange(before.doc_id, id, hidden ? "hidden" : "shown", before.title, null, null, actor);
    return toSection(await getRow(id));
}

export async function deletePolicySection(id: number, actor: Actor): Promise<void> {
    await ensurePolicyTables();
    const before = await getRow(id);
    await query(`DELETE FROM policy_sections WHERE id = $1`, [id]);
    await logChange(
        before.doc_id,
        id,
        "deleted",
        before.title,
        { title: before.title, summary: before.summary, rules: before.rules, note: before.note },
        null,
        actor,
    );
}

/** Move a section one place up or down inside its document. */
export async function movePolicySection(id: number, direction: "up" | "down", actor: Actor): Promise<void> {
    await ensurePolicyTables();
    const row = await getRow(id);
    const siblings = await query<{ id: number; sort_order: number }>(
        `SELECT id, sort_order FROM policy_sections WHERE doc_id = $1 ORDER BY sort_order, id`,
        [row.doc_id],
    );
    const idx = siblings.findIndex((s) => s.id === id);
    const swapWith = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || swapWith < 0 || swapWith >= siblings.length) return;
    const order = siblings.map((s) => s.id);
    [order[idx], order[swapWith]] = [order[swapWith]!, order[idx]!];
    for (let i = 0; i < order.length; i++) {
        await query(`UPDATE policy_sections SET sort_order = $2 WHERE id = $1`, [order[i], (i + 1) * 10]);
    }
    await logChange(row.doc_id, id, "moved", row.title, null, { direction }, actor);
}

export type PolicyChange = {
    id: number;
    docId: string;
    action: string;
    title: string;
    changedBy: string | null;
    changedAt: string;
};

export async function listPolicyChanges(limit = 50, sinceDays?: number): Promise<PolicyChange[]> {
    await ensurePolicyTables();
    const params: unknown[] = [Math.min(Math.max(limit, 1), 200)];
    let where = "";
    if (sinceDays) {
        params.push(sinceDays);
        where = `WHERE changed_at >= NOW() - ($2::int * INTERVAL '1 day')`;
    }
    const rows = await query<{
        id: number;
        doc_id: string;
        action: string;
        title: string;
        changed_by_name: string | null;
        changed_at: string;
    }>(
        `SELECT id, doc_id, action, title, changed_by_name, changed_at::text AS changed_at
         FROM policy_change_log ${where}
         ORDER BY changed_at DESC, id DESC
         LIMIT $1`,
        params,
    );
    return rows.map((r) => ({
        id: r.id,
        docId: r.doc_id,
        action: r.action,
        title: r.title,
        changedBy: r.changed_by_name,
        changedAt: r.changed_at,
    }));
}
// --- Downloadable PDF copy ---------------------------------------------------------------

export type PolicyFileInfo = { docId: string; fileName: string; sizeBytes: number; uploadedAt: string; uploadedBy: string | null };

export async function listPolicyFiles(): Promise<PolicyFileInfo[]> {
    await ensurePolicyTables();
    const rows = await query<{ doc_id: string; file_name: string; size_bytes: number; uploaded_at: string; uploaded_by_name: string | null }>(
        `SELECT doc_id, file_name, size_bytes, uploaded_at::text AS uploaded_at, uploaded_by_name FROM policy_files`,
    );
    return rows.map((r) => ({ docId: r.doc_id, fileName: r.file_name, sizeBytes: r.size_bytes, uploadedAt: r.uploaded_at, uploadedBy: r.uploaded_by_name }));
}

export async function getPolicyFile(docId: string): Promise<{ fileName: string; content: Buffer } | null> {
    await ensurePolicyTables();
    const rows = await query<{ file_name: string; content: Buffer }>(`SELECT file_name, content FROM policy_files WHERE doc_id = $1`, [docId]);
    return rows[0] ? { fileName: rows[0].file_name, content: rows[0].content } : null;
}

function checkDocId(docId: string): string {
    if (!DEFAULT_POLICIES.some((d) => d.id === docId)) throw Object.assign(new Error("Unknown policy"), { status: 400 });
    return docId;
}

/** HR uploads a new official PDF; it replaces the previous one for that policy. */
export async function savePolicyFile(docId: string, fileName: string, content: Buffer, actor: Actor): Promise<PolicyFileInfo> {
    await ensurePolicyTables();
    checkDocId(docId);
    if (!content.length) throw Object.assign(new Error("The file is empty."), { status: 400 });
    if (content.subarray(0, 5).toString("latin1") !== "%PDF-") {
        throw Object.assign(new Error("Please upload a PDF file."), { status: 400 });
    }
    const clean = (fileName.replace(/[\\/:*?"<>|]+/g, " ").trim() || `${docId}-policy.pdf`).slice(0, 150);
    const name = clean.toLowerCase().endsWith(".pdf") ? clean : `${clean}.pdf`;
    const before = (await listPolicyFiles()).find((f) => f.docId === docId) ?? null;
    await query(
        `INSERT INTO policy_files (doc_id, file_name, content, size_bytes, uploaded_at, uploaded_by_user_id, uploaded_by_name)
         VALUES ($1, $2, $3, $4, NOW(), $5, $6)
         ON CONFLICT (doc_id) DO UPDATE SET file_name = EXCLUDED.file_name, content = EXCLUDED.content,
           size_bytes = EXCLUDED.size_bytes, uploaded_at = NOW(),
           uploaded_by_user_id = EXCLUDED.uploaded_by_user_id, uploaded_by_name = EXCLUDED.uploaded_by_name`,
        [docId, name, content, content.length, actor.userId, actor.name],
    );
    await logChange(docId, null, "pdf", `New PDF copy: ${name}`, before ? { fileName: before.fileName } : null, { fileName: name }, actor);
    return (await listPolicyFiles()).find((f) => f.docId === docId)!;
}

/** Back to the built-in PDF (or the generated one). */
export async function deletePolicyFile(docId: string, actor: Actor): Promise<void> {
    await ensurePolicyTables();
    checkDocId(docId);
    const rows = await query<{ file_name: string }>(`DELETE FROM policy_files WHERE doc_id = $1 RETURNING file_name`, [docId]);
    if (rows[0]) await logChange(docId, null, "pdf_removed", `PDF copy removed: ${rows[0].file_name}`, { fileName: rows[0].file_name }, null, actor);
}