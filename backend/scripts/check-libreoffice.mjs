#!/usr/bin/env node
/**
 * Verify LibreOffice (soffice) is available for relieving-letter PDF export.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const candidates = [
  process.env.LIBREOFFICE_PATH,
  process.env.SOFFICE_PATH,
  "soffice",
  "libreoffice",
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  "/usr/bin/libreoffice",
  "/usr/bin/soffice",
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
].filter(Boolean);

async function tryBin(bin) {
  if ((bin.includes("/") || bin.includes("\\")) && !fs.existsSync(bin)) {
    return null;
  }
  try {
    const { stdout } = await execFileAsync(bin, ["--version"], { timeout: 15_000 });
    return { bin, version: String(stdout).trim().split("\n")[0] };
  } catch {
    return null;
  }
}

const found = [];
for (const bin of candidates) {
  const hit = await tryBin(bin);
  if (hit) found.push(hit);
}

if (found.length === 0) {
  console.error(
    "LibreOffice (soffice) not found. Relieving-letter PDF export will not work until it is installed.\n" +
      "  Run: npm run setup:libreoffice\n" +
      "  Or set LIBREOFFICE_PATH to the soffice binary.",
  );
  process.exit(1);
}

console.log(`LibreOffice OK: ${found[0].bin}`);
console.log(found[0].version);
process.exit(0);
