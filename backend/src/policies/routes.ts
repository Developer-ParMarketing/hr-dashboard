import type { Request, Response } from "express";
import type { AuthedRequest } from "../auth/middleware.js";
import { invalidatePolicyCache } from "../chat/policies.js";
import {
    addPolicySection,
    deletePolicySection,
    listPolicyChanges,
    listPolicyDocuments,
    movePolicySection,
    setPolicySectionHidden,
    updatePolicySection,
} from "./store.js";
import { draftSectionsFromUpload } from "./importDoc.js";

function statusOf(e: unknown): number {
    return e && typeof e === "object" && "status" in e && typeof (e as { status: unknown }).status === "number"
        ? (e as { status: number }).status
        : 500;
}

function fail(res: Response, e: unknown, fallback: string): void {
    const status = statusOf(e);
    if (status >= 500) console.error("[policies]", e);
    res.status(status).json({ message: e instanceof Error ? e.message : fallback });
}

function actorOf(req: Request) {
    const u = (req as AuthedRequest).authUser;
    return { userId: u?.id ?? null, name: u?.name || u?.email || "HR" };
}

function idParam(req: Request): number {
    const id = Number.parseInt(String(req.params.id ?? ""), 10);
    if (!Number.isFinite(id) || id <= 0) throw Object.assign(new Error("Invalid policy section id"), { status: 400 });
    return id;
}

/** Everyone: the policies shown on the Policies page. */
export async function handleListPolicies(_req: Request, res: Response): Promise<void> {
    try {
        res.json({ documents: await listPolicyDocuments(false) });
    } catch (e) {
        fail(res, e, "Could not load policies");
    }
}

/** HR/admin: includes hidden sections and recent changes. */
export async function handleManagePolicies(_req: Request, res: Response): Promise<void> {
    try {
        res.json({ documents: await listPolicyDocuments(true), changes: await listPolicyChanges(30) });
    } catch (e) {
        fail(res, e, "Could not load policies");
    }
}

export async function handleAddPolicySection(req: Request, res: Response): Promise<void> {
    try {
        const section = await addPolicySection(req.body ?? {}, actorOf(req));
        invalidatePolicyCache();
        res.status(201).json({ section });
    } catch (e) {
        fail(res, e, "Could not add the policy");
    }
}

export async function handleUpdatePolicySection(req: Request, res: Response): Promise<void> {
    try {
        const section = await updatePolicySection(idParam(req), req.body ?? {}, actorOf(req));
        invalidatePolicyCache();
        res.json({ section });
    } catch (e) {
        fail(res, e, "Could not save the policy");
    }
}

export async function handleHidePolicySection(req: Request, res: Response): Promise<void> {
    try {
        const hidden = Boolean((req.body ?? {}).hidden);
        const section = await setPolicySectionHidden(idParam(req), hidden, actorOf(req));
        invalidatePolicyCache();
        res.json({ section });
    } catch (e) {
        fail(res, e, "Could not update the policy");
    }
}

export async function handleMovePolicySection(req: Request, res: Response): Promise<void> {
    try {
        const direction = (req.body ?? {}).direction === "up" ? "up" : "down";
        await movePolicySection(idParam(req), direction, actorOf(req));
        invalidatePolicyCache();
        res.json({ ok: true });
    } catch (e) {
        fail(res, e, "Could not move the policy");
    }
}

export async function handleDeletePolicySection(req: Request, res: Response): Promise<void> {
    try {
        await deletePolicySection(idParam(req), actorOf(req));
        invalidatePolicyCache();
        res.json({ ok: true });
    } catch (e) {
        fail(res, e, "Could not delete the policy");
    }
}

/** HR/admin: read an uploaded .pdf/.docx/.txt (or pasted text) and return draft sections. Saves nothing. */
export async function handleImportPolicyDocument(req: Request, res: Response): Promise<void> {
    try {
        const file = (req as Request & { file?: { buffer: Buffer; originalname: string } }).file;
        const body = (req.body ?? {}) as { text?: unknown };
        const sections = await draftSectionsFromUpload({
            buffer: file?.buffer,
            filename: file?.originalname,
            text: typeof body.text === "string" ? body.text : undefined,
        });
        res.json({ sections });
    } catch (e) {
        fail(res, e, "Could not read the document");
    }
}