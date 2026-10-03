import type express from "express";
import { verifyPassword } from "./passwords.js";
import { signJwt } from "./jwt.js";
import {
  createSession,
  deleteSession,
  findUserByEmail,
  findUserById,
  newSessionId,
  publicUser,
  setUserPassword,
} from "./users.js";
import { loadLinkedEmployeeProfile, resolveAttendanceScope } from "./attendanceScope.js";
import {
  createEmailChallenge,
  getOpenChallenge,
  resendEmailChallenge,
  verifyEmailChallengeCode,
} from "./challenges.js";
import { sendLoginOtpEmail, sendPasswordResetEmail, sendAccountSetupEmail } from "./authEmails.js";
import { logLoginAudit } from "./loginAudit.js";
import { maskEmail } from "./otp.js";
import {
  AUTH_TTL_SEC,
  authSecret,
  actorFromRequest,
  clearCookieHeader,
  cookieHeader,
  loginEmailOtpEnabled,
  type AuthedRequest,
} from "./middleware.js";

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function clientKey(req: express.Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const row = rateBuckets.get(key);
  if (!row || row.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  row.count += 1;
  return row.count <= max;
}

function issueSession(user: Awaited<ReturnType<typeof findUserById>>, res: express.Response) {
  if (!user) throw new Error("User not found");
  const jti = newSessionId();
  const ttl = AUTH_TTL_SEC;
  const token = signJwt(
    { sub: user.id, email: user.email, name: user.name, role: user.role, jti },
    authSecret(),
    ttl,
  );
  return createSession(user.id, jti, new Date(Date.now() + ttl * 1000)).then(() => {
    res.setHeader("Set-Cookie", cookieHeader(token, ttl));
    return { user: publicUser(user), token, expiresIn: ttl };
  });
}

/** Step 1: verify password and email login OTP. */
export async function handleLogin(req: express.Request, res: express.Response) {
  const ip = clientKey(req);
  if (!rateLimit(`login:${ip}`, 20, 15 * 60 * 1000)) {
    res.status(429).json({ message: "Too many login attempts. Try again later." });
    return;
  }

  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!email || !password) {
    res.status(400).json({ message: "email and password are required" });
    return;
  }

  const user = await findUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    await logLoginAudit({ email, event: "login_password_failed", ip });
    res.status(401).json({ message: "Invalid email or password" });
    return;
  }

  if (!loginEmailOtpEnabled()) {
    try {
      const sessionUser = await findUserById(user.id);
      if (!sessionUser) {
        res.status(401).json({ message: "Invalid email or password" });
        return;
      }
      const session = await issueSession(sessionUser, res);
      await logLoginAudit({
        userId: user.id,
        email: user.email,
        event: "login_success",
        ip,
        detail: "email_otp_disabled",
      });
      res.json({ ...session, otpRequired: false });
      return;
    } catch (e) {
      res.status(500).json({ message: e instanceof Error ? e.message : "Could not complete sign-in" });
      return;
    }
  }

  try {
    const { challengeId, code, expiresInSec } = await createEmailChallenge({
      userId: user.id,
      kind: "login",
      ip,
    });
    await sendLoginOtpEmail(user.email, code, Math.ceil(expiresInSec / 60));
    await logLoginAudit({ userId: user.id, email: user.email, event: "login_otp_sent", ip });
    res.json({
      challengeId,
      maskedEmail: maskEmail(user.email),
      expiresInSec,
      message: "Verification code sent to your email.",
      otpRequired: true,
    });
  } catch (e) {
    res.status(500).json({ message: e instanceof Error ? e.message : "Could not send verification code" });
  }
}

/** Step 2: verify OTP and create session. */
export async function handleLoginVerify(req: express.Request, res: express.Response) {
  const ip = clientKey(req);
  if (!rateLimit(`login-verify:${ip}`, 30, 15 * 60 * 1000)) {
    res.status(429).json({ message: "Too many attempts. Try again later." });
    return;
  }

  const challengeId = typeof req.body?.challengeId === "string" ? req.body.challengeId.trim() : "";
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!challengeId || !code) {
    res.status(400).json({ message: "challengeId and code are required" });
    return;
  }

  const verified = await verifyEmailChallengeCode(challengeId, "login", code);
  if (!verified.ok) {
    await logLoginAudit({ event: "login_otp_failed", email: "", ip, detail: verified.reason });
    const message =
      verified.reason === "locked"
        ? "Too many incorrect codes. Start sign-in again."
        : verified.reason === "expired"
          ? "Code expired. Start sign-in again."
          : "Invalid verification code.";
    res.status(401).json({ message });
    return;
  }

  const user = await findUserById(verified.userId);
  if (!user) {
    res.status(401).json({ message: "Invalid verification code." });
    return;
  }

  try {
    const session = await issueSession(user, res);
    await logLoginAudit({ userId: user.id, email: user.email, event: "login_success", ip });
    res.json(session);
  } catch (e) {
    res.status(500).json({ message: e instanceof Error ? e.message : "Could not complete sign-in" });
  }
}

