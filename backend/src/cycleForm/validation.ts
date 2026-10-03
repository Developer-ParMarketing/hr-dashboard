import type { AppraisalCriterion } from "../performance/templates.js";

export type CycleFormSubmitRole = "employee" | "manager" | "management";

export function assertCycleFormSubmitComplete(
  role: CycleFormSubmitRole,
  criteria: AppraisalCriterion[],
  answers: Array<{
    criterionIndex: number;
    rating?: number | null;
    comments?: string | null;
  }>,
  overallRating: number | null,
  overallComments: string | null | undefined,
): void {
  void role;
  const missing: string[] = [];
  for (const c of criteria) {
    const row = answers.find((a) => a.criterionIndex === c.index);
    const rating = row?.rating;
    const comments =
      row?.comments === undefined || row?.comments === null
        ? ""
        : String(row.comments).trim();
    if (rating == null || rating < 1 || rating > 5) {
      missing.push(`Item ${c.index} (${c.title}): rating`);
    }
    if (!comments) {
      missing.push(`Item ${c.index} (${c.title}): comments`);
    }
  }
  if (overallRating == null || overallRating < 1 || overallRating > 5) {
    missing.push("Overall rating");
  }
  const overallCommentText =
    overallComments === undefined || overallComments === null
      ? ""
      : String(overallComments).trim();
  if (!overallCommentText) {
    missing.push("Overall comments");
  }
  if (missing.length === 0) return;

  const preview = missing.slice(0, 4).join("; ");
  const extra = missing.length > 4 ? ` (+${missing.length - 4} more)` : "";
  throw Object.assign(
    new Error(
      `Submit requires every goal/skill to have a rating (1-5) and comments, plus an overall rating and overall comments. Still missing: ${preview}${extra}.`,
    ),
    { status: 400 },
  );
}
