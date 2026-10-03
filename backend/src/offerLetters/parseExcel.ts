import XLSX from "xlsx";
import { normalizeCandidateRow, type OfferLetterCandidateInput } from "./types.js";

function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

const HEADER_MAP: Record<string, keyof OfferLetterCandidateInput> = {
  email: "email",
  "date of joining": "dateOfJoining",
  doj: "dateOfJoining",
  name: "name",
  "company name": "companyName",
  company: "companyName",
  position: "position",
  designation: "position",
  salary: "salary",
  compensation: "salary",
  ctc: "salary",
  "annual ctc": "salary",
  salutation: "salutation",
  department: "department",
  "place of posting": "placeOfPosting",
  "reporting to": "reportingTo",
  reporting: "reportingTo",
  "employment type": "employmentType",
  "probation period": "probationPeriod",
  "working hours": "workingHours",
  "working days": "workingDays",
  "accept by": "acceptByDate",
  "offer valid until": "offerValidUntil",
  "photo count": "photoCount",
  "signatory name": "signatoryName",
  "signatory designation": "signatoryDesignation",
};

function excelSerialToIso(serial: number): string {
  const epoch = Date.UTC(1899, 11, 30);
  const ms = epoch + serial * 86400000;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function cellToString(val: unknown): string {
  if (val == null || val === "") return "";
  if (typeof val === "number" && val > 20000 && val < 60000) {
    return excelSerialToIso(val);
  }
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10);
  }
  return String(val).trim();
}

export function parseOfferLetterExcel(buffer: Buffer): OfferLetterCandidateInput[] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    throw Object.assign(new Error("Excel file has no sheets"), { status: 400 });
  }
  const sheet = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  if (matrix.length < 2) {
    throw Object.assign(new Error("Excel must have a header row and at least one data row"), { status: 400 });
  }

  const headerRow = matrix[0].map((c) => normalizeHeader(String(c ?? "")));
  const colIndex: Partial<Record<keyof OfferLetterCandidateInput, number>> = {};
  for (let i = 0; i < headerRow.length; i++) {
    const key = HEADER_MAP[headerRow[i] ?? ""];
    if (key) colIndex[key] = i;
  }

  const required: Array<keyof OfferLetterCandidateInput> = [
    "email",
    "dateOfJoining",
    "name",
    "position",
    "salary",
  ];
  const missing = required.filter((k) => colIndex[k] == null);
  if (missing.length > 0) {
    throw Object.assign(
      new Error(
        `Missing columns in Excel: ${missing.join(", ")}. Expected headers like Email, Date of joining, Name, Position/Designation, Salary/CTC. Company name is optional (defaults to Par Marketing Pvt. Ltd.).`,
      ),
      { status: 400 },
    );
  }

  const rows: OfferLetterCandidateInput[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const line = matrix[r];
    if (!line || line.every((c) => String(c ?? "").trim() === "")) continue;
    const raw: Record<string, unknown> = {};
    for (const key of [...required, ...new Set(Object.values(HEADER_MAP))]) {
      const idx = colIndex[key];
      if (idx == null) continue;
      raw[key] = cellToString(line[idx]);
    }
    rows.push(normalizeCandidateRow(raw, rows.length));
  }

  if (rows.length === 0) {
    throw Object.assign(new Error("No candidate rows found in Excel"), { status: 400 });
  }
  return rows;
}

export function parseOfferLetterCandidatesFromBody(items: unknown): OfferLetterCandidateInput[] {
  if (!Array.isArray(items)) {
    throw Object.assign(new Error("candidates must be an array"), { status: 400 });
  }
  return items.map((row, index) => normalizeCandidateRow((row ?? {}) as Record<string, unknown>, index));
}
