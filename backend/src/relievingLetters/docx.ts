import fs from "fs";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import {
  formatLetterDate,
  relievingLetterTemplatePath,
  salutationFromGender,
  type RelievingLetterInput,
} from "./types.js";

export function templateAvailable(): boolean {
  return fs.existsSync(relievingLetterTemplatePath());
}

export function generateRelievingLetterDocx(input: RelievingLetterInput): Buffer {
  const path = relievingLetterTemplatePath();
  if (!fs.existsSync(path)) {
    throw Object.assign(new Error("Experience / relieving letter template is missing on the server"), {
      status: 500,
    });
  }

  const zip = new PizZip(fs.readFileSync(path));
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "[[", end: "]]" },
  });

  doc.render({
    letterDate: formatLetterDate(input.letterDate),
    employeeName: input.employeeName,
    employeeCode: input.employeeCode,
    salutation: salutationFromGender(input.gender),
    designation: input.designation,
    dateOfJoining: formatLetterDate(input.dateOfJoining),
    dateOfLeaving: formatLetterDate(input.dateOfLeaving),
  });

  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}

export function safeDownloadBasename(name: string, code: string): string {
  const base = `${code}-${name}`.replace(/[^\w\s-]+/g, "").trim().replace(/\s+/g, "-");
  return base.slice(0, 80) || "relieving-letter";
}
