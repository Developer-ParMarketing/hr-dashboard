import { query } from "../db/index.js";

export async function logLoginAudit(input: {
  userId?: number | null;
  email: string;
  event: string;
  ip?: string | null;
  detail?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO login_audit (user_id, email, event, ip, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      input.userId ?? null,
      input.email.trim().toLowerCase(),
      input.event,
      input.ip ?? null,
      input.detail ?? null,
    ],
  );
}
