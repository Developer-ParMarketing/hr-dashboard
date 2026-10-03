import { createHmac, randomInt } from "crypto";
import { authSecret } from "./middleware.js";

export const OTP_TTL_SEC = Number.parseInt(process.env.LOGIN_OTP_TTL_SEC ?? "600", 10) || 600;
export const OTP_MAX_ATTEMPTS = Number.parseInt(process.env.LOGIN_OTP_MAX_ATTEMPTS ?? "5", 10) || 5;
export const OTP_LENGTH = 6;

export type ChallengeKind = "login" | "password_reset" | "account_setup";

export function generateOtpCode(): string {
  const max = 10 ** OTP_LENGTH;
  return String(randomInt(0, max)).padStart(OTP_LENGTH, "0");
}

export function hashOtpCode(challengeId: string, code: string): string {
  return createHmac("sha256", authSecret())
    .update(`otp:${challengeId}:${code.trim()}`)
    .digest("hex");
}

export function verifyOtpCode(challengeId: string, code: string, storedHash: string): boolean {
  const normalized = code.replace(/\D/g, "").trim();
  if (normalized.length !== OTP_LENGTH) return false;
  const expected = hashOtpCode(challengeId, normalized);
  return expected === storedHash;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  if (local.length <= 2) return `${local[0] ?? "*"}***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}
