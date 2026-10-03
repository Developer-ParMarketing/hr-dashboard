import path from "path";
import { fileURLToPath } from "url";
import { userCanEdit } from "../auth/middleware.js";
import type { AuthUser } from "../auth/users.js";
import { isExecutiveLeaveApprover } from "../leaveRequests/approvers.js";
import { formatDojDdMmYyyy, parseFlexibleDoj } from "../employees/dojParse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const JOINING_FORMS_FILENAME = "Fujitec Joining Forms.xlsx";

export const DEFAULT_COMPANY_NAME = "Par Marketing Pvt. Ltd.";

export function joiningFormsAssetPath(): string {
  return path.join(__dirname, "..", "..", "assets", "offer-letter", "Fujitec-Joining-Forms.xlsx");
}

/** HR, admin, Devanshi, and Jiya. */
export function canUseOfferLetters(user: AuthUser | undefined): boolean {
  if (!user) return false;
  if (userCanEdit(user)) return true;
  return isExecutiveLeaveApprover(user);
}

export type OfferLetterCandidateInput = {
  email: string;
  dateOfJoining: string;
  name: string;
  companyName: string;
  position: string;
  salary: string;
  salutation?: string;
  department?: string;
  placeOfPosting?: string;
  reportingTo?: string;
  employmentType?: string;
  probationPeriod?: string;
  workingHours?: string;
  workingDays?: string;
  acceptByDate?: string;
  offerValidUntil?: string;
  photoCount?: string;
  signatoryName?: string;
  signatoryDesignation?: string;
};

export type OfferLetterCandidateFilled = Required<
  Pick<
    OfferLetterCandidateInput,
    | "email"
    | "dateOfJoining"
    | "name"
    | "companyName"
    | "position"
    | "salary"
    | "salutation"
    | "department"
    | "placeOfPosting"
    | "reportingTo"
    | "employmentType"
    | "probationPeriod"
    | "workingHours"
    | "workingDays"
    | "acceptByDate"
    | "offerValidUntil"
    | "photoCount"
    | "signatoryName"
    | "signatoryDesignation"
  >
> & { probationPeriodText: string };

export type OfferLetterCandidate = OfferLetterCandidateInput & {
  rowKey: string;
};

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function optionalString(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  return s || undefined;
}

function salutationFromRaw(raw: unknown, name: string): string {
  const s = optionalString(raw)?.replace(/\.$/, "");
  if (s) {
    if (/^mx$/i.test(s)) return "Mx.";
    if (/^mrs/i.test(s)) return "Mrs.";
    if (/^ms/i.test(s)) return "Ms.";
    if (/^mr/i.test(s)) return "Mr.";
    return s.endsWith(".") ? s : `${s}.`;
  }
  return "Mr./Ms.";
}

export function formatLongDate(isoOrText: string): string {
  return formatDisplayDate(isoOrText);
}

export function formatDisplayDate(isoOrText: string): string {
  const iso = parseFlexibleDoj(isoOrText);
  if (iso) return formatDojDdMmYyyy(iso);
  return isoOrText;
}

export function enrichOfferLetterCandidate(input: OfferLetterCandidateInput): OfferLetterCandidateFilled {
  const letterDate = todayIso();
  const dojIso = parseFlexibleDoj(input.dateOfJoining) ?? letterDate;
  const acceptIso =
    parseFlexibleDoj(input.acceptByDate ?? "") ?? addDaysIso(letterDate, 7);
  const validIso =
    parseFlexibleDoj(input.offerValidUntil ?? "") ?? addDaysIso(letterDate, 14);

  const probation = optionalString(input.probationPeriod) ?? "3 Months";
  const probationPeriodText = /^3\s*month/i.test(probation)
    ? "three months"
    : probation.toLowerCase().replace(/^\d+\s*/, "").trim() || probation.toLowerCase();

  return {
    email: input.email.trim(),
    dateOfJoining: formatDojDdMmYyyy(dojIso),
    name: input.name.trim(),
    companyName: optionalString(input.companyName) ?? DEFAULT_COMPANY_NAME,
    position: input.position.trim(),
    salary: input.salary.trim(),
    salutation: salutationFromRaw(input.salutation, input.name),
    department: optionalString(input.department) ?? "To be confirmed at joining",
    placeOfPosting: optionalString(input.placeOfPosting) ?? "Mumbai (Andheri West)",
    reportingTo: optionalString(input.reportingTo) ?? "Reporting Manager (as communicated by HR)",
    employmentType: optionalString(input.employmentType) ?? "Full-Time",
    probationPeriod: probation,
    probationPeriodText,
    workingHours: optionalString(input.workingHours) ?? "As per Company policy / shift communicated by HR",
    workingDays: optionalString(input.workingDays) ?? "Monday-Saturday, as applicable",
    acceptByDate: formatDojDdMmYyyy(acceptIso),
    offerValidUntil: formatDojDdMmYyyy(validIso),
    photoCount: optionalString(input.photoCount) ?? "2",
    signatoryName: optionalString(input.signatoryName) ?? "[Authorised Signatory Name]",
    signatoryDesignation: optionalString(input.signatoryDesignation) ?? "[Designation]",
  };
}

