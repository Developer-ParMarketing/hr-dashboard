import { query, queryOne } from "../db/index.js";
import { newSessionId } from "./users.js";
import { generateOtpCode, hashOtpCode, OTP_MAX_ATTEMPTS, OTP_TTL_SEC, type ChallengeKind } from "./otp.js";

export type EmailChallenge = {
  id: string;
  userId: number;
  kind: ChallengeKind;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
};

export async function invalidateOpenChallenges(userId: number, kind: ChallengeKind): Promise<void> {
  await query(
    `UPDATE auth_email_challenges
     SET consumed_at = NOW()
     WHERE user_id = $1 AND kind = $2 AND consumed_at IS NULL`,
    [userId, kind],
  );
}

export async function createEmailChallenge(input: {
  userId: number;
  kind: ChallengeKind;
  ip?: string | null;
}): Promise<{ challengeId: string; code: string; expiresInSec: number }> {
  await invalidateOpenChallenges(input.userId, input.kind);
  const challengeId = newSessionId();
  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_SEC * 1000);
  await query(
    `INSERT INTO auth_email_challenges (id, user_id, kind, code_hash, expires_at, ip)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [challengeId, input.userId, input.kind, hashOtpCode(challengeId, code), expiresAt.toISOString(), input.ip ?? null],
  );
  return { challengeId, code, expiresInSec: OTP_TTL_SEC };
}

export async function getOpenChallenge(
  challengeId: string,
  kind: ChallengeKind,
): Promise<EmailChallenge | null> {
  const row = await queryOne<{
    id: string;
    user_id: number;
    kind: string;
    expires_at: Date;
    attempts: number;
    consumed_at: Date | null;
  }>(
    `SELECT id, user_id, kind, expires_at, attempts, consumed_at
     FROM auth_email_challenges
     WHERE id = $1 AND kind = $2`,
    [challengeId, kind],
  );
  if (!row || row.consumed_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind as ChallengeKind,
    expiresAt: new Date(row.expires_at),
    attempts: row.attempts,
    consumedAt: row.consumed_at,
  };
}

export async function verifyEmailChallengeCode(
  challengeId: string,
  kind: ChallengeKind,
  code: string,
): Promise<{ ok: true; userId: number } | { ok: false; reason: "invalid" | "expired" | "locked" }> {
  const row = await queryOne<{
    user_id: number;
    code_hash: string;
    expires_at: Date;
    attempts: number;
    consumed_at: Date | null;
  }>(
    `SELECT user_id, code_hash, expires_at, attempts, consumed_at
     FROM auth_email_challenges
     WHERE id = $1 AND kind = $2`,
    [challengeId, kind],
  );
  if (!row || row.consumed_at) return { ok: false, reason: "expired" };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: "expired" };
  if (row.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: "locked" };

  const { verifyOtpCode } = await import("./otp.js");
  if (!verifyOtpCode(challengeId, code, row.code_hash)) {
    await query(
      `UPDATE auth_email_challenges SET attempts = attempts + 1 WHERE id = $1`,
      [challengeId],
    );
    return { ok: false, reason: "invalid" };
  }

  await query(`UPDATE auth_email_challenges SET consumed_at = NOW() WHERE id = $1`, [challengeId]);
  return { ok: true, userId: row.user_id };
}

export async function resendEmailChallenge(
  challengeId: string,
  kind: ChallengeKind,
  ip?: string | null,
): Promise<{ challengeId: string; code: string; expiresInSec: number; email: string } | null> {
  const open = await getOpenChallenge(challengeId, kind);
  if (!open) return null;
  const user = await queryOne<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [open.userId]);
  if (!user?.email) return null;
  const next = await createEmailChallenge({ userId: open.userId, kind, ip });
  return { ...next, email: user.email };
}
