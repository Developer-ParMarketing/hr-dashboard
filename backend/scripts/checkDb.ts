/**
 * Quick Postgres connectivity check (no Docker required if DATABASE_URL is correct).
 * Run: cd backend && npx tsx scripts/checkDb.ts
 */
import { initDb, queryOne } from "../src/db/index.js";

async function main() {
  await initDb();
  const row = await queryOne<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users`);
  console.log("Database OK.");
  console.log(`Users in database: ${row?.n ?? 0}`);
}

main().catch((e) => {
  console.error("\nDatabase connection failed.\n");
  console.error(e instanceof Error ? e.message : e);
  console.error(`
Fix backend/.env DATABASE_URL:

  Local Postgres (Mac Homebrew, apt, etc.):
    createdb hr_automation
    DATABASE_URL=postgres://YOUR_MAC_USERNAME@localhost:5432/hr_automation

  Managed Postgres (Neon, RDS, …):
    DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/hr_automation?sslmode=require
    PGSSL=true
`);
  process.exit(1);
});
