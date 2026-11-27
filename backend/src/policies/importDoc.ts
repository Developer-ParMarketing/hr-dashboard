/**
 * Turn an uploaded policy document (PDF, Word .docx or plain .txt) or pasted text into draft policy sections.
 * Nothing is saved here - HR sees the drafts, can fix them, and then adds them.
 * Headings (Word heading styles, numbered titles, ALL CAPS lines, "Title:" lines) start a new section.
 * The first paragraph under a heading becomes the summary; the rest become rules.
 */
import PizZip from "pizzip";
import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";

export type DraftSection = { title: string; summary: string; rules: string[] };

type Para = { text: string; heading: boolean; bullet: boolean };

const MAX_SECTIONS = 30;
const MAX_RULES = 80;

function decodeXml(s: string): string {
    return s
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&amp;/g, "&");
}

/** Paragraphs from word/document.xml, with heading / bullet info from the paragraph style. */
function docxParagraphs(buffer: Buffer): Para[] {
    let xml: string;
    try {
        const zip = new PizZip(buffer);
        const file = zip.file("word/document.xml");
        if (!file) throw new Error("missing document.xml");
        xml = file.asText();
    } catch {
        throw Object.assign(new Error("This file is not a valid Word (.docx) document."), { status: 400 });
    }
    const paras: Para[] = [];
    for (const m of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
        const p = m[0];
        const style = p.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? "";
        const text = decodeXml(
            [...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)]
                .map((t) => (t[1] !== undefined ? t[1] : " "))
                .join(""),
        )
            .replace(/\s+/g, " ")
            .trim();
        if (!text) continue;
        const bold = /<w:b\/>|<w:b w:val="(1|true)"\/>/.test(p) && !/<w:b w:val="(0|false)"\/>/.test(p);
        paras.push({
            text,
            heading: /^(Heading|Title|Subtitle)/i.test(style) || (bold && text.length <= 80 && !/[.;]$/.test(text)),
            bullet: /<w:numPr>/.test(p) || /List/i.test(style),
        });
    }
    return paras;
}

function textParagraphs(text: string): Para[] {
    return text
        .replace(/\r/g, "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
            const bullet = /^([-*•●▪]|\(?[a-z0-9]{1,2}[.)])\s+/i.test(l) && l.length > 3;
            const clean = l.replace(/^#+\s*/, "");
            return { text: clean, heading: looksLikeHeading(l), bullet: bullet && !looksLikeHeading(l) };
        });
}

/** Short line that reads like a title: "1. Purpose", "POSH POLICY", "Leave Policy:", "# Title". */
function looksLikeHeading(line: string): boolean {
    const l = line.trim();
    if (l.startsWith("#")) return true;
    if (l.length > 70 || /[.;,]$/.test(l)) return false;
    if (/^\d+(\.\d+)*[.)]?\s+[A-Z]/.test(l) && l.split(/\s+/).length <= 8) return true;
    if (/:$/.test(l) && l.split(/\s+/).length <= 8) return true;
    const letters = l.replace(/[^A-Za-z]/g, "");
    return letters.length >= 4 && letters === letters.toUpperCase();
}

function tidyTitle(t: string): string {
    const s = t.replace(/^#+\s*/, "").replace(/^\d+(\.\d+)*[.)]?\s+/, "").replace(/:$/, "").trim();
    // "POSH POLICY" -> "Posh Policy" reads better; keep short acronyms (POSH, WFH) upper-case.
    const fixed =
        s === s.toUpperCase()
            ? s
                .toLowerCase()
                .split(/\s+/)
                .filter(Boolean)
                .map((w) => (w.length <= 4 && /^(posh|wfh|hr|pl|sl|cl|lop|ic|icc)$/.test(w) ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)))
                .join(" ")
            : s;
    return fixed.slice(0, 120);
}

function stripBullet(t: string): string {
    return t
        .replace(/^\(?(i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii)[.)]\s+/i, "")
        .replace(/^([-*•●▪◦‣⁃\uf0b7\uf0a7o]|\(?[a-z0-9]{1,2}[.)])\s+/i, "")
        .trim();
}

