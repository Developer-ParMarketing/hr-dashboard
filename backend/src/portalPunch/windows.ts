import { LATE_GRACE_MINUTES, parseClockToMinutes } from "../persist/helpers.js";

export const PORTAL_CHECKIN_GRACE_MINUTES = 60;
export const PORTAL_CHECKOUT_GRACE_MINUTES = 60;
export const DEFAULT_SHIFT_DURATION_MINUTES = 9 * 60;

const INDIA_TZ = "Asia/Kolkata";

export function todayIsoInIndia(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: INDIA_TZ }).format(now);
}

export function clockHmInIndia(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: INDIA_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

export function minutesNowInIndia(now = new Date()): number {
  const hm = clockHmInIndia(now);
  return parseClockToMinutes(hm) ?? 0;
}

export function normalizeShiftStart(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "09:00";
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "09:00";
  const h = Number.parseInt(m[1], 10);
  const min = Number.parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return "09:00";
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export type PortalWindowInfo = {
  shiftStart: string;
  /** Nominal shift end if you start on time (shift start + 9h). */
  shiftEnd: string;
  checkInFrom: string;
  checkInUntil: string;
  checkOutFrom: string;
  checkOutUntil: string;
  checkInOpen: boolean;
  checkOutOpen: boolean;
  nowHm: string;
  todayIso: string;
  /** When checked in: logout time = check-in + 9 hours. */
  expectedCheckOut?: string;
  checkInLate?: boolean;
  lateMinutes?: number;
};

function minutesToHm(total: number): string {
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function shiftTimingFromCheckIn(
  checkInTimeHm: string,
  shiftStartRaw: string | null | undefined,
): {
  expectedCheckOut: string;
  checkOutFrom: string;
  checkOutUntil: string;
  checkInLate: boolean;
  lateMinutes: number;
} {
  const shiftStart = normalizeShiftStart(shiftStartRaw);
  const startMin = parseClockToMinutes(shiftStart) ?? 9 * 60;
  const inMin = parseClockToMinutes(checkInTimeHm) ?? startMin;
  const expectedOutMin = inMin + DEFAULT_SHIFT_DURATION_MINUTES;
  const checkOutFrom = expectedOutMin;
  const checkOutUntil = expectedOutMin + PORTAL_CHECKOUT_GRACE_MINUTES;
  const lateThreshold = startMin + LATE_GRACE_MINUTES;
  const checkInLate = inMin > lateThreshold;
  const lateMinutes = checkInLate ? inMin - startMin : 0;

  return {
    expectedCheckOut: minutesToHm(expectedOutMin),
    checkOutFrom: minutesToHm(checkOutFrom),
    checkOutUntil: minutesToHm(checkOutUntil),
    checkInLate,
    lateMinutes,
  };
}

function checkOutOpenForWindow(checkOutFromHm: string, checkOutUntilHm: string, now = new Date()): boolean {
  const nowMin = minutesNowInIndia(now);
  const from = parseClockToMinutes(checkOutFromHm) ?? 0;
  const until = parseClockToMinutes(checkOutUntilHm) ?? 0;
  return nowMin >= from && nowMin <= until;
}

export function portalWindowsForShift(
  shiftStartRaw: string | null | undefined,
  now = new Date(),
  checkInTimeHm?: string | null,
): PortalWindowInfo {
  const shiftStart = normalizeShiftStart(shiftStartRaw);
  const startMin = parseClockToMinutes(shiftStart) ?? 9 * 60;
  const endMin = startMin + DEFAULT_SHIFT_DURATION_MINUTES;
  const checkInFrom = startMin;
  const checkInUntil = startMin + PORTAL_CHECKIN_GRACE_MINUTES;
  let checkOutFrom = endMin;
  let checkOutUntil = endMin + PORTAL_CHECKOUT_GRACE_MINUTES;
  const nowMin = minutesNowInIndia(now);

  let expectedCheckOut: string | undefined;
  let checkInLate: boolean | undefined;
  let lateMinutes: number | undefined;

  if (checkInTimeHm) {
    const personal = shiftTimingFromCheckIn(checkInTimeHm, shiftStartRaw);
    expectedCheckOut = personal.expectedCheckOut;
    checkInLate = personal.checkInLate;
    lateMinutes = personal.lateMinutes;
    checkOutFrom = parseClockToMinutes(personal.checkOutFrom) ?? checkOutFrom;
    checkOutUntil = parseClockToMinutes(personal.checkOutUntil) ?? checkOutUntil;
  }

  return {
    shiftStart,
    shiftEnd: minutesToHm(endMin),
    checkInFrom: minutesToHm(checkInFrom),
    checkInUntil: minutesToHm(checkInUntil),
    checkOutFrom: minutesToHm(checkOutFrom),
    checkOutUntil: minutesToHm(checkOutUntil),
    checkInOpen: nowMin >= checkInFrom && nowMin <= checkInUntil,
    checkOutOpen: checkOutOpenForWindow(minutesToHm(checkOutFrom), minutesToHm(checkOutUntil), now),
    nowHm: clockHmInIndia(now),
    todayIso: todayIsoInIndia(now),
    expectedCheckOut,
    checkInLate,
    lateMinutes,
  };
}

export function assertCheckInAllowed(shiftStartRaw: string | null | undefined, now = new Date()): PortalWindowInfo {
  const info = portalWindowsForShift(shiftStartRaw, now);
  if (!info.checkInOpen) {
    throw Object.assign(
      new Error(
        `Check-in is only allowed between ${info.checkInFrom} and ${info.checkInUntil} (shift ${info.shiftStart}).`,
      ),
      { status: 403 },
    );
  }
  return info;
}

export function assertCheckOutAllowed(
  shiftStartRaw: string | null | undefined,
  now = new Date(),
  checkInTimeHm?: string | null,
): PortalWindowInfo {
  const info = portalWindowsForShift(shiftStartRaw, now, checkInTimeHm);
  if (!info.checkOutOpen) {
    const target = info.expectedCheckOut ?? info.shiftEnd;
    throw Object.assign(
      new Error(
        `Check-out is only allowed between ${info.checkOutFrom} and ${info.checkOutUntil} (expected logout ${target} for a 9-hour day).`,
      ),
      { status: 403 },
    );
  }
  return info;
}
