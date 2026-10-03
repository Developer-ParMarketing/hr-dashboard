import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SOFFICE_CANDIDATES = [
  "soffice",
  "libreoffice",
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  "/usr/bin/libreoffice",
  "/usr/bin/soffice",
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
];

let cachedSoffice: string | null | undefined;

export async function findLibreOfficeBinary(): Promise<string | null> {
  if (cachedSoffice !== undefined) return cachedSoffice;
  const soffice = process.env.LIBREOFFICE_PATH?.trim() || process.env.SOFFICE_PATH?.trim();
  if (soffice && fs.existsSync(soffice)) {
    try {
      await execFileAsync(soffice, ["--version"], { timeout: 8000 });
      cachedSoffice = soffice;
      return soffice;
    } catch {
      /* fall through to candidates */
    }
  }

  for (const bin of SOFFICE_CANDIDATES) {
    try {
      if (bin.includes("/") || bin.includes("\\")) {
        if (!fs.existsSync(bin)) continue;
      }
      await execFileAsync(bin, ["--version"], { timeout: 8000 });
      cachedSoffice = bin;
      return bin;
    } catch {
      continue;
    }
  }
  cachedSoffice = null;
  return null;
}

export async function libreOfficePdfAvailable(): Promise<boolean> {
  return (await findLibreOfficeBinary()) != null;
}

/** Convert filled DOCX (with letterhead) to PDF via LibreOffice. */
export async function convertDocxBufferToPdf(docx: Buffer): Promise<Buffer> {
  const soffice = await findLibreOfficeBinary();
  if (!soffice) {
    throw Object.assign(
      new Error(
        "PDF export needs LibreOffice. From backend run: npm run setup:libreoffice - then restart the API.",
      ),
      { status: 503 },
    );
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rel-letter-"));
  const docxPath = path.join(tmpDir, "letter.docx");
  const pdfPath = path.join(tmpDir, "letter.pdf");
  try {
    fs.writeFileSync(docxPath, docx);
    await execFileAsync(
      soffice,
      ["--headless", "--nologo", "--nofirststartwizard", "--convert-to", "pdf", "--outdir", tmpDir, docxPath],
      { timeout: 120_000 },
    );
    if (!fs.existsSync(pdfPath)) {
      throw Object.assign(new Error("LibreOffice did not produce a PDF file"), { status: 500 });
    }
    return fs.readFileSync(pdfPath);
  } finally {
    for (const f of [docxPath, pdfPath]) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
    try {
      fs.rmdirSync(tmpDir);
    } catch {
      /* ignore */
    }
  }
}