export function normalizeCandidateRow(raw: Record<string, unknown>, index: number): OfferLetterCandidateInput {
  const email = String(raw.email ?? raw.Email ?? "").trim();
  const name = String(raw.name ?? raw.Name ?? "").trim();
  const companyName = String(
    raw.companyName ?? raw.company_name ?? raw["company name"] ?? raw["Company Name"] ?? "",
  ).trim();
  const position = String(
    raw.position ?? raw.Position ?? raw.designation ?? raw.Designation ?? "",
  ).trim();
  const salary = String(
    raw.salary ?? raw.Salary ?? raw.ctc ?? raw.CTC ?? raw["annual ctc"] ?? "",
  ).trim();
  const dateOfJoining = String(
    raw.dateOfJoining ?? raw.date_of_joining ?? raw["date of joining"] ?? raw["Date of Joining"] ?? "",
  ).trim();

  if (!email || !name) {
    throw Object.assign(new Error(`Row ${index + 1}: email and name are required`), { status: 400 });
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    throw Object.assign(new Error(`Row ${index + 1}: invalid email "${email}"`), { status: 400 });
  }
  if (!dateOfJoining) {
    throw Object.assign(new Error(`Row ${index + 1}: date of joining is required`), { status: 400 });
  }
  const dojIso = parseFlexibleDoj(dateOfJoining);
  if (!dojIso) {
    throw Object.assign(
      new Error(`Row ${index + 1}: date of joining must be DD-MM-YYYY`),
      { status: 400 },
    );
  }
  if (!position || !salary) {
    throw Object.assign(
      new Error(`Row ${index + 1}: designation/position and annual CTC/salary are required`),
      { status: 400 },
    );
  }

  return {
    email,
    dateOfJoining: formatDojDdMmYyyy(dojIso),
    name,
    companyName: companyName || DEFAULT_COMPANY_NAME,
    position,
    salary,
    salutation: optionalString(raw.salutation ?? raw.Salutation),
    department: optionalString(raw.department ?? raw.Department),
    placeOfPosting: optionalString(raw.placeOfPosting ?? raw["place of posting"]),
    reportingTo: optionalString(raw.reportingTo ?? raw["reporting to"] ?? raw.reporting),
    employmentType: optionalString(raw.employmentType ?? raw["employment type"]),
    probationPeriod: optionalString(raw.probationPeriod ?? raw["probation period"]),
    workingHours: optionalString(raw.workingHours ?? raw["working hours"]),
    workingDays: optionalString(raw.workingDays ?? raw["working days"]),
    acceptByDate: optionalString(raw.acceptByDate ?? raw["accept by"]),
    offerValidUntil: optionalString(raw.offerValidUntil ?? raw["offer valid until"]),
    photoCount: optionalString(raw.photoCount ?? raw["photo count"]),
    signatoryName: optionalString(raw.signatoryName ?? raw["signatory name"]),
    signatoryDesignation: optionalString(raw.signatoryDesignation ?? raw["signatory designation"]),
  };
}

export function interpolateTemplate(template: string, candidate: OfferLetterCandidateInput): string {
  const filled = enrichOfferLetterCandidate(candidate);
  return template
    .replaceAll("{name}", filled.name)
    .replaceAll("{email}", filled.email)
    .replaceAll("{companyName}", filled.companyName)
    .replaceAll("{position}", filled.position)
    .replaceAll("{designation}", filled.position)
    .replaceAll("{salary}", filled.salary)
    .replaceAll("{department}", filled.department)
    .replaceAll("{dateOfJoining}", formatDisplayDate(filled.dateOfJoining))
    .replaceAll("{dateOfJoiningLong}", formatLongDate(filled.dateOfJoining))
    .replaceAll("{today}", formatDisplayDate(todayIso()))
    .replaceAll("{salutation}", filled.salutation);
}

export const DEFAULT_EMAIL_SUBJECT = "Offer of Employment - {position}";

export const DEFAULT_EMAIL_BODY = `Dear {salutation} {name},

Congratulations! Please find attached your formal offer letter for the position of {position} with {companyName}, with a proposed date of joining of {dateOfJoiningLong}.

Your offered annual CTC is ₹{salary} per annum (subject to applicable statutory deductions and company policies).

Also attached are the joining forms. Please complete and return them at your earliest convenience, and confirm acceptance by the date stated in the offer letter.

If you have any questions, reply to this email.

Warm regards,
HR Team
Par Marketing Pvt. Ltd.`;