export async function handleLoginResend(req: express.Request, res: express.Response) {
  const ip = clientKey(req);
  if (!rateLimit(`login-resend:${ip}`, 10, 15 * 60 * 1000)) {
    res.status(429).json({ message: "Too many resend attempts. Try again later." });
    return;
  }

  const challengeId = typeof req.body?.challengeId === "string" ? req.body.challengeId.trim() : "";
  if (!challengeId) {
    res.status(400).json({ message: "challengeId is required" });
    return;
  }

  const next = await resendEmailChallenge(challengeId, "login", ip);
  if (!next) {
    res.status(400).json({ message: "This sign-in session expired. Start again." });
    return;
  }

  try {
    await sendLoginOtpEmail(next.email, next.code, Math.ceil(next.expiresInSec / 60));
  } catch (e) {
    res.status(500).json({ message: e instanceof Error ? e.message : "Could not resend verification code" });
    return;
  }

  res.json({
    challengeId: next.challengeId,
    maskedEmail: maskEmail(next.email),
    expiresInSec: next.expiresInSec,
    message: "A new verification code was sent.",
  });
}

export async function handleForgotPassword(req: express.Request, res: express.Response) {
  const ip = clientKey(req);
  if (!rateLimit(`forgot:${ip}`, 10, 15 * 60 * 1000)) {
    res.status(429).json({ message: "Too many requests. Try again later." });
    return;
  }

  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!email) {
    res.status(400).json({ message: "email is required" });
    return;
  }

  const user = await findUserByEmail(email);
  if (user) {
    try {
      const { challengeId, code, expiresInSec } = await createEmailChallenge({
        userId: user.id,
        kind: "password_reset",
        ip,
      });
      await sendPasswordResetEmail(user.email, code, Math.ceil(expiresInSec / 60));
      await logLoginAudit({ userId: user.id, email, event: "password_reset_requested", ip });
      res.json({
        challengeId,
        maskedEmail: maskEmail(user.email),
        expiresInSec,
        message: "If an account exists for this email, a reset code has been sent.",
      });
      return;
    } catch {
      /* fall through to generic message */
    }
  }

  res.json({
    message: "If an account exists for this email, a reset code has been sent.",
  });
}

export async function handleForgotPasswordVerify(req: express.Request, res: express.Response) {
  const ip = clientKey(req);
  const challengeId = typeof req.body?.challengeId === "string" ? req.body.challengeId.trim() : "";
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";

  if (!challengeId || !code || !newPassword) {
    res.status(400).json({ message: "challengeId, code, and newPassword are required" });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ message: "newPassword must be at least 8 characters" });
    return;
  }

  const verified = await verifyEmailChallengeCode(challengeId, "password_reset", code);
  if (!verified.ok) {
    res.status(401).json({
      message:
        verified.reason === "locked"
          ? "Too many incorrect codes. Request a new reset."
          : verified.reason === "expired"
            ? "Code expired. Request a new reset."
            : "Invalid verification code.",
    });
    return;
  }

  const user = await findUserById(verified.userId);
  if (!user) {
    res.status(401).json({ message: "Invalid verification code." });
    return;
  }

  await setUserPassword(user.id, newPassword, { mustChangePassword: false, invalidateSessions: true });
  await logLoginAudit({ userId: user.id, email: user.email, event: "password_reset_completed", ip });
  res.json({ message: "Password updated. You can sign in with your new password." });
}

function appLoginBaseUrl(): string {
  return (process.env.APP_LOGIN_URL ?? "http://localhost:5173/login").trim().replace(/\/login\/?$/i, "");
}

export async function handleAccountSetupChallenge(req: express.Request, res: express.Response) {
  const challengeId = typeof req.params.challengeId === "string" ? req.params.challengeId.trim() : "";
  if (!challengeId) {
    res.status(400).json({ message: "Invalid setup link" });
    return;
  }
  const open = await getOpenChallenge(challengeId, "account_setup");
  if (!open) {
    res.status(404).json({ message: "This setup link expired. Ask HR to resend your invite." });
    return;
  }
  const user = await findUserById(open.userId);
  if (!user?.mustChangePassword) {
    res.status(400).json({ message: "This account is already set up. Sign in at the login page." });
    return;
  }
  const expiresInSec = Math.max(0, Math.floor((open.expiresAt.getTime() - Date.now()) / 1000));
  res.json({
    challengeId: open.id,
    maskedEmail: maskEmail(user.email),
    expiresInSec,
  });
}

