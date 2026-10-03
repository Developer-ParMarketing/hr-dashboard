import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

const DEFAULT_FROM = "HR Team <hr@parmarketing.agency>";
const DEFAULT_HR = "hr@parmarketing.agency";

let transporter: Transporter | null = null;

export function hrMailbox(): string {
  return (process.env.HR_EMAIL ?? process.env.SMTP_FROM_EMAIL ?? DEFAULT_HR).trim() || DEFAULT_HR;
}

export function smtpFrom(): string {
  const named = process.env.SMTP_FROM?.trim();
  if (named) return named;
  return `HR Team <${hrMailbox()}>`;
}

export function smtpConfigured(): boolean {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return false;
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  // User without password → not ready (avoids "Missing credentials for PLAIN")
  if (user && !pass) return false;
  return true;
}

export { attendanceEmailAlertsEnabled, notificationsEnabled } from "./config.js";

function getTransporter(): Transporter {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST?.trim();
  if (!host) {
    throw new Error("SMTP_HOST is not set");
  }
  const port = Number.parseInt(process.env.SMTP_PORT ?? "587", 10) || 587;
  const secure =
    process.env.SMTP_SECURE === "true" || process.env.SMTP_SECURE === "1" || port === 465;
  const user = process.env.SMTP_USER?.trim() || undefined;
  const pass = process.env.SMTP_PASS?.trim() || undefined;
  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });
  return transporter;
}

export async function sendSmtpMail(opts: {
  to: string;
  subject: string;
  body: string;
  html?: string;
  cc?: string | string[];
  bcc?: string | string[];
  /** Set true to BCC the HR mailbox; default is off. */
  bccHr?: boolean;
  attachments?: Array<{ filename: string; content: Buffer }>;
}): Promise<{ skipped: boolean }> {
  const to = opts.to.trim();
  if (!to) throw new Error("Missing recipient");
  if (!smtpConfigured()) {
    console.warn(`[notify] SMTP not configured; skip mail to ${to} (${opts.subject})`);
    return { skipped: true };
  }
  if ((process.env.SMTP_DRY_RUN ?? "").trim() === "1") {
    console.log(`[notify] dry-run to=${to} subject=${opts.subject}\n${opts.body}`);
    return { skipped: true };
  }
  const bccHr = opts.bccHr === true;
  const hrBcc = bccHr ? hrMailbox() : undefined;
  const extraBcc = opts.bcc
    ? Array.isArray(opts.bcc)
      ? opts.bcc
      : [opts.bcc]
    : [];
  const bccAll = [...extraBcc, ...(hrBcc && hrBcc.toLowerCase() !== to.toLowerCase() ? [hrBcc] : [])];
  const cc = opts.cc
    ? Array.isArray(opts.cc)
      ? opts.cc
      : [opts.cc]
    : undefined;

  await getTransporter().sendMail({
    from: smtpFrom() || DEFAULT_FROM,
    to,
    cc: cc?.length ? cc.join(", ") : undefined,
    bcc: bccAll.length ? bccAll.join(", ") : undefined,
    subject: opts.subject,
    text: opts.body,
    html: opts.html,
    attachments: opts.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
    })),
  });
  return { skipped: false };
}
