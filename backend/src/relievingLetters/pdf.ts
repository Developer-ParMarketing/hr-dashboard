import { convertDocxBufferToPdf } from "./libreOffice.js";
import { generateRelievingLetterDocx } from "./docx.js";
import type { RelievingLetterInput } from "./types.js";

/**
 * Word template -> PDF. The signature is placed inside the Word file (above
 * "AUTHORISED SIGNATORY"), so it always lands in the right spot.
 */
export async function generateRelievingLetterPdf(
  input: RelievingLetterInput,
  signature: Buffer,
): Promise<Buffer> {
  const docx = generateRelievingLetterDocx(input, signature);
  return convertDocxBufferToPdf(docx);
}