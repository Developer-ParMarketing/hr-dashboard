-- PostgreSQL schema for HR attendance.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  employee_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  email TEXT,
  salary NUMERIC,
  company TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  department TEXT,
  gender TEXT,
  date_of_joining DATE,
  date_of_leaving DATE,
  shift_start TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_attendance (
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

CREATE INDEX IF NOT EXISTS idx_daily_date ON daily_attendance (attendance_date);
CREATE INDEX IF NOT EXISTS idx_daily_employee_date ON daily_attendance (employee_id, attendance_date);

ALTER TABLE daily_attendance ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'calculated';

-- Untouched PDF/import snapshot. HR edits never write here.
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

-- Sparse HR corrections over raw import. Re-ingest updates raw without wiping these.
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

CREATE TABLE IF NOT EXISTS weekly_attendance (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  total_hours NUMERIC,
  required_hours NUMERIC,
  deficit_hours NUMERIC,
  deduction NUMERIC,
  status TEXT NOT NULL DEFAULT 'draft',
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  hr_deduction NUMERIC,
  approved_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, week_start)
);

ALTER TABLE weekly_attendance ADD COLUMN IF NOT EXISTS hr_deduction NUMERIC;
ALTER TABLE weekly_attendance ADD COLUMN IF NOT EXISTS approved_snapshot JSONB;

CREATE INDEX IF NOT EXISTS idx_weekly_status ON weekly_attendance (status);
CREATE INDEX IF NOT EXISTS idx_weekly_start ON weekly_attendance (week_start);

CREATE TABLE IF NOT EXISTS leave_records (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  leave_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, date)
);

CREATE TABLE IF NOT EXISTS wfh_records (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, date)
);

CREATE TABLE IF NOT EXISTS salary_records (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  gross_salary NUMERIC,
  working_days INTEGER,
  attendance_adjustment NUMERIC,
  deduction NUMERIC,
  final_salary NUMERIC,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, month)
);

ALTER TABLE salary_records ADD COLUMN IF NOT EXISTS pm_breakdown JSONB;

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

CREATE TABLE IF NOT EXISTS change_history (
  id SERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system',
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  before_json TEXT,
  after_json TEXT,
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_history_entity ON change_history (entity_type, entity_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_history_changed ON change_history (changed_at);

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
);

CREATE INDEX IF NOT EXISTS idx_notification_kind_period ON notification_log (kind, period_key);

-- Frozen weekly rows (status approved/locked) cannot be overwritten, even via raw SQL.
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

-- Application login users (HR staff). Separate from employees.
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'hr',
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  account_disabled BOOLEAN NOT NULL DEFAULT FALSE,
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

CREATE TABLE IF NOT EXISTS login_audit (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  email TEXT NOT NULL DEFAULT '',
  event TEXT NOT NULL,
  ip TEXT,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_audit_created ON login_audit (created_at DESC);

-- One row per processed upload (daily / weekly / monthly register files).
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
  report_day INTEGER,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_upload_history_processed ON upload_history (processed_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_history_period ON upload_history (report_year, report_month, company);

-- Admin-registered salary Excel per month (used by HR salary calculation).
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

-- Manager → employee assignments (each employee has at most one manager).
CREATE TABLE IF NOT EXISTS manager_employee_assignments (
  id SERIAL PRIMARY KEY,
  manager_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  assigned_by TEXT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id)
);

CREATE INDEX IF NOT EXISTS idx_manager_assignments_manager ON manager_employee_assignments (manager_user_id);

CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  manager_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teams_manager ON teams (manager_user_id);

ALTER TABLE employees ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_employees_team ON employees (team_id);

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

CREATE INDEX IF NOT EXISTS idx_company_holidays_year ON company_holidays (year, holiday_date);

CREATE TABLE IF NOT EXISTS holiday_year_reminders (
  id SERIAL PRIMARY KEY,
  reminder_year INTEGER NOT NULL UNIQUE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS performance_appraisal_submissions (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  cycle_year INTEGER NOT NULL,
  team_slug TEXT NOT NULL,
  overall_employee_rating INTEGER CHECK (overall_employee_rating >= 1 AND overall_employee_rating <= 5),
  overall_manager_rating INTEGER CHECK (overall_manager_rating >= 1 AND overall_manager_rating <= 5),
  overall_management_rating INTEGER CHECK (overall_management_rating >= 1 AND overall_management_rating <= 5),
  overall_employee_comments TEXT,
  overall_manager_comments TEXT,
  overall_management_comments TEXT,
  manager_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  employee_updated_at TIMESTAMPTZ,
  manager_updated_at TIMESTAMPTZ,
  management_updated_at TIMESTAMPTZ,
  manager_submitted_at TIMESTAMPTZ,
  employee_submitted_at TIMESTAMPTZ,
  management_submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, cycle_year)
);

CREATE INDEX IF NOT EXISTS idx_perf_appraisal_year ON performance_appraisal_submissions (cycle_year, team_slug);

CREATE TABLE IF NOT EXISTS performance_appraisal_answers (
  id SERIAL PRIMARY KEY,
  submission_id INTEGER NOT NULL REFERENCES performance_appraisal_submissions(id) ON DELETE CASCADE,
  criterion_index INTEGER NOT NULL,
  employee_rating INTEGER CHECK (employee_rating >= 1 AND employee_rating <= 5),
  employee_comments TEXT,
  manager_rating INTEGER CHECK (manager_rating >= 1 AND manager_rating <= 5),
  manager_comments TEXT,
  management_rating INTEGER CHECK (management_rating >= 1 AND management_rating <= 5),
  management_comments TEXT,
  leadership_jay_comments TEXT,
  leadership_mansi_comments TEXT,
  UNIQUE (submission_id, criterion_index)
);

CREATE INDEX IF NOT EXISTS idx_perf_appraisal_answers_sub ON performance_appraisal_answers (submission_id, criterion_index);

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
  apply_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests (employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests (status, start_date);
CREATE INDEX IF NOT EXISTS idx_leave_requests_assigned ON leave_requests (assigned_approver_user_id, status)
  WHERE status = 'pending';

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
  submission_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  requires_special_approval BOOLEAN NOT NULL DEFAULT false,
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

CREATE TABLE IF NOT EXISTS reimbursement_receipts (
  id SERIAL PRIMARY KEY,
  reimbursement_request_id INTEGER NOT NULL REFERENCES reimbursement_requests(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_data BYTEA NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size > 0),
  content_sha256 TEXT,
  uploaded_by_user_id INTEGER NOT NULL REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reimbursement_receipts_request
  ON reimbursement_receipts (reimbursement_request_id, id);

CREATE INDEX IF NOT EXISTS idx_reimbursement_receipts_sha256
  ON reimbursement_receipts (content_sha256)
  WHERE content_sha256 IS NOT NULL;

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

CREATE TABLE IF NOT EXISTS employee_previous_employer_details (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 1,
  company_name TEXT NOT NULL,
  date_of_joining DATE,
  date_of_leaving DATE,
  position TEXT,
  reference_contact_name TEXT,
  reference_contact_info TEXT,
  location TEXT,
  reason_for_leaving TEXT,
  updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_prev_employer_employee
  ON employee_previous_employer_details (employee_id, sort_order);
