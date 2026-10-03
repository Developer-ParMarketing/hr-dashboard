// Goal sheet - same engine as performance; different DB tables and templates.

import { createCycleFormService } from "../cycleForm/createService.js";
import type { CycleAnswerRow, CycleSubmissionView } from "../cycleForm/types.js";
import { getGoalSheetTemplate, GOAL_SHEET_RATING_SCALE } from "./templates.js";

const cycle = createCycleFormService({
  submissionsTable: "goal_sheet_submissions",
  answersTable: "goal_sheet_answers",
  getTemplate: getGoalSheetTemplate,
  getRatingScale: () => GOAL_SHEET_RATING_SCALE.map((row) => ({ ...row })),
  resourceLabel: "goal sheet",
  employeeWindowKind: "goal_sheet_january",
});

export type GoalSheetAnswerRow = CycleAnswerRow;
export type GoalSheetSubmissionView = CycleSubmissionView;

export const resolveDefaultGoalSheetCycleYear = cycle.resolveDefaultCycleYear;
export const buildGoalSheetSubmissionView = cycle.buildSubmissionView;
export const resolveMyEmployeeId = cycle.resolveMyEmployeeId;
export const listTeamGoalSheetSummaries = cycle.listTeamSummaries;
export const listLeadershipGoalSheetSummaries = cycle.listLeadershipSummaries;
export const listAdminGoalSheetSummaries = cycle.listAdminSummaries;
export const saveGoalSheetSubmission = cycle.saveSubmission;
export function getGoalSheetRatingScale() {
  return cycle.getRatingScale();
}
