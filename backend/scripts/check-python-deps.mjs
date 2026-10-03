#!/usr/bin/env node
/**
 * Verify Python 3 and attendance-ingest packages (pdfplumber, pandas, openpyxl).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PYTHON = process.env.PYTHON || "python3";
const MODULES = ["pdfplumber", "pandas", "openpyxl"];

async function main() {
  try {
    await execFileAsync(
      PYTHON,
      ["-c", `import ${MODULES.join(", ")}`],
      { timeout: 30_000 },
    );
    console.log(`Python attendance deps OK (${PYTHON})`);
    process.exit(0);
  } catch (err) {
    const detail =
      err && typeof err === "object" && "stderr" in err
        ? String(err.stderr || "").trim()
        : err instanceof Error
          ? err.message
          : "";
    console.error(
      "Python packages for attendance upload are missing.\n" +
        (detail ? `  ${detail.split("\n").slice(-3).join("\n  ")}\n` : "") +
        "  From repo root: npm run setup:python\n" +
        "  Server: pip3 install -r backend/requirements.txt\n" +
        "  Mac Homebrew: pip3 install --break-system-packages -r backend/requirements.txt",
    );
    process.exit(1);
  }
}

main();