export async function handleAccountSetupComplete(req: express.Request, res: express.Response) {
  const ip = clientKey(req);
  const challengeId = typeof req.body?.challengeId === "string" ? req.body.challengeId.trim() : "";
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";

  if (!challengeId || !code || !newPassword) {
    res.status(400).json({ message: "challengeId, code, and newPassword are required" });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ message: "newPassword must be at least 8 characters" });
    return;
  }

  const verified = await verifyEmailChallengeCode(challengeId, "account_setup", code);
  if (!verified.ok) {
    res.status(401).json({
      message:
        verified.reason === "locked"
          ? "Too many incorrect codes. Ask HR to resend your setup email."
          : verified.reason === "expired"
            ? "Code expired. Ask HR to resend your setup email."
            : "Invalid verification code.",
    });
    return;
  }

  const user = await findUserById(verified.userId);
  if (!user) {
    res.status(401).json({ message: "Invalid verification code." });
    return;
  }

  await setUserPassword(user.id, newPassword, { mustChangePassword: false, invalidateSessions: true });
  await logLoginAudit({ userId: user.id, email: user.email, event: "account_setup_completed", ip });
  res.json({ message: "Password set. You can sign in with your new password and email verification code." });
}

export async function handleAccountSetupResend(req: express.Request, res: express.Response) {
  const ip = clientKey(req);
  if (!rateLimit(`setup-resend:${ip}`, 10, 15 * 60 * 1000)) {
    res.status(429).json({ message: "Too many requests. Try again later." });
    return;
  }
  const challengeId = typeof req.body?.challengeId === "string" ? req.body.challengeId.trim() : "";
  if (!challengeId) {
    res.status(400).json({ message: "challengeId is required" });
    return;
  }
  const next = await resendEmailChallenge(challengeId, "account_setup", ip);
  if (!next) {
    res.status(400).json({ message: "This setup session expired. Ask HR to resend your invite." });
    return;
  }
  const userRow = await findUserByEmail(next.email);
  const setupUrl = `${appLoginBaseUrl()}/activate?c=${encodeURIComponent(next.challengeId)}`;
  try {
    await sendAccountSetupEmail({
      to: next.email,
      name: userRow?.name ?? next.email,
      code: next.code,
      setupUrl,
      expiresMinutes: Math.ceil(next.expiresInSec / 60),
    });
  } catch (e) {
    res.status(500).json({ message: e instanceof Error ? e.message : "Could not send email" });
    return;
  }
  res.json({
    challengeId: next.challengeId,
    maskedEmail: maskEmail(next.email),
    expiresInSec: next.expiresInSec,
    message: "A new setup code was sent to your email.",
  });
}

export async function handleChangePassword(req: express.Request, res: express.Response) {
  const authed = req as AuthedRequest;
  if (!authed.authUser) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  const currentPassword =
    typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  if (!currentPassword || !newPassword) {
    res.status(400).json({ message: "currentPassword and newPassword are required" });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ message: "newPassword must be at least 8 characters" });
    return;
  }

  const row = await findUserByEmail(authed.authUser.email);
  if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
    res.status(401).json({ message: "Current password is incorrect" });
    return;
  }

  await setUserPassword(row.id, newPassword, {
    mustChangePassword: false,
    invalidateSessions: true,
    keepSessionJti: authed.authJti,
  });

  const updated = await findUserById(row.id);
  if (!updated) {
    res.status(500).json({ message: "Could not update password" });
    return;
  }

  await logLoginAudit({
    userId: updated.id,
    email: updated.email,
    event: "password_changed",
    ip: clientKey(req),
  });

  res.json({ user: publicUser(updated), message: "Password updated." });
}

export async function handleLogout(req: express.Request, res: express.Response) {
  const authed = req as AuthedRequest;
  if (authed.authJti) await deleteSession(authed.authJti);
  res.setHeader("Set-Cookie", clearCookieHeader());
  res.json({ ok: true });
}

export function handleMe(req: express.Request, res: express.Response) {
  const authed = req as AuthedRequest;
  if (!authed.authUser) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  void Promise.all([
    resolveAttendanceScope(authed.authUser),
    loadLinkedEmployeeProfile(authed.authUser.email),
  ])
    .then(([scope, employeeProfile]) => {
      res.json({
        user: publicUser(authed.authUser!),
        attendanceScope: {
          mode: scope.mode,
          employeeIds: scope.restrictToEmployeeIds,
        },
        employeeProfile,
        loginOtpRequired: loginEmailOtpEnabled(),
      });
    })
    .catch((e) => {
      res.status(500).json({ message: e instanceof Error ? e.message : "Failed to load profile" });
    });
}

export { actorFromRequest };
export type { AuthedRequest };
