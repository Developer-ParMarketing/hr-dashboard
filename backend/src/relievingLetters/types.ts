import path from "path";
import { fileURLToPath } from "url";
import { formatDojDdMmYyyy, parseFlexibleDoj } from "../employees/dojParse.js";
import { canUseOfferLetters } from "../offerLetters/types.js";
import type { AuthUser } from "../auth/users.js";

export { canUseOfferLetters as canUseRelievingLetters };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const RELIEVING_TEMPLATE_FILENAME = "experience-relieving-letter-template.docx";

export function relievingLetterTemplatePath(): string {
  return path.join(__dirname, "..", "..", "assets", "relieving-letter", RELIEVING_TEMPLATE_FILENAME);
}

export type RelievingLetterInput = {
  letterDate: string;
  employeeName: string;
  employeeCode: string;
  gender: string | null;
  designation: string;
  dateOfJoining: string;
  dateOfLeaving: string;
};

export function salutationFromGender(gender: string | null | undefined): string {
  const g = (gender ?? "").trim().toLowerCase();
  if (g === "f" || g === "female" || g === "woman" || g === "w") return "Ms.";
  if (g === "m" || g === "male" || g === "man") return "Mr.";
  if (g.startsWith("mrs")) return "Mrs.";
  if (g.startsWith("ms")) return "Ms.";
  return "Mr./Ms.";
}

export function formatLetterDate(isoOrText: string): string {
  const iso = parseFlexibleDoj(isoOrText);
  if (iso) return formatDojDdMmYyyy(iso);
  return isoOrText.trim();
}

export function normalizeRelievingLetterInput(raw: Record<string, unknown>): RelievingLetterInput {
  const employeeName = String(raw.employeeName ?? raw.name ?? "").trim();
  const employeeCode = String(raw.employeeCode ?? raw.employee_code ?? "").trim();
  const designation = String(raw.designation ?? raw.department ?? raw.position ?? "").trim();
  const gender = raw.gender != null ? String(raw.gender).trim() : null;

  const letterDateRaw = String(raw.letterDate ?? raw.letter_date ?? "").trim();
  const dojRaw = String(raw.dateOfJoining ?? raw.date_of_joining ?? "").trim();
  const dolRaw = String(raw.dateOfLeaving ?? raw.date_of_leaving ?? "").trim();

  if (!employeeName) {
    throw Object.assign(new Error("Employee name is required"), { status: 400 });
  }
  if (!employeeCode) {
    throw Object.assign(new Error("Employee code is required"), { status: 400 });
  }
  if (!designation) {
    throw Object.assign(new Error("Designation is required"), { status: 400 });
  }

  const letterDateIso = parseFlexibleDoj(letterDateRaw || new Date().toISOString().slice(0, 10));
  const dojIso = parseFlexibleDoj(dojRaw);
  const dolIso = parseFlexibleDoj(dolRaw);

  if (!dojIso) {
    throw Object.assign(new Error("Date of joining must be DD-MM-YYYY"), { status: 400 });
  }
  if (!dolIso) {
    throw Object.assign(new Error("Date of leaving must be DD-MM-YYYY"), { status: 400 });
  }

  return {
    letterDate: formatLetterDate(letterDateIso ?? letterDateRaw),
    employeeName,
    employeeCode,
    gender,
    designation,
    dateOfJoining: formatLetterDate(dojIso),
    dateOfLeaving: formatLetterDate(dolIso),
  };
}

export function requireRelievingLetterAccess(user: AuthUser | undefined): boolean {
  return canUseOfferLetters(user);
}
