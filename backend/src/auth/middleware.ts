import type express from "express";
import { verifyJwt } from "./jwt.js";
import { findUserById, sessionIsActive, type AuthUser } from "./users.js";

export const AUTH_COOKIE = "attendance_token";
export const AUTH_TTL_SEC = 60 * 60 * 12;

export type AuthedRequest = express.Request & { authUser?: AuthUser; authJti?: string };

export function authSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim();
  if (secret) return secret;
  return "dev-only-attendance-auth-secret-change-me";
}

/** When false, sign-in completes after password (no email OTP). Set LOGIN_EMAIL_OTP=false temporarily. */
export function loginEmailOtpEnabled(): boolean {
  const flag = (process.env.LOGIN_EMAIL_OTP ?? process.env.AUTH_LOGIN_OTP ?? "true").trim().toLowerCase();
  return flag !== "0" && flag !== "false" && flag !== "no" && flag !== "off";
}

export function cookieHeader(token: string, maxAgeSec: number): string {
  const parts = [
    `${AUTH_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
  ];
  if (process.env.AUTH_COOKIE_SECURE === "true") parts.push("Secure");
  return parts.join("; ");
}

export function clearCookieHeader(): string {
  return `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readCookie(req: express.Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function tokenFromRequest(req: express.Request): string | null {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.toLowerCase().startsWith("bearer ")) {
    const token = header.slice(7).trim();
    if (token) return token;
  }
  return readCookie(req, AUTH_COOKIE);
}

export function actorFromRequest(req: AuthedRequest, fallback?: unknown): string {
  if (req.authUser?.email) return req.authUser.email;
  if (typeof fallback === "string" && fallback.trim()) return fallback.trim();
  return "system";
}

const EDITOR_ROLES = new Set(["hr", "admin"]);
const ADMIN_ROLE = "admin";

export function userCanEdit(user: AuthUser | undefined): boolean {
  if (!user) return false;
  return EDITOR_ROLES.has(user.role.trim().toLowerCase());
}

export function userIsAdmin(user: AuthUser | undefined): boolean {
  if (!user) return false;
  return user.role.trim().toLowerCase() === ADMIN_ROLE;
}

export function userIsManager(user: AuthUser | undefined): boolean {
  if (!user) return false;
  return user.role.trim().toLowerCase() === "manager";
}

export function userIsHr(user: AuthUser | undefined): boolean {
  if (!user) return false;
  return user.role.trim().toLowerCase() === "hr";
}

export function requireEditor(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const authed = req as AuthedRequest;
  if (!userCanEdit(authed.authUser)) {
    res.status(403).json({
      message: "Only HR can edit or upload attendance.",
    });
    return;
  }
  next();
}

export function requireAdmin(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const authed = req as AuthedRequest;
  if (!userIsAdmin(authed.authUser)) {
    res.status(403).json({ message: "Admin permission is required." });
    return;
  }
  next();
}

export async function requireAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const token = tokenFromRequest(req);
  if (!token) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  try {
    const payload = verifyJwt(token, authSecret());
    const active = await sessionIsActive(payload.jti, payload.sub);
    if (!active) {
      res.status(401).json({ message: "Session expired. Please log in again." });
      return;
    }
    const user = await findUserById(payload.sub);
    if (!user) {
      res.status(401).json({ message: "Authentication required" });
      return;
    }
    const authed = req as AuthedRequest;
    authed.authUser = user;
    authed.authJti = payload.jti;
    next();
  } catch {
    res.status(401).json({ message: "Authentication required" });
  }
}
