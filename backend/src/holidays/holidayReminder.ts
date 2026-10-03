import { query, queryOne } from "../db/index.js";
import { isExemptFromAttendanceAlertEmails } from "../performance/leadership.js";
import { sendSmtpMail, smtpConfigured } from "../notify/smtp.js";
import { countHolidaysForYear } from "./holidays.js";

const DEFAULT_REMINDER_EMAILS = [
  "jiya.mehta@parmarketing.agency",
  "devanshi.siddhpura@parmarketing.agency",
];

function reminderRecipients(): string[] {
  const raw = process.env.HOLIDAY_REMINDER_EMAILS?.trim();
  if (!raw) return DEFAULT_REMINDER_EMAILS;
  return raw
    .split(/[,;]/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function reminderMonthDay(): { month: number; day: number } {
  const month = Number.parseInt(process.env.HOLIDAY_REMINDER_MONTH ?? "12", 10);
  const day = Number.parseInt(process.env.HOLIDAY_REMINDER_DAY ?? "1", 10);
  return {
    month: Number.isFinite(month) && month >= 1 && month <= 12 ? month : 12,
    day: Number.isFinite(day) && day >= 1 && day <= 28 ? day : 1,
  };
}

function calendarPartsInTz(at: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const read = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return {
    year: Number.parseInt(read("year"), 10),
    month: Number.parseInt(read("month"), 10),
    day: Number.parseInt(read("day"), 10),
  };
}

async function reminderAlreadySent(targetYear: number): Promise<boolean> {
  const row = await queryOne<{ id: number }>(
    `SELECT id FROM holiday_year_reminders WHERE reminder_year = $1`,
    [targetYear],
  );
  return row != null;
}

async function markReminderSent(targetYear: number): Promise<void> {
  await query(
    `INSERT INTO holiday_year_reminders (reminder_year, sent_at)
     VALUES ($1, NOW())
     ON CONFLICT (reminder_year) DO NOTHING`,
    [targetYear],
  );
}

export async function runHolidayYearEndReminder(at = new Date()): Promise<{
  sent: number;
  skipped: boolean;
  reason?: string;
}> {
  if (!smtpConfigured()) {
    return { sent: 0, skipped: true, reason: "smtp_not_configured" };
  }

  const tz = process.env.NOTIFICATIONS_TZ?.trim() || "Asia/Kolkata";
  const { year, month, day } = calendarPartsInTz(at, tz);
  const { month: remindMonth, day: remindDay } = reminderMonthDay();

  if (month !== remindMonth || day !== remindDay) {
    return { sent: 0, skipped: true, reason: "not_reminder_day" };
  }

  const targetYear = year + 1;
  if (await reminderAlreadySent(targetYear)) {
    return { sent: 0, skipped: true, reason: "already_sent" };
  }

  const nextYearCount = await countHolidaysForYear(targetYear);
  if (nextYearCount > 0) {
    await markReminderSent(targetYear);
    return { sent: 0, skipped: true, reason: "next_year_already_has_holidays" };
  }

  const recipients = reminderRecipients().filter((to) => !isExemptFromAttendanceAlertEmails(to));
  if (recipients.length === 0) {
    return { sent: 0, skipped: true, reason: "no_recipients" };
  }

  const appUrl = process.env.APP_URL?.trim() || "http://localhost:5173";
  const subject = `Update ${targetYear} company holiday list`;
  const text = [
    `Hi,`,
    ``,
    `Please update the company holiday list for ${targetYear} in HR Automation.`,
    ``,
    `Open: ${appUrl}/holidays`,
    ``,
    `You can add dates and names for the new year, or copy from ${year} and adjust dates that shift.`,
    ``,
    `- HR Automation`,
  ].join("\n");

  let sent = 0;
  for (const to of recipients) {
    try {
      await sendSmtpMail({ to, subject, body: text, bccHr: false });
      sent += 1;
    } catch (err) {
      console.error(`[holidays] reminder email failed for ${to}`, err);
    }
  }

  if (sent > 0) {
    await markReminderSent(targetYear);
  }

  return { sent, skipped: sent === 0, reason: sent === 0 ? "send_failed" : undefined };
}