function toSections(paras: Para[], fallbackTitle: string, prefixDocTitle: boolean): DraftSection[] {
    const sections: DraftSection[] = [];
    let cur: DraftSection | null = null;
    // A heading before any text is the document's own title ("POSH POLICY"). It is put in front of
    // each section title ("POSH Policy - Internal Committee") so the chatbot can find the sections.
    let docTitle = "";
    const start = (title: string) => {
        const t = tidyTitle(title) || fallbackTitle;
        const full = docTitle && !t.toLowerCase().includes(docTitle.toLowerCase()) ? `${docTitle} - ${t}` : t;
        cur = { title: full.slice(0, 120), summary: "", rules: [] };
        sections.push(cur);
    };
    for (const p of paras) {
        if (p.heading) {
            if (prefixDocTitle && !cur && !docTitle) {
                docTitle = tidyTitle(p.text);
                continue;
            }
            const prev = cur as DraftSection | null;
            if (prev && !prev.summary && prev.rules.length === 0) {
                // Two headings in a row: the second one is the real section title.
                sections.pop();
                cur = null;
            }
            start(p.text);
            continue;
        }
        if (!cur) start(docTitle || fallbackTitle);
        const sec = cur as unknown as DraftSection;
        const text = stripBullet(p.text).slice(0, 2000);
        if (!sec.summary && !p.bullet) sec.summary = text.slice(0, 1000);
        else if (sec.rules.length < MAX_RULES) sec.rules.push(text);
    }
    return sections.filter((s) => s.summary || s.rules.length).slice(0, MAX_SECTIONS);
}

/** backend/scripts/pdf_text.py - same folder depth from src/policies (dev) and dist/policies (build). */
const PDF_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "pdf_text.py");
const PYTHON = process.env.PYTHON ?? "python3";

/** PDF text via pdfplumber (already used for the attendance PDF upload). */
async function pdfParagraphs(buffer: Buffer): Promise<Para[]> {
    const tmp = path.join(os.tmpdir(), `policy_${randomUUID()}.pdf`);
    fs.writeFileSync(tmp, buffer);
    try {
        const out = await new Promise<string>((resolve, reject) => {
            execFile(PYTHON, [PDF_SCRIPT, tmp], { maxBuffer: 20 * 1024 * 1024, timeout: 60_000 }, (err, stdout, stderr) => {
                if (err) reject(new Error(stderr?.trim() || err.message));
                else resolve(stdout);
            });
        });
        const data = JSON.parse(out.trim()) as { paragraphs?: Para[]; error?: string };
        if (data.error) throw Object.assign(new Error(data.error), { status: 400 });
        return data.paragraphs ?? [];
    } catch (e) {
        if (e && typeof e === "object" && "status" in e) throw e;
        console.error("[policies] PDF read failed:", e instanceof Error ? e.message : e);
        throw Object.assign(new Error("Could not read this PDF. Try the Word file, or copy the text and use Paste text."), { status: 400 });
    } finally {
        fs.unlink(tmp, () => { });
    }
}

export async function draftSectionsFromUpload(input: {
    buffer?: Buffer;
    filename?: string;
    text?: string;
}): Promise<DraftSection[]> {
    const name = (input.filename ?? "").trim();
    const fallbackTitle = tidyTitle(name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ")) || "New policy";
    let paras: Para[];
    let fromWord = false;
    if (typeof input.text === "string" && input.text.trim()) {
        paras = textParagraphs(input.text);
    } else if (input.buffer) {
        const lower = name.toLowerCase();
        if (lower.endsWith(".docx")) {
            paras = docxParagraphs(input.buffer);
            fromWord = true;
        }
        else if (lower.endsWith(".txt") || lower.endsWith(".md")) paras = textParagraphs(input.buffer.toString("utf8"));
        else if (lower.endsWith(".pdf")) {
            paras = await pdfParagraphs(input.buffer);
            fromWord = true; // a PDF has a real title too ("POSH POLICY") - put it in front of section titles
        } else if (lower.endsWith(".doc")) {
            throw Object.assign(
                new Error("Old .doc files can't be read. In Word: File -> Save As -> .docx (or PDF), then upload again."),
                { status: 400 },
            );
        } else throw Object.assign(new Error("Upload a .pdf, .docx or .txt file."), { status: 400 });
    } else {
        throw Object.assign(new Error("Upload a file or paste the policy text."), { status: 400 });
    }
    const sections = toSections(paras, fallbackTitle, fromWord);
    if (!sections.length) throw Object.assign(new Error("No text found in this document."), { status: 400 });
    return sections;
}