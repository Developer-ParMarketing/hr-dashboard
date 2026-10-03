import { cellStr } from "./helpers.js";

export type EmployeeRosterRow = {
  id: number;
  employee_code: string;
  name: string;
};

const MIN_LINK_SCORE = 82;
const MIN_LINK_GAP = 4;

export function normEmployeeCode(code: string): string {
  return cellStr(code).replace(/\s+/g, "").toUpperCase();
}

export function normNameKey(name: string): string {
  return cellStr(name).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Token-set style similarity 0-100 (same idea as merge / rapidfuzz token_set_ratio). */
export function nameSimilarityScore(a: string, b: string): number {
  const left = normNameKey(a);
  const right = normNameKey(b);
  if (!left || !right) return 0;
  if (left === right) return 100;

  const leftTokens = new Set(left.match(/[a-z0-9]+/g) ?? [left]);
  const rightTokens = new Set(right.match(/[a-z0-9]+/g) ?? [right]);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let inter = 0;
  for (const t of leftTokens) {
    if (rightTokens.has(t)) inter += 1;
  }
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const tokenSet = union > 0 ? (inter / union) * 100 : 0;

  let partial = 0;
  const short = left.length <= right.length ? left : right;
  const long = left.length <= right.length ? right : left;
  for (let i = 0; i <= long.length - short.length; i++) {
    const chunk = long.slice(i, i + short.length);
    partial = Math.max(partial, ratioTwoStrings(short, chunk) * 100);
  }

  return Math.max(tokenSet, partial, ratioTwoStrings(left, right) * 100);
}

function ratioTwoStrings(a: string, b: string): number {
  if (a === b) return 1;
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return 0;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i]![0] = i;
  for (let j = 0; j <= m; j++) dp[0]![j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  const dist = dp[n]![m]!;
  return 1 - dist / Math.max(n, m);
}

function codeSimilarityScore(a: string, b: string): number {
  const left = normEmployeeCode(a);
  const right = normEmployeeCode(b);
  if (!left || !right) return 0;
  if (left === right) return 100;
  return ratioTwoStrings(left, right) * 100;
}

export type LinkageResult =
  | { id: number; method: "code" }
  | { id: number; method: "name" };

/**
 * Match Excel row to an employee: exact code first, then scored name/code similarity (unique winner only).
 */
export function resolveEmployeeLinkage(
  roster: EmployeeRosterRow[],
  input: { code: string; name: string },
): LinkageResult | null {
  const code = normEmployeeCode(input.code);
  const name = cellStr(input.name);

  if (code) {
    const byCode = roster.find((e) => normEmployeeCode(e.employee_code) === code);
    if (byCode) return { id: byCode.id, method: "code" };
  }

  if (!name && !code) return null;

  const scored: { id: number; score: number }[] = [];
  for (const e of roster) {
    let score = nameSimilarityScore(name, e.name);
    if (code && e.employee_code) {
      const cs = codeSimilarityScore(code, e.employee_code);
      score = code ? Math.max(score * 0.55 + cs * 0.45, score, cs * 0.85) : score;
    }
    if (score >= MIN_LINK_SCORE) {
      scored.push({ id: e.id, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;
  if (scored.length >= 2 && scored[0]!.score - scored[1]!.score < MIN_LINK_GAP) {
    return null;
  }
  return { id: scored[0]!.id, method: "name" };
}
