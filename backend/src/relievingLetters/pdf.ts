import { PDFDocument } from "pdf-lib";
import { convertDocxBufferToPdf } from "./libreOffice.js";
import { generateRelievingLetterDocx } from "./docx.js";
import type { RelievingLetterInput } from "./types.js";

function isPng(buf: Buffer): boolean {
  return buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50;
}

function isJpeg(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8;
}

/** Place signature above the signatory line (A4, bottom area). */
export async function stampSignatureOnPdf(pdfBuffer: Buffer, signature: Buffer): Promise<Buffer> {
  if (!isPng(signature) && !isJpeg(signature)) {
    throw Object.assign(new Error("Signature must be a PNG or JPEG image"), { status: 400 });
  }

  const pdf = await PDFDocument.load(pdfBuffer);
  const page = pdf.getPages()[0];
  if (!page) {
    throw Object.assign(new Error("Generated PDF has no pages"), { status: 500 });
  }

  const embedded = isPng(signature)
    ? await pdf.embedPng(signature)
    : await pdf.embedJpg(signature);

  const { width } = page.getSize();
  const maxW = 140;
  const scale = maxW / embedded.width;
  const drawW = embedded.width * scale;
  const drawH = embedded.height * scale;
  const x = width / 2 - drawW / 2;
  const y = 95;

  page.drawImage(embedded, { x, y, width: drawW, height: drawH });

  return Buffer.from(await pdf.save());
}

export async function generateRelievingLetterPdf(
  input: RelievingLetterInput,
  signature: Buffer,
): Promise<Buffer> {
  const docx = generateRelievingLetterDocx(input);
  let pdf = await convertDocxBufferToPdf(docx);
  pdf = await stampSignatureOnPdf(pdf, signature);
  return pdf;
}
