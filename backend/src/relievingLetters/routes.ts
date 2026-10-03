import type { NextFunction, Request, Response } from "express";
import type { AuthedRequest } from "../auth/middleware.js";
import { actorFromRequest } from "../auth/middleware.js";
import { applyRelievingLetterOffboarding } from "../employees/offboarding.js";
import { generateRelievingLetterDocx, safeDownloadBasename, templateAvailable } from "./docx.js";
import { libreOfficePdfAvailable } from "./libreOffice.js";
import { generateRelievingLetterPdf } from "./pdf.js";
import {
  loadUserSignature,
  saveUserSignature,
  userHasSavedSignature,
} from "./signatureStore.js";
import {
  normalizeRelievingLetterInput,
  RELIEVING_TEMPLATE_FILENAME,
  requireRelievingLetterAccess,
} from "./types.js";

function statusFromError(e: unknown): number {
  if (e && typeof e === "object" && "status" in e && typeof (e as { status: unknown }).status === "number") {
    return (e as { status: number }).status;
  }
  return 500;
}

function parseRememberSignature(value: unknown): boolean {
  if (value === true || value === 1) return true;
  const s = String(value ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

export function requireRelievingLetterAccessMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const user = (req as AuthedRequest).authUser;
  if (!requireRelievingLetterAccess(user)) {
    res.status(403).json({ message: "Experience / relieving letters are available to HR only." });
    return;
  }
  next();
}

export async function handleRelievingLetterMeta(req: Request, res: Response): Promise<void> {
  const user = (req as AuthedRequest).authUser;
  const pdfConversionAvailable = await libreOfficePdfAvailable();
  res.json({
    templateFile: RELIEVING_TEMPLATE_FILENAME,
    templateAvailable: templateAvailable(),
    pdfConversionAvailable,
    hasSavedSignature: user?.id != null ? userHasSavedSignature(user.id) : false,
    signatureHint: "PNG or JPEG with transparent background works best.",
    fields: [
      { key: "letterDate", label: "Letter date", hint: "Defaults to today" },
      { key: "employeeName", label: "Employee name" },
      { key: "employeeCode", label: "Employee code" },
      { key: "gender", label: "Gender", hint: "Used for Mr. / Ms. / Mrs." },
      { key: "designation", label: "Designation" },
      { key: "dateOfJoining", label: "Date of joining (DOJ)" },
      { key: "dateOfLeaving", label: "Date of leaving (DOL)" },
    ],
    placeholders: [
      "[[letterDate]]",
      "[[employeeName]]",
      "[[employeeCode]]",
      "[[salutation]]",
      "[[designation]]",
      "[[dateOfJoining]]",
      "[[dateOfLeaving]]",
    ],
  });
}

export async function handleSaveRelievingSignature(req: Request, res: Response): Promise<void> {
  const user = (req as AuthedRequest).authUser;
  if (user?.id == null) {
    res.status(401).json({ message: "Sign in required" });
    return;
  }
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file?.buffer?.length) {
    res.status(400).json({ message: "Upload a signature image (PNG or JPEG, field name: signature)" });
    return;
  }
  try {
    saveUserSignature(user.id, file.buffer);
    res.json({ ok: true });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Could not save signature" });
  }
}

export async function handleGenerateRelievingLetter(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const input = normalizeRelievingLetterInput(body);
    const buffer = generateRelievingLetterDocx(input);
    const actor = actorFromRequest(req as AuthedRequest);
    await applyRelievingLetterOffboarding({
      employeeCode: input.employeeCode,
      dateOfLeaving: input.dateOfLeaving,
      actor,
    });
    const filename = `${safeDownloadBasename(input.employeeName, input.employeeCode)}-exp-rel-letter.docx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Could not generate letter" });
  }
}

export async function handleGenerateRelievingLetterPdf(req: Request, res: Response): Promise<void> {
  const user = (req as AuthedRequest).authUser;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const upload = (req as Request & { file?: Express.Multer.File }).file;

  let signature: Buffer | undefined = upload?.buffer;
  if (!signature?.length && user?.id != null) {
    signature = loadUserSignature(user.id) ?? undefined;
  }
  if (!signature?.length) {
    res.status(400).json({
      message: "Upload a digital signature (PNG or JPEG) to generate the PDF for the employee.",
    });
    return;
  }

  if (parseRememberSignature(body.rememberSignature) && upload?.buffer?.length && user?.id != null) {
    saveUserSignature(user.id, upload.buffer);
  }

  try {
    const input = normalizeRelievingLetterInput(body);
    const actor = actorFromRequest(req as AuthedRequest);
    const buffer = await generateRelievingLetterPdf(input, signature);
    await applyRelievingLetterOffboarding({
      employeeCode: input.employeeCode,
      dateOfLeaving: input.dateOfLeaving,
      actor,
    });
    const filename = `${safeDownloadBasename(input.employeeName, input.employeeCode)}-exp-rel-letter.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Could not generate PDF" });
  }
}
