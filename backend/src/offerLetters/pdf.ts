import fs from "fs";
import PDFDocument from "pdfkit";
import { offerLetterPlainParagraphs } from "./offerLetterContent.js";
import {
  enrichOfferLetterCandidate,
  formatLongDate,
  joiningFormsAssetPath,
  type OfferLetterCandidateInput,
} from "./types.js";

const MARGIN = 56;
const PAGE_BOTTOM = 780;

function ensureSpace(doc: InstanceType<typeof PDFDocument>, y: number, need: number): number {
  if (y + need > PAGE_BOTTOM) {
    doc.addPage();
    return MARGIN;
  }
  return y;
}

export function generateOfferLetterPdf(candidate: OfferLetterCandidateInput): Promise<Buffer> {
  const c = enrichOfferLetterCandidate(candidate);
  const paragraphs = offerLetterPlainParagraphs(c);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: MARGIN });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const letterDate = formatLongDate(new Date().toISOString().slice(0, 10));
    let y = MARGIN;

    doc.font("Helvetica-Bold").fontSize(12).text(`Offer of Employment - ${c.position}`, MARGIN, y, {
      align: "center",
      width: doc.page.width - MARGIN * 2,
    });
    y = doc.y + 16;

    doc.font("Helvetica").fontSize(10).text(`Date: ${letterDate}`, MARGIN, y);
    y = doc.y + 14;

    for (const block of paragraphs) {
      if (block === "") {
        y = ensureSpace(doc, y, 10);
        y += 8;
        continue;
      }

      const isBullet = block.startsWith("• ");
      const isSectionHead = /^\d+\.\s/.test(block);
      const isParticularsLine =
        block.startsWith("Designation:") ||
        block.startsWith("Department:") ||
        block.startsWith("Date of Joining:") ||
        block.startsWith("Place of Posting:") ||
        block.startsWith("Reporting To:") ||
        block.startsWith("Employment Type:") ||
        block.startsWith("Probation Period:") ||
        block.startsWith("Annual CTC:") ||
        block.startsWith("Working Hours:") ||
        block.startsWith("Working Days:");

      y = ensureSpace(doc, y, 14);
      if (isSectionHead) {
        doc.font("Helvetica-Bold").fontSize(10);
      } else if (isParticularsLine) {
        doc.font("Helvetica").fontSize(10);
      } else {
        doc.font("Helvetica").fontSize(10);
      }

      const text = isBullet ? block.slice(2) : block;
      const opts: { width: number; align: "left" | "justify"; lineGap: number } = {
        width: doc.page.width - MARGIN * 2,
        align: "left",
        lineGap: 2,
      };
      if (isBullet) {
        doc.text(`• ${text}`, MARGIN + 8, y, opts);
      } else {
        doc.text(text, MARGIN, y, { ...opts, align: isSectionHead ? "left" : "justify" });
      }
      y = doc.y + (isSectionHead ? 6 : 4);
    }

    doc.end();
  });
}

export function readJoiningFormsAttachment(): Buffer {
  const p = joiningFormsAssetPath();
  if (!fs.existsSync(p)) {
    throw Object.assign(new Error("Joining forms attachment is missing on the server"), { status: 500 });
  }
  return fs.readFileSync(p);
}
