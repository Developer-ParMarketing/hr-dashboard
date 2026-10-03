import type { NextFunction, Request, Response } from "express";
import type { AuthedRequest } from "../auth/middleware.js";
import { leadershipCcEmails } from "../performance/leadership.js";
import { smtpConfigured } from "../notify/smtp.js";
import { parseOfferLetterExcel } from "./parseExcel.js";
import {
  buildEmailDraft,
  joiningFormsAvailable,
  previewOfferLetterPdfBase64,
  sendOfferLetters,
} from "./service.js";
import {
  canUseOfferLetters,
  DEFAULT_EMAIL_BODY,
  DEFAULT_EMAIL_SUBJECT,
  JOINING_FORMS_FILENAME,
  normalizeCandidateRow,
} from "./types.js";

function statusFromError(e: unknown): number {
  if (e && typeof e === "object" && "status" in e && typeof (e as { status: unknown }).status === "number") {
    return (e as { status: number }).status;
  }
  return 500;
}

export function requireOfferLetterAccess(req: Request, res: Response, next: NextFunction): void {
  const user = (req as AuthedRequest).authUser;
  if (!canUseOfferLetters(user)) {
    res.status(403).json({ message: "Offer letters are available to HR only." });
    return;
  }
  next();
}

export async function handleOfferLetterMeta(_req: Request, res: Response): Promise<void> {
  res.json({
    columns: [
      { key: "email", label: "Email" },
      { key: "dateOfJoining", label: "Date of joining" },
      { key: "name", label: "Name" },
      { key: "companyName", label: "Company (default Par Marketing Pvt. Ltd.)" },
      { key: "position", label: "Designation" },
      { key: "salary", label: "Annual CTC (₹)" },
      { key: "salutation", label: "Salutation (Mr./Ms./Mx.)" },
      { key: "department", label: "Department" },
      { key: "reportingTo", label: "Reporting to" },
    ],
    defaultSubject: DEFAULT_EMAIL_SUBJECT,
    defaultBody: DEFAULT_EMAIL_BODY,
    ccRecipients: leadershipCcEmails(),
    joiningFormsAttachment: JOINING_FORMS_FILENAME,
    joiningFormsAvailable: joiningFormsAvailable(),
    smtpConfigured: smtpConfigured(),
    placeholders: [
      "{name}",
      "{email}",
      "{salutation}",
      "{companyName}",
      "{position}",
      "{designation}",
      "{salary}",
      "{department}",
      "{dateOfJoining}",
      "{dateOfJoiningLong}",
      "{today}",
    ],
  });
}

export async function handleParseOfferExcel(req: Request, res: Response): Promise<void> {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file?.buffer) {
    res.status(400).json({ message: "Upload an Excel file (field name: file)" });
    return;
  }
  try {
    const candidates = parseOfferLetterExcel(file.buffer);
    res.json({ candidates });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to parse Excel" });
  }
}

export async function handlePreviewOfferEmail(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const candidate = normalizeCandidateRow(body.candidate as Record<string, unknown>, 0);
    const subjectTemplate = String(body.subject ?? DEFAULT_EMAIL_SUBJECT);
    const bodyTemplate = String(body.body ?? DEFAULT_EMAIL_BODY);
    const draft = buildEmailDraft(candidate, subjectTemplate, bodyTemplate);
    res.json({ draft });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Invalid candidate row" });
  }
}

export async function handlePreviewOfferPdf(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const candidate = normalizeCandidateRow(body.candidate as Record<string, unknown>, 0);
    const pdfBase64 = await previewOfferLetterPdfBase64(candidate);
    res.json({ pdfBase64, filename: `Offer-Letter-preview.pdf` });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to generate PDF" });
  }
}

export async function handleSendOfferLetters(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const result = await sendOfferLetters({
      candidates: body.candidates,
      subject: body.subject,
      body: body.body,
    });
    res.json(result);
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to send offer letters" });
  }
}
