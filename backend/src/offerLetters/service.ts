import { sendSmtpMail, smtpConfigured } from "../notify/smtp.js";
import { leadershipCcEmails } from "../performance/leadership.js";
import { generateOfferLetterPdf, readJoiningFormsAttachment } from "./pdf.js";
import { parseOfferLetterCandidatesFromBody } from "./parseExcel.js";
import {
  DEFAULT_EMAIL_BODY,
  DEFAULT_EMAIL_SUBJECT,
  JOINING_FORMS_FILENAME,
  interpolateTemplate,
  type OfferLetterCandidateInput,
} from "./types.js";

export type EmailDraft = {
  to: string;
  cc: string[];
  subject: string;
  body: string;
};

export function buildEmailDraft(
  candidate: OfferLetterCandidateInput,
  subjectTemplate: string,
  bodyTemplate: string,
): EmailDraft {
  return {
    to: candidate.email,
    cc: leadershipCcEmails(),
    subject: interpolateTemplate(subjectTemplate, candidate),
    body: interpolateTemplate(bodyTemplate, candidate),
  };
}

export async function previewOfferLetterPdfBase64(candidate: OfferLetterCandidateInput): Promise<string> {
  const pdf = await generateOfferLetterPdf(candidate);
  return pdf.toString("base64");
}

export async function sendOfferLetters(input: {
  candidates: unknown;
  subject?: unknown;
  body?: unknown;
}): Promise<{
  sent: number;
  skipped: number;
  results: Array<{ email: string; name: string; ok: boolean; message: string }>;
}> {
  if (!smtpConfigured()) {
    throw Object.assign(
      new Error("SMTP is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS in backend/.env"),
      { status: 503 },
    );
  }

  const candidates = parseOfferLetterCandidatesFromBody(input.candidates);
  const subjectTemplate = String(input.subject ?? DEFAULT_EMAIL_SUBJECT).trim() || DEFAULT_EMAIL_SUBJECT;
  const bodyTemplate = String(input.body ?? DEFAULT_EMAIL_BODY).trim() || DEFAULT_EMAIL_BODY;

  let joiningForms: Buffer;
  try {
    joiningForms = readJoiningFormsAttachment();
  } catch (e) {
    throw Object.assign(
      new Error(e instanceof Error ? e.message : "Joining forms file missing"),
      { status: 500 },
    );
  }

  const results: Array<{ email: string; name: string; ok: boolean; message: string }> = [];
  let sent = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    try {
      const draft = buildEmailDraft(candidate, subjectTemplate, bodyTemplate);
      const pdf = await generateOfferLetterPdf(candidate);
      const safeName = candidate.name.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-") || "Candidate";
      const pdfName = `Offer-Letter-${safeName}.pdf`;

      const mailResult = await sendSmtpMail({
        to: draft.to,
        cc: draft.cc,
        subject: draft.subject,
        body: draft.body,
        bccHr: false,
        attachments: [
          { filename: pdfName, content: pdf },
          { filename: JOINING_FORMS_FILENAME, content: joiningForms },
        ],
      });

      if (mailResult.skipped) {
        skipped += 1;
        results.push({
          email: candidate.email,
          name: candidate.name,
          ok: false,
          message: "Email skipped (SMTP dry-run or not configured)",
        });
      } else {
        sent += 1;
        results.push({ email: candidate.email, name: candidate.name, ok: true, message: "Sent" });
      }
    } catch (e) {
      results.push({
        email: candidate.email,
        name: candidate.name,
        ok: false,
        message: e instanceof Error ? e.message : "Failed to send",
      });
    }
  }

  return { sent, skipped, results };
}

export function joiningFormsAvailable(): boolean {
  try {
    readJoiningFormsAttachment();
    return true;
  } catch {
    return false;
  }
}
