import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIGNATURE_DIR = path.join(__dirname, "..", "..", "assets", "relieving-letter", "signatures");

function signaturePaths(userId: number): string[] {
  return [".png", ".jpg", ".jpeg"].map((ext) => path.join(SIGNATURE_DIR, `${userId}${ext}`));
}

export function saveUserSignature(userId: number, image: Buffer): void {
  fs.mkdirSync(SIGNATURE_DIR, { recursive: true });
  for (const p of signaturePaths(userId)) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
  const ext =
    image[0] === 0xff && image[1] === 0xd8 ? ".jpg" : ".png";
  fs.writeFileSync(path.join(SIGNATURE_DIR, `${userId}${ext}`), image);
}

export function loadUserSignature(userId: number): Buffer | null {
  for (const p of signaturePaths(userId)) {
    if (fs.existsSync(p)) return fs.readFileSync(p);
  }
  return null;
}

export function userHasSavedSignature(userId: number): boolean {
  return signaturePaths(userId).some((p) => fs.existsSync(p));
}
