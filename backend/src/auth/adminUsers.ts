import { randomBytes } from "crypto";
import { query, queryOne } from "../db/index.js";
import { sendAccountSetupEmail, sendWelcomeEmail } from "./authEmails.js";
import { createEmailChallenge } from "./challenges.js";
import { hashPassword } from "./passwords.js";
import { deleteUserSessions, type AuthUser } from "./users.js";

const ALLOWED_ROLES = new Set(["admin", "hr", "manager", "viewer"]);

export type AdminUserListItem = AuthUser & {
  createdAt: string;
  updatedAt: string;
};

function normalizeRole(role: string): string {
  return role.trim().toLowerCase();
}

function assertAllowedRole(role: string): string {
  const normalized = normalizeRole(role);
  if (!ALLOWED_ROLES.has(normalized)) {
    throw Object.assign(new Error("role must be admin, hr, manager, or employee"), { status: 400 });
  }
  return normalized;
}

function mapAdminUser(row: {
  id: number;
  email: string;
  name: string;
  role: string;
  must_change_password: boolean;
  createdAt?: string;
  updatedAt?: string;
}): AdminUserListItem {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    mustChangePassword: Boolean(row.must_change_password),
    createdAt: row.createdAt ?? "",
    updatedAt: row.updatedAt ?? "",
  };
}

export async function listAppUsers(): Promise<AdminUserListItem[]> {
  const rows = await query<{
    id: number;
    email: string;
    name: string;
    role: string;
    must_change_password: boolean;
    createdAt: string;
    updatedAt: string;
  }>(
    `SELECT id, email, name, role, must_change_password,
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM users
     ORDER BY lower(email)`,
  );
  return rows.map(mapAdminUser);
}

function randomInternalPassword(): string {
  return randomBytes(24).toString("base64url");
}

function appLoginBaseUrl(): string {
  return (process.env.APP_LOGIN_URL ?? "http://localhost:5173/login").trim().replace(/\/login\/?$/i, "");
}

export async function createAppUser(input: {
  email: string;
  name: string;
  password?: string;
  role: string;
  sendWelcome?: boolean;
  mustChangePassword?: boolean;
}): Promise<AuthUser> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const role = assertAllowedRole(input.role);
  const inviteMode = !input.password?.trim();

  if (!email || !email.includes("@")) {
    throw Object.assign(new Error("A valid email is required"), { status: 400 });
  }
  if (!name) {
    throw Object.assign(new Error("name is required"), { status: 400 });
  }
  if (!inviteMode && input.password!.length < 8) {
    throw Object.assign(new Error("password must be at least 8 characters"), { status: 400 });
  }

  const existing = await queryOne<{ id: number }>(`SELECT id FROM users WHERE lower(email) = lower($1)`, [
    email,
  ]);
  if (existing) {
    throw Object.assign(new Error("A user with this email already exists"), { status: 409 });
  }

  const password = inviteMode ? randomInternalPassword() : input.password!.trim();
  const passwordHash = await hashPassword(password);
  const mustChangePassword = inviteMode ? true : (input.mustChangePassword ?? true);
  const row = await queryOne<{
    id: number;
    email: string;
    name: string;
    role: string;
    must_change_password: boolean;
  }>(
    `INSERT INTO users (email, name, password_hash, role, must_change_password)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, name, role, must_change_password`,
    [email, name, passwordHash, role, mustChangePassword],
  );
  if (!row) throw new Error("Failed to create user");

  if (inviteMode) {
    try {
      const { challengeId, code, expiresInSec } = await createEmailChallenge({
        userId: row.id,
        kind: "account_setup",
      });
      const setupUrl = `${appLoginBaseUrl()}/activate?c=${encodeURIComponent(challengeId)}`;
      await sendAccountSetupEmail({
        to: email,
        name,
        code,
        setupUrl,
        expiresMinutes: Math.ceil(expiresInSec / 60),
      });
    } catch (e) {
      console.warn("[auth] account setup email failed", e instanceof Error ? e.message : e);
    }
  } else if (input.sendWelcome !== false) {
    try {
      await sendWelcomeEmail({
        to: email,
        name,
        role,
        temporaryPassword: password,
      });
    } catch (e) {
      console.warn("[auth] welcome email failed", e instanceof Error ? e.message : e);
    }
  }

  return mapAdminUser(row);
}

