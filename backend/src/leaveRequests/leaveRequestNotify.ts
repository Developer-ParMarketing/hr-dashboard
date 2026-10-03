import { formatDisplayDate, formatDisplayDateRange } from "../displayDate.js";
import { sendSmtpMail } from "../notify/smtp.js";
import { hrMailbox } from "../notify/smtp.js";
import { executiveAdminNotificationEmails } from "./approvers.js";
import { enumerateInclusiveDates } from "./balance.js";

type LeaveType = "pl" | "sl" | "cl";
import { leadershipCcEmails } from "../performance/leadership.js";

export type LeaveRequestNotifyPayload = {
  id: number;
  employeeName: string;
  employeeCode: string;
  requesterName: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  reason: string;
};

function leaveTypeLabel(t: LeaveType): string {
  if (t === "pl") return "Privilege leave (PL)";
  if (t === "sl") return "Sick leave (SL)";
  return "Casual leave (CL)";
}

/** Jay/Mansi, HR mailbox, and executive HR approvers - override/add via LEAVE_REQUEST_NOTIFY_EMAILS. */
export function managementLeaveNotifyEmails(): string[] {
  const emails = new Set<string>();
  for (const e of leadershipCcEmails()) {
    emails.add(e.trim().toLowerCase());
  }
  emails.add(hrMailbox().trim().toLowerCase());
  for (const e of executiveAdminNotificationEmails()) {
    emails.add(e.trim().toLowerCase());
  }
  const extra = (process.env.LEAVE_REQUEST_NOTIFY_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes("@"));
  for (const e of extra) emails.add(e);
  return [...emails];
}

function formatLeaveDaysList(startDate: string, endDate: string): string {
  const days = [...enumerateInclusiveDates(startDate, endDate)].map((d) => formatDisplayDate(d));
  if (days.length === 0) return formatDisplayDateRange(startDate, endDate);
  if (days.length <= 14) {
    return days.join(", ");
  }
  return `${days.slice(0, 14).join(", ")} … (+${days.length - 14} more days)`;
}

export async function notifyManagementOfLeaveRequest(
  input: LeaveRequestNotifyPayload,
): Promise<{ skipped: boolean }> {
  const recipients = managementLeaveNotifyEmails();
  if (recipients.length === 0) {
    console.warn("[leave-notify] No management recipients configured; skip");
    return { skipped: true };
  }

  const typeLabel = leaveTypeLabel(input.leaveType);
  const rangeLabel = formatDisplayDateRange(input.startDate, input.endDate);
  const daysList = formatLeaveDaysList(input.startDate, input.endDate);
  const reason =
    input.reason.trim() ||
    "(No reason provided in the request - check the dashboard for details.)";
  const appUrl = (process.env.APP_URL ?? "http://localhost:5173").replace(/\/$/, "");
  const reviewUrl = `${appUrl}/leave-request?tab=pending`;

  const subject = `Leave request · ${input.employeeName} · ${typeLabel} · ${rangeLabel}`;

  const body = [
    "A new leave request was submitted on the HR dashboard.",
    "",
    `Employee: ${input.employeeName} (${input.employeeCode})`,
    `Submitted by: ${input.requesterName}`,
    `Leave type: ${typeLabel}`,
    `Dates: ${rangeLabel}`,
    `Days on leave: ${daysList}`,
    "",
    "Reason stated:",
    reason,
    "",
    `Request ID: ${input.id}`,
    `Review pending requests: ${reviewUrl}`,
  ].join("\n");

  const html = `
    <p>A new leave request was submitted on the HR dashboard.</p>
    <table style="border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:4px 12px 4px 0;font-weight:600;">Employee</td><td>${escapeHtml(input.employeeName)} (${escapeHtml(input.employeeCode)})</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:600;">Submitted by</td><td>${escapeHtml(input.requesterName)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:600;">Leave type</td><td>${escapeHtml(typeLabel)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:600;">Dates</td><td>${escapeHtml(rangeLabel)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:600;vertical-align:top;">Days on leave</td><td>${escapeHtml(daysList)}</td></tr>
    </table>
    <p style="margin-top:16px;font-weight:600;">Reason stated</p>
    <p style="white-space:pre-wrap;margin-top:4px;">${escapeHtml(reason)}</p>
    <p style="margin-top:16px;"><a href="${escapeHtml(reviewUrl)}">Open pending leave requests</a></p>
  `.trim();

  const [primary, ...rest] = recipients;
  return sendSmtpMail({
    to: primary!,
    cc: rest.length > 0 ? rest : undefined,
    subject,
    body,
    html,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
