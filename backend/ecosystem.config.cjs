/**
 * PM2 — reads ATTENDANCE_API_PORT from backend/.env (same value as nginx proxy).
 *
 * From repo root (after `npm run build:api`):
 *   cd backend && pm2 start ecosystem.config.cjs
 *
 * All other production vars (DATABASE_URL, AUTH_SECRET, CORS_ORIGIN, …) load from backend/.env
 * via dotenv in dist/server.js startup — keep backend/.env on the server.
 */

const fs = require("fs");
const path = require("path");

const backendRoot = __dirname;

function readAttendancePortFromDotenv() {
  const envPath = path.join(backendRoot, ".env");
  if (!fs.existsSync(envPath)) {
    throw new Error("backend/.env missing — set ATTENDANCE_API_PORT before pm2 start");
  }
  const lines = fs.readFileSync(envPath, "utf8").split("\n").map((line) => line.trim());
  const key = "ATTENDANCE_API_PORT=";
  const match = lines.find((line) => line.startsWith(key) && !line.startsWith("#"));
  if (!match) {
    throw new Error("ATTENDANCE_API_PORT is not set in backend/.env");
  }
  const port = match.slice(key.length).trim();
  if (!/^\d+$/.test(port)) {
    throw new Error(`Invalid ATTENDANCE_API_PORT in backend/.env: ${port}`);
  }
  return port;
}

const ATTENDANCE_API_PORT =
  process.env.ATTENDANCE_API_PORT || readAttendancePortFromDotenv();

const DEFAULT_PATH =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/bin";

module.exports = {
  apps: [
    {
      name: "hr-automation-api",
      script: "./dist/server.js",
      cwd: backendRoot,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: "10s",
      max_memory_restart: "1536M",
      env: {
        NODE_ENV: "production",
        HOST: "0.0.0.0",
        ATTENDANCE_API_PORT,
        PATH: process.env.PATH || DEFAULT_PATH,
      },
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      kill_timeout: 5000,
      listen_timeout: 10000,
    },
  ],
};
