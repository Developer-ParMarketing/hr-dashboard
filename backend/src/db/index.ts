import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Pool, types } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Keep DATE as YYYY-MM-DD (avoid timezone shifts from JS Date). */
types.setTypeParser(1082, (val) => val);
/** NUMERIC as number for hours/salary fields. */
types.setTypeParser(1700, (val) => (val == null || val === "" ? null : Number(val)));

function loadDotEnv() {
  const apiRoot = path.join(__dirname, "..", "..");
  const envPath = path.join(apiRoot, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = val;
  }
}

loadDotEnv();
const SCHEMA_PATH = path.join(__dirname, "schema.sql");
const SCHEMA_VERSION = 42;

let pool: pg.Pool | null = null;
let ready: Promise<pg.Pool> | null = null;

function connectionString(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL is required. Example: postgres://hr:hr@localhost:5432/hr_automation",
    );
  }
  return url;
}

function sslOption(url: string): pg.PoolConfig["ssl"] {
  const sslMode = /sslmode=require/i.test(url) || process.env.PGSSL === "true";
  if (!sslMode) return undefined;
  return { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED === "true" };
}

export function databaseLabel(): string {
  try {
    const raw = connectionString();
    const u = new URL(raw.replace(/^postgres(ql)?:/i, "http:"));
    return `${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return "(postgresql)";
  }
}

export function getPool(): pg.Pool {
  if (pool) return pool;
  const url = connectionString();
  pool = new Pool({
    connectionString: url,
    ssl: sslOption(url),
    max: Number.parseInt(process.env.PG_POOL_MAX ?? "10", 10) || 10,
  });
  return pool;
}

/** Lightweight DB check for load balancers (/health/ready). */
export async function pingDatabase(): Promise<void> {
  await getPool().query("SELECT 1");
}

export async function initDb(): Promise<pg.Pool> {
  if (ready) return ready;
  ready = (async () => {
    const p = getPool();
    const client = await p.connect();
    try {
      await client.query(fs.readFileSync(SCHEMA_PATH, "utf8"));
      const applied = await client.query<{ version: number }>(
        "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1",
      );
      let current = Number(applied.rows[0]?.version ?? 0);
      if (current < 1) {
        await client.query("INSERT INTO schema_migrations (version) VALUES (1) ON CONFLICT DO NOTHING");
        current = 1;
      }
      if (current < 2) {
        await client.query(
          "ALTER TABLE daily_attendance ADD COLUMN IF NOT EXISTS daily_status TEXT",
        );
        await client.query("INSERT INTO schema_migrations (version) VALUES (2) ON CONFLICT DO NOTHING");
        current = 2;
      }
      if (current < 3) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS notification_log (
            id SERIAL PRIMARY KEY,
            kind TEXT NOT NULL,
            employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            period_key TEXT NOT NULL,
            to_email TEXT,
            status TEXT NOT NULL DEFAULT 'sent',
            error TEXT,
            sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (kind, employee_id, period_key)
          )
        `);
        await client.query(
          "CREATE INDEX IF NOT EXISTS idx_notification_kind_period ON notification_log (kind, period_key)",
        );
        await client.query("INSERT INTO schema_migrations (version) VALUES (3) ON CONFLICT DO NOTHING");
        current = 3;
      }
      if (current < 4) {
        await client.query(`
          CREATE OR REPLACE FUNCTION prevent_approved_weekly_mutation()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            IF TG_OP = 'DELETE' THEN
              IF LOWER(TRIM(OLD.status)) IN ('approved', 'locked') THEN
                RAISE EXCEPTION 'Approved weekly attendance cannot be modified'
                  USING ERRCODE = 'restrict_violation';
              END IF;
              RETURN OLD;
            END IF;
            IF LOWER(TRIM(OLD.status)) IN ('approved', 'locked') THEN
              IF LOWER(TRIM(COALESCE(NEW.status, ''))) NOT IN ('approved', 'locked')
                 OR NEW.total_hours IS DISTINCT FROM OLD.total_hours
                 OR NEW.required_hours IS DISTINCT FROM OLD.required_hours
                 OR NEW.deficit_hours IS DISTINCT FROM OLD.deficit_hours
                 OR NEW.deduction IS DISTINCT FROM OLD.deduction
                 OR NEW.week_start IS DISTINCT FROM OLD.week_start
                 OR NEW.week_end IS DISTINCT FROM OLD.week_end
                 OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
              THEN
                RAISE EXCEPTION 'Approved weekly attendance cannot be modified'
                  USING ERRCODE = 'restrict_violation';
              END IF;
            END IF;
            RETURN NEW;
          END;
          $$;

          DROP TRIGGER IF EXISTS trg_weekly_approved_lock ON weekly_attendance;
          CREATE TRIGGER trg_weekly_approved_lock
            BEFORE UPDATE OR DELETE ON weekly_attendance
            FOR EACH ROW
            EXECUTE PROCEDURE prevent_approved_weekly_mutation();

          CREATE OR REPLACE FUNCTION prevent_daily_edit_when_week_approved()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          DECLARE
            week_status TEXT;
            emp_id INTEGER;
            day DATE;
          BEGIN
            IF TG_OP = 'DELETE' THEN
              emp_id := OLD.employee_id;
              day := OLD.attendance_date;
            ELSE
              emp_id := NEW.employee_id;
              day := NEW.attendance_date;
            END IF;

            SELECT status INTO week_status
            FROM weekly_attendance
            WHERE employee_id = emp_id
              AND day BETWEEN week_start AND week_end
            ORDER BY id DESC
            LIMIT 1;

            IF week_status IS NOT NULL AND LOWER(TRIM(week_status)) IN ('approved', 'locked') THEN
              IF TG_OP = 'DELETE' OR TG_OP = 'INSERT' THEN
                RAISE EXCEPTION 'Approved weekly attendance cannot be modified'
                  USING ERRCODE = 'restrict_violation';
              END IF;
              IF TG_OP = 'UPDATE' AND (
                   NEW.working_hours IS DISTINCT FROM OLD.working_hours
                OR NEW.in_time IS DISTINCT FROM OLD.in_time
                OR NEW.out_time IS DISTINCT FROM OLD.out_time
                OR NEW.status_token IS DISTINCT FROM OLD.status_token
                OR NEW.daily_status IS DISTINCT FROM OLD.daily_status
                OR NEW.late IS DISTINCT FROM OLD.late
                OR NEW.late_minutes IS DISTINCT FROM OLD.late_minutes
                OR NEW.note IS DISTINCT FROM OLD.note
              ) THEN
                RAISE EXCEPTION 'Approved weekly attendance cannot be modified'
                  USING ERRCODE = 'restrict_violation';
              END IF;
            END IF;

            IF TG_OP = 'DELETE' THEN
              RETURN OLD;
            END IF;
            RETURN NEW;
          END;
          $$;

          DROP TRIGGER IF EXISTS trg_daily_week_approved_lock ON daily_attendance;
          CREATE TRIGGER trg_daily_week_approved_lock
            BEFORE INSERT OR UPDATE OR DELETE ON daily_attendance
            FOR EACH ROW
            EXECUTE PROCEDURE prevent_daily_edit_when_week_approved();
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (4) ON CONFLICT DO NOTHING");
        current = 4;
      }
      if (current < 5) {
        await client.query(`
          CREATE OR REPLACE FUNCTION prevent_approved_weekly_mutation()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            IF LOWER(TRIM(OLD.status)) IN ('approved', 'locked') THEN
              IF LOWER(TRIM(COALESCE(NEW.status, ''))) NOT IN ('approved', 'locked')
                 OR NEW.total_hours IS DISTINCT FROM OLD.total_hours
                 OR NEW.required_hours IS DISTINCT FROM OLD.required_hours
                 OR NEW.deficit_hours IS DISTINCT FROM OLD.deficit_hours
                 OR NEW.deduction IS DISTINCT FROM OLD.deduction
                 OR NEW.week_start IS DISTINCT FROM OLD.week_start
                 OR NEW.week_end IS DISTINCT FROM OLD.week_end
                 OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
              THEN
                RAISE EXCEPTION 'Approved weekly attendance cannot be modified'
                  USING ERRCODE = 'restrict_violation';
              END IF;
            END IF;
            RETURN NEW;
          END;
          $$;

          DROP TRIGGER IF EXISTS trg_weekly_approved_lock ON weekly_attendance;
          CREATE TRIGGER trg_weekly_approved_lock
            BEFORE UPDATE ON weekly_attendance
            FOR EACH ROW
            EXECUTE PROCEDURE prevent_approved_weekly_mutation();

          CREATE OR REPLACE FUNCTION prevent_daily_edit_when_week_approved()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          DECLARE
            week_status TEXT;
          BEGIN
            SELECT status INTO week_status
            FROM weekly_attendance
            WHERE employee_id = NEW.employee_id
              AND NEW.attendance_date BETWEEN week_start AND week_end
            ORDER BY id DESC
            LIMIT 1;

            IF week_status IS NOT NULL AND LOWER(TRIM(week_status)) IN ('approved', 'locked') THEN
              IF TG_OP = 'INSERT' THEN
                RAISE EXCEPTION 'Approved weekly attendance cannot be modified'
                  USING ERRCODE = 'restrict_violation';
              END IF;
              IF TG_OP = 'UPDATE' AND (
                   NEW.working_hours IS DISTINCT FROM OLD.working_hours
                OR NEW.in_time IS DISTINCT FROM OLD.in_time
                OR NEW.out_time IS DISTINCT FROM OLD.out_time
                OR NEW.status_token IS DISTINCT FROM OLD.status_token
                OR NEW.daily_status IS DISTINCT FROM OLD.daily_status
                OR NEW.late IS DISTINCT FROM OLD.late
                OR NEW.late_minutes IS DISTINCT FROM OLD.late_minutes
                OR NEW.note IS DISTINCT FROM OLD.note
              ) THEN
                RAISE EXCEPTION 'Approved weekly attendance cannot be modified'
                  USING ERRCODE = 'restrict_violation';
              END IF;
            END IF;
            RETURN NEW;
          END;
          $$;

          DROP TRIGGER IF EXISTS trg_daily_week_approved_lock ON daily_attendance;
          CREATE TRIGGER trg_daily_week_approved_lock
            BEFORE INSERT OR UPDATE ON daily_attendance
            FOR EACH ROW
            EXECUTE PROCEDURE prevent_daily_edit_when_week_approved();
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (5) ON CONFLICT DO NOTHING");
        current = 5;
      }
      if (current < 6) {
        await client.query(`
          ALTER TABLE daily_attendance ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'calculated';

          CREATE TABLE IF NOT EXISTS daily_attendance_raw (
            id SERIAL PRIMARY KEY,
            employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            attendance_date DATE NOT NULL,
            in_time TEXT,
            out_time TEXT,
            working_hours NUMERIC,
            late INTEGER NOT NULL DEFAULT 0,
            late_minutes INTEGER,
            source TEXT NOT NULL DEFAULT 'pdf',
            status_token TEXT,
            daily_status TEXT,
            note TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (employee_id, attendance_date)
          );
          CREATE INDEX IF NOT EXISTS idx_daily_raw_employee_date ON daily_attendance_raw (employee_id, attendance_date);

          CREATE TABLE IF NOT EXISTS daily_attendance_edits (
            id SERIAL PRIMARY KEY,
            employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            attendance_date DATE NOT NULL,
            patch JSONB NOT NULL DEFAULT '{}'::jsonb,
            actor TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (employee_id, attendance_date)
          );
          CREATE INDEX IF NOT EXISTS idx_daily_edits_employee_date ON daily_attendance_edits (employee_id, attendance_date);

          ALTER TABLE weekly_attendance ADD COLUMN IF NOT EXISTS hr_deduction NUMERIC;
          ALTER TABLE weekly_attendance ADD COLUMN IF NOT EXISTS approved_snapshot JSONB;

          INSERT INTO daily_attendance_raw (
            employee_id, attendance_date, in_time, out_time, working_hours, late, late_minutes,
            source, status_token, daily_status, note, created_at, updated_at
          )
          SELECT employee_id, attendance_date, in_time, out_time, working_hours, late, late_minutes,
                 CASE WHEN source = 'manual' THEN 'pdf' ELSE source END,
                 status_token, daily_status, note, created_at, updated_at
          FROM daily_attendance
          ON CONFLICT (employee_id, attendance_date) DO NOTHING;

          INSERT INTO daily_attendance_edits (employee_id, attendance_date, patch, actor, created_at, updated_at)
          SELECT employee_id, attendance_date,
                 jsonb_strip_nulls(jsonb_build_object(
                   'in_time', in_time,
                   'out_time', out_time,
                   'working_hours', working_hours,
                   'late', late,
                   'late_minutes', late_minutes,
                   'status_token', status_token,
                   'daily_status', daily_status,
                   'note', note
                 )),
                 'backfill', created_at, updated_at
          FROM daily_attendance
          WHERE source = 'manual'
          ON CONFLICT (employee_id, attendance_date) DO NOTHING;

          UPDATE daily_attendance d
          SET origin = 'approved'
          FROM weekly_attendance w
          WHERE d.employee_id = w.employee_id
            AND d.attendance_date BETWEEN w.week_start AND w.week_end
            AND LOWER(TRIM(w.status)) IN ('approved', 'locked');

          UPDATE daily_attendance SET origin = 'hr_edit'
          WHERE source = 'manual' AND origin <> 'approved';
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (6) ON CONFLICT DO NOTHING");
        current = 6;
      }
      if (current < 7) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL DEFAULT '',
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'hr',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE TABLE IF NOT EXISTS auth_sessions (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions (user_id);
          CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions (expires_at);
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (7) ON CONFLICT DO NOTHING");
        current = 7;
      }
      if (current < 8) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS upload_history (
            id SERIAL PRIMARY KEY,
            request_id TEXT,
            file_name TEXT NOT NULL DEFAULT '',
            file_size INTEGER,
            report_type TEXT NOT NULL DEFAULT 'monthly',
            report_year INTEGER NOT NULL,
            report_month INTEGER NOT NULL CHECK (report_month >= 1 AND report_month <= 12),
            company TEXT,
            actor TEXT,
            employee_count INTEGER,
            daily_upserted INTEGER,
            processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_upload_history_processed ON upload_history (processed_at DESC);
          CREATE INDEX IF NOT EXISTS idx_upload_history_period ON upload_history (report_year, report_month, company);
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (8) ON CONFLICT DO NOTHING");
        current = 8;
      }
      if (current < 9) {
        await client.query(`
          ALTER TABLE upload_history ADD COLUMN IF NOT EXISTS report_day INTEGER;
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (9) ON CONFLICT DO NOTHING");
        current = 9;
      }
      if (current < 10) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS salary_workbooks (
            id SERIAL PRIMARY KEY,
            year INTEGER NOT NULL,
            month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
            company TEXT NOT NULL DEFAULT 'PM',
            file_name TEXT NOT NULL,
            file_data BYTEA NOT NULL,
            upload_id TEXT NOT NULL UNIQUE,
            rows_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            total_rows INTEGER NOT NULL DEFAULT 0,
            matched_rows INTEGER NOT NULL DEFAULT 0,
            error_rows INTEGER NOT NULL DEFAULT 0,
            uploaded_by TEXT,
            uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (year, month, company)
          );
          CREATE INDEX IF NOT EXISTS idx_salary_workbooks_period ON salary_workbooks (year, month, company);
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (10) ON CONFLICT DO NOTHING");
        current = 10;
      }
      if (current < 11) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS manager_employee_assignments (
            id SERIAL PRIMARY KEY,
            manager_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            assigned_by TEXT,
            assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (employee_id)
          );
          CREATE INDEX IF NOT EXISTS idx_manager_assignments_manager
            ON manager_employee_assignments (manager_user_id);
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (11) ON CONFLICT DO NOTHING");
        current = 11;
      }
      if (current < 12) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS salary_workbook_history (
            id SERIAL PRIMARY KEY,
            year INTEGER NOT NULL,
            month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
            company TEXT NOT NULL DEFAULT 'PM',
            file_name TEXT NOT NULL,
            file_data BYTEA NOT NULL,
            upload_id TEXT NOT NULL UNIQUE,
            rows_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            total_rows INTEGER NOT NULL DEFAULT 0,
            matched_rows INTEGER NOT NULL DEFAULT 0,
            error_rows INTEGER NOT NULL DEFAULT 0,
            uploaded_by TEXT,
            uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_salary_workbook_history_period
            ON salary_workbook_history (year, month, company, uploaded_at DESC);
        `);
        await client.query(`
          INSERT INTO salary_workbook_history (
            year, month, company, file_name, file_data, upload_id, rows_json,
            total_rows, matched_rows, error_rows, uploaded_by, uploaded_at
          )
          SELECT
            year, month, company, file_name, file_data, upload_id, rows_json,
            total_rows, matched_rows, error_rows, uploaded_by, uploaded_at
          FROM salary_workbooks
          ON CONFLICT (upload_id) DO NOTHING
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (12) ON CONFLICT DO NOTHING");
        current = 12;
      }
      if (current < 13) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS salary_sheet_rows (
            id SERIAL PRIMARY KEY,
            year INTEGER NOT NULL,
            month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
            company TEXT NOT NULL DEFAULT 'PM',
            employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            in_hand NUMERIC NOT NULL DEFAULT 0,
            pf_employee NUMERIC NOT NULL DEFAULT 0,
            esi_employee NUMERIC NOT NULL DEFAULT 0,
            pt NUMERIC NOT NULL DEFAULT 0,
            gratuity NUMERIC NOT NULL DEFAULT 0,
            employer_pf NUMERIC NOT NULL DEFAULT 0,
            employer_pf_arr NUMERIC NOT NULL DEFAULT 0,
            employer_esi NUMERIC NOT NULL DEFAULT 0,
            other_earning NUMERIC NOT NULL DEFAULT 0,
            increment NUMERIC NOT NULL DEFAULT 0,
            updated_by TEXT,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (year, month, company, employee_id)
          );
          CREATE INDEX IF NOT EXISTS idx_salary_sheet_rows_period
            ON salary_sheet_rows (year, month, company);
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (13) ON CONFLICT DO NOTHING");
        current = 13;
      }
      if (current < 14) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS salary_base_profiles (
            id SERIAL PRIMARY KEY,
            company TEXT NOT NULL DEFAULT 'PM',
            employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            in_hand NUMERIC NOT NULL DEFAULT 0,
            pf_employee NUMERIC NOT NULL DEFAULT 0,
            esi_employee NUMERIC NOT NULL DEFAULT 0,
            pt NUMERIC NOT NULL DEFAULT 0,
            gratuity NUMERIC NOT NULL DEFAULT 0,
            employer_pf NUMERIC NOT NULL DEFAULT 0,
            employer_pf_arr NUMERIC NOT NULL DEFAULT 0,
            employer_esi NUMERIC NOT NULL DEFAULT 0,
            updated_by TEXT,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (company, employee_id)
          );
          CREATE INDEX IF NOT EXISTS idx_salary_base_profiles_company
            ON salary_base_profiles (company);
          ALTER TABLE salary_records
            ADD COLUMN IF NOT EXISTS pm_breakdown JSONB;
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (14) ON CONFLICT DO NOTHING");
        current = 14;
      }
      await client.query(`
        CREATE TABLE IF NOT EXISTS salary_base_profiles (
          id SERIAL PRIMARY KEY,
          company TEXT NOT NULL DEFAULT 'PM',
          employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          in_hand NUMERIC NOT NULL DEFAULT 0,
          pf_employee NUMERIC NOT NULL DEFAULT 0,
          esi_employee NUMERIC NOT NULL DEFAULT 0,
          pt NUMERIC NOT NULL DEFAULT 0,
          gratuity NUMERIC NOT NULL DEFAULT 0,
          employer_pf NUMERIC NOT NULL DEFAULT 0,
          employer_pf_arr NUMERIC NOT NULL DEFAULT 0,
          employer_esi NUMERIC NOT NULL DEFAULT 0,
          updated_by TEXT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (company, employee_id)
        );
        CREATE INDEX IF NOT EXISTS idx_salary_base_profiles_company
          ON salary_base_profiles (company);
        ALTER TABLE salary_records
          ADD COLUMN IF NOT EXISTS pm_breakdown JSONB;
      `);
      if (current < 15) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS salary_calc_runs (
            id SERIAL PRIMARY KEY,
            year INTEGER NOT NULL,
            month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
            company TEXT NOT NULL DEFAULT 'PM',
            attendance_fingerprint TEXT NOT NULL,
            calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            calculated_by TEXT,
            employee_count INTEGER NOT NULL DEFAULT 0,
            UNIQUE (year, month, company)
          );
          CREATE INDEX IF NOT EXISTS idx_salary_calc_runs_period
            ON salary_calc_runs (year, month, company);
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (15) ON CONFLICT DO NOTHING");
        current = 15;
      }
      if (current < 16) {
        await client.query(`
          ALTER TABLE users
            ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

          CREATE TABLE IF NOT EXISTS auth_email_challenges (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            kind TEXT NOT NULL,
            code_hash TEXT NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            consumed_at TIMESTAMPTZ,
            ip TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_auth_email_challenges_user
            ON auth_email_challenges (user_id, kind, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_auth_email_challenges_expires
            ON auth_email_challenges (expires_at);

          CREATE TABLE IF NOT EXISTS login_audit (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            email TEXT NOT NULL DEFAULT '',
            event TEXT NOT NULL,
            ip TEXT,
            detail TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_login_audit_created
            ON login_audit (created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_login_audit_user
            ON login_audit (user_id, created_at DESC);
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (16) ON CONFLICT DO NOTHING");
        current = 16;
      }
      if (current < 17) {
        await client.query(`
          ALTER TABLE employees
            ADD COLUMN IF NOT EXISTS gender TEXT,
            ADD COLUMN IF NOT EXISTS date_of_joining DATE;
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (17) ON CONFLICT DO NOTHING");
        current = 17;
      }
      if (current < 18) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS teams (
            id SERIAL PRIMARY KEY,
            slug TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            manager_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          ALTER TABLE employees
            ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL;
          CREATE INDEX IF NOT EXISTS idx_employees_team ON employees (team_id);
          CREATE INDEX IF NOT EXISTS idx_teams_manager ON teams (manager_user_id);
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (18) ON CONFLICT DO NOTHING");
        current = 18;
      }
      if (current < 19) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS company_holidays (
            id SERIAL PRIMARY KEY,
            year INTEGER NOT NULL,
            holiday_date DATE NOT NULL,
            name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            updated_by TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (year, holiday_date)
          );
          CREATE INDEX IF NOT EXISTS idx_company_holidays_year
            ON company_holidays (year, holiday_date);

          CREATE TABLE IF NOT EXISTS holiday_year_reminders (
            id SERIAL PRIMARY KEY,
            reminder_year INTEGER NOT NULL UNIQUE,
            sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (19) ON CONFLICT DO NOTHING");
        current = 19;
      }
      if (current < 20) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS performance_appraisal_submissions (
            id SERIAL PRIMARY KEY,
            employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            cycle_year INTEGER NOT NULL,
            team_slug TEXT NOT NULL,
            overall_employee_rating INTEGER CHECK (overall_employee_rating >= 1 AND overall_employee_rating <= 5),
            overall_manager_rating INTEGER CHECK (overall_manager_rating >= 1 AND overall_manager_rating <= 5),
            manager_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            employee_updated_at TIMESTAMPTZ,
            manager_updated_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (employee_id, cycle_year)
          );
          CREATE INDEX IF NOT EXISTS idx_perf_appraisal_year
            ON performance_appraisal_submissions (cycle_year, team_slug);

          CREATE TABLE IF NOT EXISTS performance_appraisal_answers (
            id SERIAL PRIMARY KEY,
            submission_id INTEGER NOT NULL REFERENCES performance_appraisal_submissions(id) ON DELETE CASCADE,
            criterion_index INTEGER NOT NULL,
            employee_rating INTEGER CHECK (employee_rating >= 1 AND employee_rating <= 5),
            employee_comments TEXT,
            manager_rating INTEGER CHECK (manager_rating >= 1 AND manager_rating <= 5),
            manager_comments TEXT,
            UNIQUE (submission_id, criterion_index)
          );
          CREATE INDEX IF NOT EXISTS idx_perf_appraisal_answers_sub
            ON performance_appraisal_answers (submission_id, criterion_index);
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (20) ON CONFLICT DO NOTHING");
        current = 20;
      }
      if (current < 21) {
        await client.query(`
          ALTER TABLE performance_appraisal_submissions
            ADD COLUMN IF NOT EXISTS manager_submitted_at TIMESTAMPTZ;
          ALTER TABLE performance_appraisal_answers
            ADD COLUMN IF NOT EXISTS leadership_jay_comments TEXT;
          ALTER TABLE performance_appraisal_answers
            ADD COLUMN IF NOT EXISTS leadership_mansi_comments TEXT;
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (21) ON CONFLICT DO NOTHING");
        current = 21;
      }
      if (current < 22) {
        await client.query(`
          ALTER TABLE performance_appraisal_answers
            ADD COLUMN IF NOT EXISTS management_rating INTEGER
              CHECK (management_rating >= 1 AND management_rating <= 5);
          ALTER TABLE performance_appraisal_answers
            ADD COLUMN IF NOT EXISTS management_comments TEXT;
          ALTER TABLE performance_appraisal_submissions
            ADD COLUMN IF NOT EXISTS overall_management_rating INTEGER
              CHECK (overall_management_rating >= 1 AND overall_management_rating <= 5);
          ALTER TABLE performance_appraisal_submissions
            ADD COLUMN IF NOT EXISTS management_updated_at TIMESTAMPTZ;
          UPDATE performance_appraisal_answers
          SET management_comments = trim(both from concat_ws(
            E'\\n\\n',
            nullif(trim(leadership_jay_comments), ''),
            nullif(trim(leadership_mansi_comments), '')
          ))
          WHERE management_comments IS NULL
            AND (leadership_jay_comments IS NOT NULL OR leadership_mansi_comments IS NOT NULL);
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (22) ON CONFLICT DO NOTHING");
        current = 22;
      }
      if (current < 23) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS leave_requests (
            id SERIAL PRIMARY KEY,
            employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            requester_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            leave_type TEXT NOT NULL CHECK (leave_type IN ('pl', 'sl', 'cl')),
            start_date DATE NOT NULL,
            end_date DATE NOT NULL,
            reason TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
            approval_tier TEXT NOT NULL CHECK (approval_tier IN ('manager', 'leadership_hr')),
            assigned_approver_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            decided_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            decided_at TIMESTAMPTZ,
            decision_note TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CHECK (end_date >= start_date)
          );
          CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests (employee_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests (status, start_date);
          CREATE INDEX IF NOT EXISTS idx_leave_requests_assigned ON leave_requests (assigned_approver_user_id, status)
            WHERE status = 'pending';
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (23) ON CONFLICT DO NOTHING");
        current = 23;
      }
      if (current < 24) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS reimbursement_requests (
            id SERIAL PRIMARY KEY,
            employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            requester_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expense_date DATE NOT NULL,
            category TEXT NOT NULL CHECK (category IN ('travel', 'client', 'other')),
            amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
            description TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
            approval_tier TEXT NOT NULL CHECK (approval_tier IN ('manager', 'leadership_hr')),
            assigned_approver_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            decided_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            decided_at TIMESTAMPTZ,
            decision_note TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_reimbursement_requests_employee
            ON reimbursement_requests (employee_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_reimbursement_requests_status
            ON reimbursement_requests (status, expense_date);
          CREATE INDEX IF NOT EXISTS idx_reimbursement_requests_assigned
            ON reimbursement_requests (assigned_approver_user_id, status)
            WHERE status = 'pending';
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (24) ON CONFLICT DO NOTHING");
        current = 24;
      }
      if (current < 25) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS employee_documents (
            id SERIAL PRIMARY KEY,
            employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            document_type TEXT NOT NULL,
            slot INTEGER NOT NULL DEFAULT 0,
            file_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            file_data BYTEA NOT NULL,
            file_size INTEGER NOT NULL DEFAULT 0,
            uploaded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (employee_id, document_type, slot)
          );
          CREATE INDEX IF NOT EXISTS idx_employee_documents_employee
            ON employee_documents (employee_id);
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (25) ON CONFLICT DO NOTHING");
        current = 25;
      }
      if (current < 26) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS employee_documents (
            id SERIAL PRIMARY KEY,
            employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            document_type TEXT NOT NULL,
            slot INTEGER NOT NULL DEFAULT 0,
            file_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            file_data BYTEA NOT NULL,
            file_size INTEGER NOT NULL DEFAULT 0,
            uploaded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (employee_id, document_type, slot)
          );
          CREATE INDEX IF NOT EXISTS idx_employee_documents_employee
            ON employee_documents (employee_id);
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (26) ON CONFLICT DO NOTHING");
        current = 26;
      }
      if (current < 27) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS portal_punch_days (
            id SERIAL PRIMARY KEY,
            employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            requester_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            attendance_date DATE NOT NULL,
            shift_start_snapshot TEXT,
            in_time TEXT,
            in_client_at TIMESTAMPTZ,
            in_server_at TIMESTAMPTZ,
            out_time TEXT,
            out_client_at TIMESTAMPTZ,
            out_server_at TIMESTAMPTZ,
            status TEXT NOT NULL DEFAULT 'open'
              CHECK (status IN ('open', 'pending', 'approved', 'rejected')),
            approval_tier TEXT NOT NULL CHECK (approval_tier IN ('manager', 'leadership_hr')),
            assigned_approver_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            decided_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            decided_at TIMESTAMPTZ,
            decision_note TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (employee_id, attendance_date)
          );
          CREATE INDEX IF NOT EXISTS idx_portal_punch_employee
            ON portal_punch_days (employee_id, attendance_date DESC);
          CREATE INDEX IF NOT EXISTS idx_portal_punch_status
            ON portal_punch_days (status, attendance_date DESC);
          CREATE INDEX IF NOT EXISTS idx_portal_punch_assigned
            ON portal_punch_days (assigned_approver_user_id, status)
            WHERE status = 'pending';
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (27) ON CONFLICT DO NOTHING");
        current = 27;
      }
      if (current < 28) {
        await client.query(`
          ALTER TABLE company_holidays
            ADD COLUMN IF NOT EXISTS day_type TEXT NOT NULL DEFAULT 'full'
              CHECK (day_type IN ('full', 'half'));
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (28) ON CONFLICT DO NOTHING");
        current = 28;
      }
      if (current < 29) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS goal_sheet_submissions (
            id SERIAL PRIMARY KEY,
            employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            cycle_year INTEGER NOT NULL,
            team_slug TEXT NOT NULL,
            overall_employee_rating INTEGER CHECK (overall_employee_rating >= 1 AND overall_employee_rating <= 5),
            overall_manager_rating INTEGER CHECK (overall_manager_rating >= 1 AND overall_manager_rating <= 5),
            overall_management_rating INTEGER CHECK (overall_management_rating >= 1 AND overall_management_rating <= 5),
            manager_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            employee_updated_at TIMESTAMPTZ,
            manager_updated_at TIMESTAMPTZ,
            management_updated_at TIMESTAMPTZ,
            manager_submitted_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (employee_id, cycle_year)
          );
          CREATE INDEX IF NOT EXISTS idx_goal_sheet_year
            ON goal_sheet_submissions (cycle_year, team_slug);

          CREATE TABLE IF NOT EXISTS goal_sheet_answers (
            id SERIAL PRIMARY KEY,
            submission_id INTEGER NOT NULL REFERENCES goal_sheet_submissions(id) ON DELETE CASCADE,
            criterion_index INTEGER NOT NULL,
            employee_rating INTEGER CHECK (employee_rating >= 1 AND employee_rating <= 5),
            employee_comments TEXT,
            manager_rating INTEGER CHECK (manager_rating >= 1 AND manager_rating <= 5),
            manager_comments TEXT,
            management_rating INTEGER CHECK (management_rating >= 1 AND management_rating <= 5),
            management_comments TEXT,
            UNIQUE (submission_id, criterion_index)
          );
          CREATE INDEX IF NOT EXISTS idx_goal_sheet_answers_sub
            ON goal_sheet_answers (submission_id, criterion_index);
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (29) ON CONFLICT DO NOTHING");
        current = 29;
      }
      if (current < 30) {
        await client.query("INSERT INTO schema_migrations (version) VALUES (30) ON CONFLICT DO NOTHING");
        current = 30;
      }
      if (current < 31) {
        await client.query(`
          UPDATE employees e
          SET team_id = NULL, department = NULL, updated_at = NOW()
          FROM teams t
          WHERE e.team_id = t.id AND t.slug = 'social-media-seo';

          DELETE FROM teams WHERE slug = 'social-media-seo';
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (31) ON CONFLICT DO NOTHING");
        current = 31;
      }
      if (current < 32) {
        await client.query(`
          ALTER TABLE salary_sheet_rows
            ADD COLUMN IF NOT EXISTS increment_percent NUMERIC;
          ALTER TABLE salary_base_profiles
            ADD COLUMN IF NOT EXISTS increment_percent NUMERIC;
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (32) ON CONFLICT DO NOTHING");
        current = 32;
      }
      if (current < 33) {
        await client.query(`
          ALTER TABLE salary_base_profiles
            ADD COLUMN IF NOT EXISTS increment_from_year INTEGER,
            ADD COLUMN IF NOT EXISTS increment_from_month INTEGER,
            ADD COLUMN IF NOT EXISTS increment_rupees NUMERIC NOT NULL DEFAULT 0;
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (33) ON CONFLICT DO NOTHING");
        current = 33;
      }
      if (current < 34) {
        await client.query(`
          ALTER TABLE employees
            ADD COLUMN IF NOT EXISTS date_of_leaving DATE,
            ADD COLUMN IF NOT EXISTS offboarding_notified_at TIMESTAMPTZ;
          ALTER TABLE users
            ADD COLUMN IF NOT EXISTS account_disabled BOOLEAN NOT NULL DEFAULT FALSE;
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (34) ON CONFLICT DO NOTHING");
        current = 34;
      }
      if (current < 35) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS reimbursement_receipts (
            id SERIAL PRIMARY KEY,
            reimbursement_request_id INTEGER NOT NULL REFERENCES reimbursement_requests(id) ON DELETE CASCADE,
            file_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            file_data BYTEA NOT NULL,
            file_size INTEGER NOT NULL CHECK (file_size > 0),
            uploaded_by_user_id INTEGER NOT NULL REFERENCES users(id),
            uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_reimbursement_receipts_request
            ON reimbursement_receipts (reimbursement_request_id, id);
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (35) ON CONFLICT DO NOTHING");
        current = 35;
      }
      if (current < 36) {
        await client.query(`
          ALTER TABLE performance_appraisal_submissions
            ADD COLUMN IF NOT EXISTS employee_submitted_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS management_submitted_at TIMESTAMPTZ;
          ALTER TABLE goal_sheet_submissions
            ADD COLUMN IF NOT EXISTS employee_submitted_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS management_submitted_at TIMESTAMPTZ;
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (36) ON CONFLICT DO NOTHING");
        current = 36;
      }
      if (current < 37) {
        await client.query(`
          ALTER TABLE performance_appraisal_submissions
            ADD COLUMN IF NOT EXISTS overall_employee_comments TEXT,
            ADD COLUMN IF NOT EXISTS overall_manager_comments TEXT,
            ADD COLUMN IF NOT EXISTS overall_management_comments TEXT;
          ALTER TABLE goal_sheet_submissions
            ADD COLUMN IF NOT EXISTS overall_employee_comments TEXT,
            ADD COLUMN IF NOT EXISTS overall_manager_comments TEXT,
            ADD COLUMN IF NOT EXISTS overall_management_comments TEXT;
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (37) ON CONFLICT DO NOTHING");
        current = 37;
      }
      if (current < 38) {
        await client.query(`
          ALTER TABLE portal_punch_days
            ADD COLUMN IF NOT EXISTS in_status TEXT
              CHECK (in_status IS NULL OR in_status IN ('pending', 'approved', 'rejected')),
            ADD COLUMN IF NOT EXISTS in_decided_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS in_decided_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS in_decision_note TEXT,
            ADD COLUMN IF NOT EXISTS out_status TEXT
              CHECK (out_status IS NULL OR out_status IN ('pending', 'approved', 'rejected')),
            ADD COLUMN IF NOT EXISTS out_decided_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS out_decided_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS out_decision_note TEXT;
          UPDATE portal_punch_days SET
            in_status = CASE
              WHEN in_time IS NULL THEN NULL
              WHEN status IN ('pending', 'approved', 'rejected') THEN status
              ELSE 'pending'
            END,
            out_status = CASE
              WHEN out_time IS NULL THEN NULL
              WHEN status IN ('pending', 'approved', 'rejected') THEN status
              ELSE 'pending'
            END,
            in_decided_by_user_id = CASE WHEN in_time IS NOT NULL THEN decided_by_user_id END,
            in_decided_at = CASE WHEN in_time IS NOT NULL THEN decided_at END,
            in_decision_note = CASE WHEN in_time IS NOT NULL THEN decision_note END,
            out_decided_by_user_id = CASE WHEN out_time IS NOT NULL THEN decided_by_user_id END,
            out_decided_at = CASE WHEN out_time IS NOT NULL THEN decided_at END,
            out_decision_note = CASE WHEN out_time IS NOT NULL THEN decision_note END
          WHERE in_status IS NULL AND out_status IS NULL;
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (38) ON CONFLICT DO NOTHING");
        current = 38;
      }
      if (current < 39) {
        await client.query(`
          ALTER TABLE leave_requests
            ADD COLUMN IF NOT EXISTS apply_warnings JSONB NOT NULL DEFAULT '[]'::jsonb;
          ALTER TABLE reimbursement_requests
            ADD COLUMN IF NOT EXISTS submission_flags JSONB NOT NULL DEFAULT '[]'::jsonb;
          ALTER TABLE reimbursement_receipts
            ADD COLUMN IF NOT EXISTS content_sha256 TEXT;
          CREATE INDEX IF NOT EXISTS idx_reimbursement_receipts_sha
            ON reimbursement_receipts (content_sha256)
            WHERE content_sha256 IS NOT NULL;
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (39) ON CONFLICT DO NOTHING");
        current = 39;
      }
      if (current < 40) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS employee_previous_employer_details (
            id SERIAL PRIMARY KEY,
            employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            sort_order INTEGER NOT NULL DEFAULT 1,
            company_name TEXT NOT NULL,
            date_of_joining DATE,
            date_of_leaving DATE,
            position TEXT,
            other_details TEXT,
            updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_employee_prev_employer_employee
            ON employee_previous_employer_details (employee_id, sort_order);
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (40) ON CONFLICT DO NOTHING");
        current = 40;
      }
      if (current < 41) {
        await client.query(`
          ALTER TABLE employee_previous_employer_details
            ADD COLUMN IF NOT EXISTS reference_contact_name TEXT,
            ADD COLUMN IF NOT EXISTS reference_contact_info TEXT;
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (41) ON CONFLICT DO NOTHING");
        current = 41;
      }
      if (current < 42) {
        await client.query(`
          ALTER TABLE employee_previous_employer_details
            ADD COLUMN IF NOT EXISTS location TEXT,
            ADD COLUMN IF NOT EXISTS reason_for_leaving TEXT;
          ALTER TABLE employee_previous_employer_details
            DROP COLUMN IF EXISTS other_details;
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (42) ON CONFLICT DO NOTHING");
        current = 42;
      }
      if (current < 43) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_by TEXT NOT NULL DEFAULT 'system'
          );
          INSERT INTO app_settings (key, value, updated_by)
          VALUES ('reimbursement.special_approval_min_amount', '2000'::jsonb, 'system')
          ON CONFLICT (key) DO NOTHING;
          ALTER TABLE reimbursement_requests
            ADD COLUMN IF NOT EXISTS requires_special_approval BOOLEAN NOT NULL DEFAULT false;
        `);
        await client.query("INSERT INTO schema_migrations (version) VALUES (43) ON CONFLICT DO NOTHING");
        current = 43;
      }
      await client.query(`
        CREATE TABLE IF NOT EXISTS salary_calc_runs (
          id SERIAL PRIMARY KEY,
          year INTEGER NOT NULL,
          month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
          company TEXT NOT NULL DEFAULT 'PM',
          attendance_fingerprint TEXT NOT NULL,
          calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          calculated_by TEXT,
          employee_count INTEGER NOT NULL DEFAULT 0,
          UNIQUE (year, month, company)
        );
        CREATE INDEX IF NOT EXISTS idx_salary_calc_runs_period
          ON salary_calc_runs (year, month, company);
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS salary_workbook_history (
          id SERIAL PRIMARY KEY,
          year INTEGER NOT NULL,
          month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
          company TEXT NOT NULL DEFAULT 'PM',
          file_name TEXT NOT NULL,
          file_data BYTEA NOT NULL,
          upload_id TEXT NOT NULL UNIQUE,
          rows_json JSONB NOT NULL DEFAULT '[]'::jsonb,
          total_rows INTEGER NOT NULL DEFAULT 0,
          matched_rows INTEGER NOT NULL DEFAULT 0,
          error_rows INTEGER NOT NULL DEFAULT 0,
          uploaded_by TEXT,
          uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_salary_workbook_history_period
          ON salary_workbook_history (year, month, company, uploaded_at DESC);
      `);
      await client.query(`
        INSERT INTO salary_workbook_history (
          year, month, company, file_name, file_data, upload_id, rows_json,
          total_rows, matched_rows, error_rows, uploaded_by, uploaded_at
        )
        SELECT
          year, month, company, file_name, file_data, upload_id, rows_json,
          total_rows, matched_rows, error_rows, uploaded_by, uploaded_at
        FROM salary_workbooks
        ON CONFLICT (upload_id) DO NOTHING
      `);
      if (current < SCHEMA_VERSION) {
        console.warn(
          `schema_migrations at ${current} but SCHEMA_VERSION is ${SCHEMA_VERSION}; run pending migrations in db/index.ts`,
        );
      }
    } finally {
      client.release();
    }
    return p;
  })();
  return ready;
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore rollback errors */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const res = await getPool().query<T>(text, params);
  return res.rows;
}

export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T | undefined> {
  const rows = await query<T>(text, params);
  return rows[0];
}
