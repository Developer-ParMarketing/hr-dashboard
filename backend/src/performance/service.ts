// Performance appraisal - wired into cycleForm/createService.ts (see repo README).

import { createCycleFormService } from "../cycleForm/createService.js";
import type { CycleAnswerRow, CycleSubmissionView } from "../cycleForm/types.js";
import { APPRAISAL_RATING_SCALE, getAppraisalTemplate } from "./templates.js";

const cycle = createCycleFormService({
  submissionsTable: "performance_appraisal_submissions",
  answersTable: "performance_appraisal_answers",
  getTemplate: getAppraisalTemplate,
  getRatingScale: () => APPRAISAL_RATING_SCALE.map((row) => ({ ...row })),
  resourceLabel: "appraisal",
  employeeWindowKind: "appraisal_doj_anniversary",
});

export type AppraisalAnswerRow = CycleAnswerRow;
export type AppraisalSubmissionView = CycleSubmissionView;

export const resolveDefaultAppraisalCycleYear = cycle.resolveDefaultCycleYear;
export const buildSubmissionView = cycle.buildSubmissionView;
export const resolveMyEmployeeId = cycle.resolveMyEmployeeId;
export const listTeamAppraisalSummaries = cycle.listTeamSummaries;
export const listLeadershipAppraisalSummaries = cycle.listLeadershipSummaries;
export const listAdminAppraisalSummaries = cycle.listAdminSummaries;
export const saveAppraisalSubmission = cycle.saveSubmission;
export function getRatingScale() {
  return cycle.getRatingScale();
}
