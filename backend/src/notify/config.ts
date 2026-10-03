// Late + weekly short-hours emails need NOTIFICATIONS_ENABLED=true.
// Login, password, welcome, and offer mail ignore this flag.

export function attendanceEmailAlertsEnabled(): boolean {
  const flag = (process.env.NOTIFICATIONS_ENABLED ?? "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "on";
}

/** @deprecated Use attendanceEmailAlertsEnabled - kept for callers that meant “bulk alerts”, not SMTP. */
export function notificationsEnabled(): boolean {
  return attendanceEmailAlertsEnabled();
}
