# HR Automation

Internal HR portal for Par Marketing. Employees and managers use a React dashboard; HR uploads ESSL attendance registers, runs payroll, and manages people data. Everything persists in PostgreSQL behind an Express API.

**Local run:** `npm start` - API on port **8787**, dashboard on **5173**. Copy `backend/.env.example` to `backend/.env` and set `DATABASE_URL` (see [Getting started](#getting-started)).

---

## What the product does

| Area | What users get |
|------|----------------|
| **Attendance** | Upload ESSL daily/weekly/monthly PDFs (or Excel grids). Optional Computex leave/WFH files merge into day cells. Browse saved months, edit daily rows, approve weekly hours. |
| **Leave** | Apply for leave, see balance (Jan-Jun / Jul-Dec pools), manager and exec approval. |
| **In/out (portal punch)** | Check-in/out windows, approval queue for exceptions. |
| **Reimbursement** | Submit claims with receipts, approver workflow. |
| **Holidays** | Company holiday list; year-end reminder email to staff (when SMTP is configured). |
| **Performance & goal sheet** | Yearly cycles: employee → manager → management review. Team-specific criteria templates. Draft scores hidden in directory until submit. |
| **Salary (PM)** | Payroll sheet, increments, workbook history, Excel export. |
| **Letters** | Offer letters (PDF + email), relieving letters (DOCX/PDF). |
| **Documents** | HR uploads; employees view their folder. |
| **Reports & dashboard** | HR home checklist, exportable reports, audit history. |
| **Admin** | Logins, roles, people master, manager assignments, teams. |

**Roles** (stored on `users.role`): `viewer` (employee), `manager`, `hr`, `admin`. HR/admin can edit attendance and payroll; managers see their team and approval inboxes; employees see self-service modules linked to their employee record email.

**Dates:** Calendar values in the database and API use ISO `YYYY-MM-DD`. Screens, emails, and exports show **DD-MM-YYYY** (`backend/src/displayDate.ts`, `frontend/src/utils/displayDate.ts`).

**Email:** All outbound mail uses `sendSmtpMail()` in `backend/src/notify/smtp.ts`. Late/weekly attendance alerts only run when `NOTIFICATIONS_ENABLED=true`. Login OTP, password reset, welcome, and offer letters use SMTP independently of that flag. HR is not auto-BCC’d unless a call passes `bccHr: true`.

---

## Where the code lives

```
HR Automation/
├── README.md                    ← project overview
├── package.json                 ← npm start (runs backend + frontend)
├── Start Attendance.command     ← Mac shortcut for npm start
├── backend/                     ← API, Python ingest, Postgres via DATABASE_URL
│   ├── requirements.txt         ← Python deps (pandas, pdfplumber, …)
│   ├── python_tools/
│   │   └── attendance_tool.py   ← ESSL PDF parser
│   ├── scripts/
│   │   ├── pdf_to_json.py
│   │   ├── merge_cross_reports.py
│   │   ├── wait-for-api.mjs         ← used by root npm start
│   │   ├── purgeOperationalData.ts  ← clear uploads/leave/payroll runs (keeps people)
│   │   ├── restorePeopleMaster.ts   ← rebuild Admin → People from local HR files
│   │   └── checkDb.ts
│   ├── .env.example
│   └── src/                     ← Express + TypeScript
└── frontend/                    ← React + Vite
    └── src/
```

There is no separate architecture doc: feature ownership and entry files are described in the sections below.

---

## How the backend is organized

**Entry point:** `backend/src/server.ts` registers routes. Section comments in that file group auth, attendance, notifications, payroll, admin, cycles, requests, and letters. Prefer adding `service.ts` + `routes.ts` under a feature folder rather than growing inline logic in `server.ts`.

| Folder | Responsibility |
|--------|----------------|
| `auth/` | Login, email OTP (`LOGIN_EMAIL_OTP` can disable), forgot password, `requireAuth` / `requireEditor` / `requireAdmin`. |
| `auth/attendanceScope.ts` | Maps a login to employee rows (email match, manager assignments). |
| `persist/ingest.ts` | After PDF parse, writes employees + `daily_attendance` + weekly rollups. |
| `persist/queries.ts` | Load month snapshots, patch daily/weekly, upload history, browse periods. |
| `persist/helpers.ts` | PM rules: 15‑min late grace, 54h weekly target, day tokens (P, WFH, SL, WO, …), frozen approved weeks. |
| `notify/` | `smtp.ts` (mail), `service.ts` (late + weekly bulk mail), `schedule.ts` (daily cron + offboarding + holiday reminder). |
| `leaveRequests/` | Balance, create/cancel, approvers (`approvers.ts` for exec step). |
| `portalPunch/` | Check-in/out, pending + decided items in approver inbox. |
| `performance/` + `goalSheet/` | Each exports functions from `createCycleFormService()` in `cycleForm/createService.ts` with different DB tables and templates. |
| `performance/leadership.ts` | Jay/Mansi: management review + offer CC; skipped for automated ops mail via `isExemptFromAttendanceAlertEmails()`. |
| `salary/` | PM column layout, calculator, sheet save/export. |
| `teams/teams.ts` | Team seeds and employee pins (re-applied on startup). |

**Database:** `backend/src/db/schema.sql` applied on API boot; version bumped in `db/index.ts` (`SCHEMA_VERSION`). Postgres `DATE` columns are read as strings `YYYY-MM-DD` to avoid timezone drift.

**Adding a backend feature:** Create `backend/src/<name>/service.ts` and `routes.ts`, import handlers in `server.ts`, extend `.env.example` if you introduce new env vars.

---

## How the frontend is organized

**Entry point:** `frontend/src/main.tsx` - every URL path and page component.

**Navigation:** `modules/registry.ts` lists modules (label, href, group). `modules/access.ts` filters by role. New product areas need a registry entry, a route in `main.tsx`, and usually a file under `pages/` plus `api/<feature>.ts`.

| Area | Main files |
|------|------------|
| Shell | `components/AppShell.tsx` |
| Attendance upload & views | `pages/AttendancePage.tsx`, `pages/AttendanceDetailPage.tsx` |
| Attendance calculations | `utils/attendance.ts`, `utils/companyPolicy.ts` |
| Performance / goal sheet UI | `components/PerformanceAppraisalForm.tsx`, `utils/appraisalStatus.ts`, `utils/perfFormDraft.ts` |
| Leave / in-out | `pages/LeaveRequestPage.tsx`, `pages/InOutRequestPage.tsx` |
| Permissions | `auth/permissions.ts` (`canEditAttendance`, manager vs employee) |

Employee pages call APIs like `/api/leave-requests/mine`. Managers use `/team` list endpoints and approval tabs. HR uses editor-only modules and `/admin/*`.

---

## Attendance pipeline (ESSL upload)

This was the first slice of the product; it still drives most of the `persist/` layer.

### End-to-end flow

```
HR uploads register (+ optional leave/WFH Excel)
    → POST /api/attendance/process (AttendancePage)
    → server.ts: temp files → pdf_to_json.py → optional merge_cross_reports.py
    → validateParsedEmployees → persistProcessedAttendance (Postgres)
    → dashboard loads saved month via GET /api/attendance/month
    → daily / weekly / monthly tables + exports
```

`server.ts` functions `runBridge()` and `runMerge()` spawn Python under `backend/scripts/`. PDFs go through `backend/python_tools/attendance_tool.py`. Merge replaces absent marks with DA/SL/PL/CL/WFH when Computex files match employee + date.

Merge month/year prefer the register date from the PDF (`reportDateIso`), not only the UI picker, so leave files align with the sheet.

### Frontend attendance UI

- **Upload:** `AttendancePage.tsx` (not a legacy single `App.tsx` tab app).
- **Tables:** `DailyTable`, `WeeklyTable`, `MonthlyTable`, etc.
- **Logic:** `utils/attendance.ts` - late = shift + 15 minutes; present if InTime, `P`, `P(duration)`, or WFH; weekly deficit vs expected hours (Sunday 0h, weekday 9h; PM WFH cap in `companyPolicy.ts`).

### Python scripts

**`pdf_to_json.py`** - Input PDF or tabular file; flexible column names for employee code, name, day1-day31, InTime, worked hours. Output JSON with `employees`, `reportDateIso`, optional `parseMeta`.

**`merge_cross_reports.py`** - Input employee JSON + year + month + leave path + WFH path (`-` if missing). Updates `days[]` and can set `dayWfhUnverified` when WFH came only from the leave file.

### Key business rules

- **Late:** First punch after shift start + 15 minutes (`LATE_GRACE_MINUTES` in `persist/helpers.ts` and dashboard `attendance.ts`).
- **Weekly mail threshold:** 54 hours (`WEEKLY_HOURS_THRESHOLD`) for PM company employees when notifications are enabled.
- **Weekly approve:** Approved or locked weeks are not overwritten on the next register ingest (`isWeeklyFrozen` in `persist/helpers.ts`).
- **Companies:** PM, CCM, SML, TC, LL (and ALL in upload). PM-specific payroll and several attendance policies.

### Supported upload formats

- ESSL PDF via `backend/python_tools/attendance_tool.py`
- Tabular: xlsx, xls, xlsm, csv, tsv with the same day-grid shape
- Leave/WFH: Computex-style Excel matched by employee + date

---

## API reference (common routes)

Routes are prefixed with `/api` unless noted. Most require a session cookie after login.

| Method | Path | Notes |
|--------|------|--------|
| POST | `/api/auth/login`, `/verify`, … | Public; then `requireAuth` on other `/api/*` |
| POST | `/api/attendance/process` | Multipart: `file`, optional `leaveFile`, `wfhFile`, company, reportType, year, month |
| GET | `/api/attendance/month` | Saved snapshot for year/month |
| GET | `/api/attendance/saved-periods` | Editor: list stored periods |
| PATCH | `/api/attendance/daily/:id` | Edit one day row |
| POST | `/api/attendance/weekly/:id/approve` | Lock week |
| GET | `/api/dashboard/summary` | HR home |
| GET | `/api/reports`, `/api/reports/:type` | Reports page |
| GET/PATCH | `/api/leave-requests/*` | Balance, mine, pending, decide |
| GET/POST | `/api/portal-punch/*` | Check-in/out, approvals |
| GET/PATCH | `/api/performance/*`, `/api/goal-sheet/*` | Cycle forms |
| GET/POST | `/api/salary/*` | PM payroll (editor for writes) |
| GET/POST | `/api/admin/*` | Users, employees, teams (admin) |
| GET | `/health` | Liveness |
| GET | `/health/ready` | Readiness (Postgres ping) |

**POST `/api/attendance/process` response** includes `employees[]` (31-day grids), optional `crossCheck`, `reportDateIso`, `parseMeta`. After save, clients typically reload via `/api/attendance/month`.

---

## Database

PostgreSQL via `DATABASE_URL`. On first start, schema is applied from `backend/src/db/schema.sql`.

**People master** (`employees`, teams, manager assignments, `salary_base_profiles` on profiles) is separate from **operational** data (attendance months, leave/in-out requests, payroll runs, reimbursements, performance cycles, upload history).

Core attendance tables include `employees`, `daily_attendance`, `weekly_attendance`, plus modules for leave, portal punch, salary, performance cycles, notification log, etc.

Useful checks:

- `GET /api/db/status`
- `GET /api/history?entityType=…`
- `npm run check:db` (from repo root or `backend/`)

Local DB:

```bash
createdb hr_automation   # once, if the database does not exist
cp backend/.env.example backend/.env
# set DATABASE_URL in backend/.env
```

For managed Postgres, set `PGSSL=true` if required.

### Clear operational / test data (keep people)

Removes attendance uploads, portal leave and in/out, payroll **runs** (not People salary base), reimbursements, performance/goal submissions, employee document uploads, sessions, and ad-hoc test portal logins (e.g. `aishwarya.kamble@parmarketing.agency`). **Does not** delete `employees`, teams, manager assignments, `salary_base_profiles`, company holidays, or the HR user password.

```bash
cd backend && npm run purge:operational
# optional: AUTH_BOOTSTRAP_EMAIL if HR email differs from hr@parmarketing.agency
```

### Restore Admin → People (after roster loss)

If the employee list is empty, rebuild master data from files on your machine (defaults point at `Desktop/Data - HR/`):

| Env (optional) | Default file |
|----------------|--------------|
| `RESTORE_ATTENDANCE_PDF` | `Daily Attendance_Detail Summary Report PM.pdf` — codes, names, shifts |
| `RESTORE_SALARY_XLSX` | `salary calculation PM.xlsx` — in-hand, DOJ, dept, gender where rows match by name |

The script also seeds teams, pinned team placements, and guessed work emails (`firstname.lastname@parmarketing.agency` except known leadership/manager addresses). Create manager/admin logins in **Admin → Logins** (matching team manager emails), then restart the API so `seedTeams()` links team managers. Review **Admin → People** afterward: team membership for staff not in pin rules, salary for anyone missing from the Excel, and email addresses.

```bash
cd backend && npm run restore:people
```

---

## Configuration

### Environment variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres connection string |
| `ATTENDANCE_API_PORT` | API port (default 8787 local; production **8021** in `backend/.env`; PM2 reads same value) |
| `CORS_ORIGIN` | Dashboard origin for credentialed CORS (e.g. `https://hr.parmarketing.co.in`; comma-separated if several) |
| `PYTHON` | Optional override for attendance scripts (default `python3`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, … | Outbound email |
| `NOTIFICATIONS_ENABLED=true` | Enable scheduled late + weekly short-hours email |
| `NOTIFICATIONS_TZ`, `NOTIFICATIONS_HOUR` | Scheduler timezone and hour (default Asia/Kolkata, 8) |
| `LOGIN_EMAIL_OTP=false` | Skip email OTP after password |
| `APP_NAME`, `APP_LOGIN_URL` | Auth email copy and login link |

See `backend/.env.example` for the full list.

### Attendance policy defaults

- Working day: 9 hours (Mon-Sat expectation in weekly rollup; Sunday off)
- Late grace: 15 minutes after shift start
- PM WFH cap: 3 days per month (UI warning)
- Tokens: AB absent, DA/SL/PL/CL leave, WFH, WO weekly off, P present (often with duration)

---

## Getting started

### Prerequisites

- Node.js 18+
- Python 3.8+ - **`npm run setup:python`** runs **system pip3** only (no virtualenv). On Mac Homebrew, setup uses **`--break-system-packages`** when needed; on the server use plain **`pip3 install -r backend/requirements.txt`**
- PostgreSQL installed locally, or a managed `DATABASE_URL` (Neon, RDS, etc.)

### Install

```bash
npm run setup
```

### Run

```bash
cp backend/.env.example backend/.env
# edit DATABASE_URL (e.g. postgres://YOURUSER@localhost:5432/hr_automation)

npm start
```

On first API start with an empty `users` table, bootstrap creates **`hr@parmarketing.agency`** using `AUTH_BOOTSTRAP_PASSWORD` from `backend/.env` (see `.env.example`). Create other logins in **Admin → Logins**. Link each portal user to an employee work email in **Admin → People**.

Other scripts:

```bash
npm run check:db           # Postgres connectivity + user count
npm run dev                # dashboard only
npm run api                # API only
npm run setup:python       # pip3 install attendance PDF/Excel deps
npm run check:python       # verify those packages import
npm run build              # production build of dashboard
npm run build:api          # compile backend → backend/dist
npm run build:all          # backend + frontend
```

Backend-only maintenance (run from `backend/` or `npm --prefix backend run …`):

```bash
npm run purge:operational  # clear uploads/requests/payroll runs; keep people
npm run restore:people     # rebuild roster from RESTORE_* PDF/XLSX paths
```

---

## Production deployment

Local development stays the same: **`npm start`** runs the backend with **`tsx watch`** and the Vite dev server on port **5173**. Production uses a compiled backend and static frontend.

### Build

```bash
cp backend/.env.example backend/.env   # production values - see below
npm run build:all
```

Frontend env before **`npm run build`** (split origin — same pattern as Financial Document Processor’s `REACT_APP_API_URL`):

```bash
# frontend/.env.production.local
VITE_API_BASE=https://hr-backend.parmarketing.co.in
```

The SPA calls `/api/...` on that host with **`withCredentials: true`** and **`Authorization: Bearer`** from login. Set **`CORS_ORIGIN=https://hr.parmarketing.co.in`** on the API.

For **one domain** with Nginx proxying `/api`, leave `VITE_API_BASE` empty.

### Run the API

```bash
cd backend
NODE_ENV=production npm run start:prod
```

Or with PM2 (port must match `ATTENDANCE_API_PORT` in `backend/.env`, e.g. **8021**):

```bash
cd backend
npm run build
pm2 start ecosystem.config.cjs
```

Health checks (replace host with your API domain):

- `GET https://hr-backend.parmarketing.co.in/health` — process up
- `GET https://hr-backend.parmarketing.co.in/health/ready` — Postgres reachable

Required in **`backend/.env`** for production:

| Variable | Notes |
|----------|--------|
| `DATABASE_URL` | Managed Postgres; set `PGSSL=true` if required |
| `AUTH_SECRET` | Long random string (**required** when `NODE_ENV=production`) |
| `AUTH_COOKIE_SECURE=true` | When the site is HTTPS-only |
| `CORS_ORIGIN` | Dashboard origin(s), comma-separated if several |
| `APP_LOGIN_URL` | Public login URL for emails |
| `HOST=0.0.0.0` | Listen on all interfaces on a VPS |
| `LIBREOFFICE_PATH` | Relieving letter PDF export |

Health checks: **`GET /health`** (process up), **`GET /health/ready`** (database reachable). On production, hit these on the **API** host (e.g. `https://hr-backend.parmarketing.co.in/health/ready`).

### Hosting patterns

**A - One domain (typical)**  
Nginx serves `frontend/dist/` and proxies `/api` (and `/health`) to `http://127.0.0.1:8787`. Build frontend with empty `VITE_API_BASE`. Set `CORS_ORIGIN` to your public site URL.

**B - Two domains (Par HR production)**  
UI at `https://hr.parmarketing.co.in`, API at `https://hr-backend.parmarketing.co.in` on port **8021** (PM2). Build with `VITE_API_BASE=https://hr-backend.parmarketing.co.in`. Set `CORS_ORIGIN=https://hr.parmarketing.co.in` and `AUTH_COOKIE_SECURE=true` in `backend/.env`.

On the server: install **Node 18+**, **PostgreSQL**, run **`npm run setup:python`** or **`pip3 install -r backend/requirements.txt`**, and **LibreOffice** if you use letter PDFs.

---

## Technical stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, TypeScript, Vite, TailwindCSS, React Router |
| Backend | Express, Node.js, TypeScript |
| Database | PostgreSQL (`pg`) |
| PDF / Excel ingest | Python (pdfplumber, pandas, openpyxl) |
| Client export | SheetJS (xlsx), jsPDF where used |

---

## Troubleshooting

1. Red banner or toast on the dashboard - read the message; check browser Network tab for API errors.
2. API logs - stdout from `npm run api` / `npm start` (`[notify]`, `[auth]`, ingest errors).
3. Upload failures - confirm file shape matches ESSL/Computex expectations; Python deps installed.
4. Mail not sending - `SMTP_*` set; bulk alerts also need `NOTIFICATIONS_ENABLED=true`.
5. Empty attendance for an employee - employee email must match login for self-view; HR scope uses editor role and linked records.
6. **People list empty in Admin** - roster lives only in Postgres; restore with `npm run restore:people` (see [Database](#database)) or re-import from a backup.
