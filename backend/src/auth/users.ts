import { randomUUID } from "crypto";
import { query, queryOne } from "../db/index.js";
import { hashPassword } from "./passwords.js";

export type AuthUser = {
  id: number;
  email: string;
  name: string;
  role: string;
  mustChangePassword: boolean;
};

type UserRow = AuthUser & { password_hash: string; account_disabled: boolean };

function mapUser(row: {
  id: number;
  email: string;
  name: string;
  role: string;
  must_change_password?: boolean | null;
}): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    mustChangePassword: Boolean(row.must_change_password),
  };
}

export async function findUserByEmail(email: string): Promise<UserRow | undefined> {
  const row = await queryOne<{
    id: number;
    email: string;
    name: string;
    role: string;
    password_hash: string;
    must_change_password: boolean;
    account_disabled: boolean;
  }>(
    `SELECT id, email, name, role, password_hash, must_change_password, account_disabled
     FROM users WHERE lower(email) = lower($1)`,
    [email.trim()],
  );
  if (!row) return undefined;
  if (row.account_disabled) return undefined;
  return { ...mapUser(row), password_hash: row.password_hash, account_disabled: row.account_disabled };
}

export async function findUserById(id: number): Promise<AuthUser | undefined> {
  const row = await queryOne<{
    id: number;
    email: string;
    name: string;
    role: string;
    must_change_password: boolean;
    account_disabled: boolean;
  }>(`SELECT id, email, name, role, must_change_password, account_disabled FROM users WHERE id = $1`, [id]);
  if (!row || row.account_disabled) return undefined;
  return row ? mapUser(row) : undefined;
}

export async function createSession(userId: number, jti: string, expiresAt: Date) {
  await query(
    `INSERT INTO auth_sessions (id, user_id, expires_at) VALUES ($1, $2, $3)`,
    [jti, userId, expiresAt.toISOString()],
  );
}

export async function sessionIsActive(jti: string, userId: number): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM auth_sessions WHERE id = $1 AND user_id = $2 AND expires_at > NOW()`,
    [jti, userId],
  );
  return Boolean(row);
}

export async function deleteSession(jti: string) {
  await query(`DELETE FROM auth_sessions WHERE id = $1`, [jti]);
}

export async function deleteUserSessions(userId: number) {
  await query(`DELETE FROM auth_sessions WHERE user_id = $1`, [userId]);
}

export async function deleteOtherUserSessions(userId: number, keepJti: string) {
  await query(`DELETE FROM auth_sessions WHERE user_id = $1 AND id <> $2`, [userId, keepJti]);
}

export function publicUser(user: AuthUser): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  };
}

export async function setUserPassword(
  userId: number,
  password: string,
  opts?: { mustChangePassword?: boolean; invalidateSessions?: boolean; keepSessionJti?: string },
): Promise<void> {
  const passwordHash = await hashPassword(password);
  const mustChange = opts?.mustChangePassword ?? false;
  await query(
    `UPDATE users
     SET password_hash = $1, must_change_password = $2, updated_at = NOW()
     WHERE id = $3`,
    [passwordHash, mustChange, userId],
  );
  if (opts?.invalidateSessions) {
    if (opts.keepSessionJti) {
      await deleteOtherUserSessions(userId, opts.keepSessionJti);
    } else {
      await deleteUserSessions(userId);
    }
  }
}

/** Create the first HR login if the users table is empty. */
export async function bootstrapFirstUser(): Promise<void> {
  const existing = await queryOne<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users`);
  if ((existing?.n ?? 0) > 0) return;

  const email = (process.env.AUTH_BOOTSTRAP_EMAIL ?? "hr@parmarketing.agency").trim().toLowerCase();
  const password = process.env.AUTH_BOOTSTRAP_PASSWORD ?? "ChangeMe123!";
  const name = process.env.AUTH_BOOTSTRAP_NAME ?? "HR Admin";
  const usingDefaultPassword = !process.env.AUTH_BOOTSTRAP_PASSWORD;
  const passwordHash = await hashPassword(password);
  const mustChange = process.env.AUTH_BOOTSTRAP_FORCE_PASSWORD_CHANGE !== "false";
  await query(
    `INSERT INTO users (email, name, password_hash, role, must_change_password)
     VALUES ($1, $2, $3, 'admin', $4)`,
    [email, name, passwordHash, mustChange],
  );
  console.log(`Created first login user: ${email}`);
  if (usingDefaultPassword) {
    console.warn(
      "AUTH_BOOTSTRAP_PASSWORD was not set; first login password is ChangeMe123! Change it before any real use.",
    );
  }
}

export function newSessionId(): string {
  return randomUUID();
}