export async function updateAppUser(
  id: number,
  patch: { email?: string; name?: string; role?: string; password?: string },
  actorId: number,
): Promise<AuthUser | null> {
  const existing = await queryOne<{
    id: number;
    email: string;
    name: string;
    role: string;
    password_hash: string;
    must_change_password: boolean;
  }>(`SELECT id, email, name, role, password_hash, must_change_password FROM users WHERE id = $1`, [id]);
  if (!existing) return null;

  const email =
    patch.email !== undefined ? patch.email.trim().toLowerCase() : existing.email.trim().toLowerCase();
  const name = patch.name !== undefined ? patch.name.trim() : existing.name;
  const role = patch.role !== undefined ? assertAllowedRole(patch.role) : normalizeRole(existing.role);

  if (!email || !email.includes("@")) {
    throw Object.assign(new Error("A valid email is required"), { status: 400 });
  }
  if (!name) {
    throw Object.assign(new Error("name is required"), { status: 400 });
  }

  if (email !== existing.email.trim().toLowerCase()) {
    const clash = await queryOne<{ id: number }>(
      `SELECT id FROM users WHERE lower(email) = lower($1) AND id <> $2`,
      [email, id],
    );
    if (clash) {
      throw Object.assign(new Error("A user with this email already exists"), { status: 409 });
    }
  }

  if (
    normalizeRole(existing.role) === "admin" &&
    role !== "admin" &&
    id === actorId
  ) {
    throw Object.assign(new Error("You cannot remove your own admin role"), { status: 400 });
  }

  if (normalizeRole(existing.role) === "admin" && role !== "admin") {
    const adminCount = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM users WHERE lower(role) = 'admin'`,
    );
    if ((adminCount?.n ?? 0) <= 1) {
      throw Object.assign(new Error("Cannot remove the last admin account"), { status: 400 });
    }
  }

  let passwordHash = existing.password_hash;
  let mustChangePassword = Boolean(existing.must_change_password);
  if (patch.password !== undefined) {
    if (!patch.password || patch.password.length < 8) {
      throw Object.assign(new Error("password must be at least 8 characters"), { status: 400 });
    }
    passwordHash = await hashPassword(patch.password);
    mustChangePassword = true;
    await deleteUserSessions(id);
  }

  const updated = await queryOne<{
    id: number;
    email: string;
    name: string;
    role: string;
    must_change_password: boolean;
  }>(
    `UPDATE users
     SET email = $1, name = $2, role = $3, password_hash = $4,
         must_change_password = $5, updated_at = NOW()
     WHERE id = $6
     RETURNING id, email, name, role, must_change_password`,
    [email, name, role, passwordHash, mustChangePassword, id],
  );
  return updated ? mapAdminUser(updated) : null;
}

export async function deleteAppUser(
  id: number,
  actorId: number,
): Promise<{ ok: true } | { ok: false; message: string; status: number }> {
  if (id === actorId) {
    return { ok: false, message: "You cannot delete your own account", status: 400 };
  }

  const existing = await queryOne<AuthUser>(`SELECT id, email, name, role FROM users WHERE id = $1`, [id]);
  if (!existing) {
    return { ok: false, message: "User not found", status: 404 };
  }

  if (normalizeRole(existing.role) === "admin") {
    const adminCount = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM users WHERE lower(role) = 'admin'`,
    );
    if ((adminCount?.n ?? 0) <= 1) {
      return { ok: false, message: "Cannot delete the last admin account", status: 400 };
    }
  }

  await deleteUserSessions(id);
  await query(`DELETE FROM users WHERE id = $1`, [id]);
  return { ok: true };
}
