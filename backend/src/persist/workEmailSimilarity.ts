import { cellStr } from "./helpers.js";
import { nameSimilarityScore } from "./employeeLinkage.js";

const SIMILAR_MIN_SCORE = 82;

export type SimilarWorkEmailHit = {
  employeeId: number;
  employeeCode: string;
  name: string;
  email: string;
  kind: "duplicate" | "similar";
  score: number;
};

export function normalizeWorkEmail(raw: string | null | undefined): string {
  return cellStr(raw ?? "").toLowerCase();
}

function splitEmail(email: string): { local: string; domain: string } | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at >= email.length - 1) return null;
  return { local: email.slice(0, at), domain: email.slice(at + 1) };
}

/** 0-100 similarity for work addresses (typo / duplicate hire detection). */
export function workEmailSimilarity(a: string, b: string): number {
  const left = normalizeWorkEmail(a);
  const right = normalizeWorkEmail(b);
  if (!left || !right) return 0;
  if (left === right) return 100;

  const pa = splitEmail(left);
  const pb = splitEmail(right);
  if (!pa || !pb) return nameSimilarityScore(left, right);

  if (pa.domain === pb.domain) {
    return nameSimilarityScore(pa.local, pb.local);
  }
  return Math.max(nameSimilarityScore(left, right) * 0.65, nameSimilarityScore(pa.local, pb.local) * 0.5);
}

export function classifyWorkEmailPair(
  candidate: string,
  existing: string,
): { kind: "duplicate" | "similar"; score: number } | null {
  const score = workEmailSimilarity(candidate, existing);
  if (normalizeWorkEmail(candidate) === normalizeWorkEmail(existing)) {
    return { kind: "duplicate", score: 100 };
  }
  if (score >= SIMILAR_MIN_SCORE) {
    return { kind: "similar", score };
  }
  return null;
}

export function findSimilarWorkEmailsAmong(
  candidateEmail: string,
  roster: { id: number; employee_code: string; name: string; email: string | null }[],
  excludeEmployeeId?: number | null,
): SimilarWorkEmailHit[] {
  const candidate = normalizeWorkEmail(candidateEmail);
  if (!candidate || !candidate.includes("@")) return [];

  const hits: SimilarWorkEmailHit[] = [];
  for (const row of roster) {
    if (excludeEmployeeId != null && row.id === excludeEmployeeId) continue;
    const other = normalizeWorkEmail(row.email);
    if (!other) continue;
    const classified = classifyWorkEmailPair(candidate, other);
    if (!classified) continue;
    hits.push({
      employeeId: row.id,
      employeeCode: row.employee_code,
      name: row.name,
      email: other,
      kind: classified.kind,
      score: Math.round(classified.score * 10) / 10,
    });
  }

  hits.sort((a, b) => {
    if (a.kind === "duplicate" && b.kind !== "duplicate") return -1;
    if (b.kind === "duplicate" && a.kind !== "duplicate") return 1;
    return b.score - a.score;
  });
  return hits;
}
