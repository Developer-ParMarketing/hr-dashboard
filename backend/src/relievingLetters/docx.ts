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

function isPng(buf: Buffer): boolean {
  return buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

function isJpeg(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8;
}

/** Pixel size of a PNG / JPEG (null when it cannot be read). */
function imageSize(buf: Buffer): { width: number; height: number } | null {
  if (isPng(buf)) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (isJpeg(buf)) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buf[i + 1]!;
      // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      const len = buf.readUInt16BE(i + 2);
      if (len < 2) break;
      i += 2 + len;
    }
  }
  return null;
}

const EMU_PER_INCH = 914400;
/** Signature box on the letter: at most 2.0" wide and 0.75" tall, aspect kept. */
const SIG_MAX_W_IN = 2.0;
const SIG_MAX_H_IN = 0.75;

function signatureParagraphXml(relId: string, widthEmu: number, heightEmu: number): string {
  return (
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:ind w:left="240"/></w:pPr>` +
    `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${widthEmu}" cy="${heightEmu}"/>` +
    `<wp:docPr id="9001" name="Authorised signature"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="9001" name="signature"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
  );
}

/**
 * Put the signature image inside the Word document, in the blank lines between
 * "For Par Marketing Private Limited." and "AUTHORISED SIGNATORY", so it always
 * sits right above the signatory text (Word and PDF both).
 */
function injectSignature(zip: PizZip, signature: Buffer): void {
  const size = imageSize(signature);
  if (!size || size.width <= 0 || size.height <= 0) {
    throw Object.assign(new Error("Signature must be a PNG or JPEG image"), { status: 400 });
  }
  const ext = isPng(signature) ? "png" : "jpeg";
  const mediaName = `hr_signature.${ext}`;
  zip.file(`word/media/${mediaName}`, signature);

  // Content type for the image extension
  const ctPath = "[Content_Types].xml";
  let ct = zip.file(ctPath)?.asText() ?? "";
  if (!new RegExp(`Extension="${ext}"`, "i").test(ct)) {
    ct = ct.replace("</Types>", `<Default Extension="${ext}" ContentType="image/${ext}"/></Types>`);
    zip.file(ctPath, ct);
  }

  // Relationship from document.xml to the image
  const relsPath = "word/_rels/document.xml.rels";
  const relId = "rIdHrSignature";
  let rels = zip.file(relsPath)?.asText() ?? "";
  if (!rels.includes(`Id="${relId}"`)) {
    rels = rels.replace(
      "</Relationships>",
      `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${mediaName}"/></Relationships>`,
    );
    zip.file(relsPath, rels);
  }

  // Size: fit inside the box, keep aspect ratio
  const scale = Math.min(SIG_MAX_W_IN / size.width, SIG_MAX_H_IN / size.height);
  const widthEmu = Math.round(size.width * scale * EMU_PER_INCH);
  const heightEmu = Math.round(size.height * scale * EMU_PER_INCH);
  const para = signatureParagraphXml(relId, widthEmu, heightEmu);

  const docPath = "word/document.xml";
  let xml = zip.file(docPath)?.asText() ?? "";
  const sigTextIdx = xml.indexOf("AUTHORISED SIGNATORY");
  if (sigTextIdx < 0) {
    throw Object.assign(
      new Error('Template has no "AUTHORISED SIGNATORY" text - cannot place the signature'),
      { status: 500 },
    );
  }
  const sigParaStart = xml.lastIndexOf("<w:p ", sigTextIdx);
  // Swallow the empty paragraphs right before the signatory line (they were the blank gap).
  let start = sigParaStart;
  const emptyPara = /<w:p [^>]*\/>$/;
  for (; ;) {
    const before = xml.slice(0, start);
    const m = before.match(emptyPara);
    if (!m) break;
    start -= m[0].length;
  }
  xml = xml.slice(0, start) + para + xml.slice(sigParaStart);
  zip.file(docPath, xml);
}

export function generateRelievingLetterDocx(input: RelievingLetterInput, signature?: Buffer | null): Buffer {
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

  const out = doc.getZip();
  if (signature?.length) injectSignature(out, signature);
  return out.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}

export function safeDownloadBasename(name: string, code: string): string {
  const base = `${code}-${name}`.replace(/[^\w\s-]+/g, "").trim().replace(/\s+/g, "-");
  return base.slice(0, 80) || "relieving-letter";
}