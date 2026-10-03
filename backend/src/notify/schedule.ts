// Once per day (NOTIFICATIONS_HOUR in NOTIFICATIONS_TZ): late mail, weekly mail, holiday reminder.
// Offboarding deactivations run on the same clock in startOffboardingScheduler().

import {
  calendarDateInTimeZone,
  runScheduledNotifications,
} from "./service.js";
import { attendanceEmailAlertsEnabled } from "./config.js";
import { runHolidayYearEndReminder } from "../holidays/holidayReminder.js";
import { runScheduledEmployeeOffboarding } from "../employees/offboarding.js";

const HOUR = Number.parseInt(process.env.NOTIFICATIONS_HOUR ?? "8", 10) || 8;
const TZ = process.env.NOTIFICATIONS_TZ?.trim() || "Asia/Kolkata";
const TICK_MS = 60_000;

let lastRunDate = "";
let timer: ReturnType<typeof setInterval> | null = null;

function localHour(at = new Date()): number {
  const hourStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(at);
  return Number.parseInt(hourStr, 10);
}

async function maybeRun() {
  const today = calendarDateInTimeZone();
  if (localHour() < HOUR) return;
  if (lastRunDate === today) return;
  lastRunDate = today;
  try {
    const result = await runScheduledNotifications(today);
    console.log(
      `[notify] scheduled run ${today}: late sent=${result.late.sent} weekly shortfall sent=${result.weekly.sent} weekly review sent=${result.weeklyReview.sent}`,
    );
    const holidayReminder = await runHolidayYearEndReminder();
    if (holidayReminder.sent > 0) {
      console.log(`[holidays] year-end reminder sent to ${holidayReminder.sent} recipient(s)`);
    }
  } catch (err) {
    lastRunDate = "";
    console.error("[notify] scheduled run failed", err);
  }
}

export function startNotificationScheduler() {
  if (timer) return;
  if (!attendanceEmailAlertsEnabled()) {
    console.log(
      "[notify] attendance alert scheduler off (set NOTIFICATIONS_ENABLED=true to enable late/weekly emails)",
    );
    return;
  }
  void maybeRun();
  timer = setInterval(() => {
    void maybeRun();
  }, TICK_MS);
  console.log(`[notify] scheduler started (${TZ}, from ${HOUR}:00)`);
}

let offboardingLastRun = "";
let offboardingTimer: ReturnType<typeof setInterval> | null = null;

async function maybeRunOffboarding() {
  const today = calendarDateInTimeZone();
  if (localHour() < HOUR) return;
  if (offboardingLastRun === today) return;
  offboardingLastRun = today;
  try {
    const offboarding = await runScheduledEmployeeOffboarding();
    if (offboarding.processed > 0) {
      console.log(`[offboarding] processed ${offboarding.processed} employee(s)`);
    }
  } catch (err) {
    offboardingLastRun = "";
    console.error("[offboarding] scheduled run failed", err);
  }
}

export function startOffboardingScheduler() {
  if (offboardingTimer) return;
  void maybeRunOffboarding();
  offboardingTimer = setInterval(() => {
    void maybeRunOffboarding();
  }, TICK_MS);
  console.log(`[offboarding] scheduler started (${TZ}, from ${HOUR}:00)`);
}
