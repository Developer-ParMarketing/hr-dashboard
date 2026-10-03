import type { AppraisalCriterion, AppraisalTemplate } from "../performance/templates.js";

export type CycleFormTables = {
  submissionsTable: "performance_appraisal_submissions" | "goal_sheet_submissions";
  answersTable: "performance_appraisal_answers" | "goal_sheet_answers";
};

export type CycleFormEmployeeEditPolicy = "linked" | "doj30";

export type CycleFormWindowKind = "goal_sheet_january" | "appraisal_doj_anniversary";

export type CycleFormModuleConfig = CycleFormTables & {
  getTemplate: (teamSlug: string | null | undefined) => AppraisalTemplate | null;
  getRatingScale: () => Array<{ value: number; label: string; note: string }>;
  /** Singular noun for errors, e.g. "appraisal" or "goal sheet" */
  resourceLabel: string;
  employeeWindowKind: CycleFormWindowKind;
  /**
   * @deprecated use employeeWindowKind; kept for compatibility
   */
  employeeEditPolicy?: CycleFormEmployeeEditPolicy;
};

export type { AppraisalCriterion, AppraisalTemplate };

export type CycleAnswerRow = {
  criterionIndex: number;
  employeeRating: number | null;
  employeeComments: string | null;
  managerRating: number | null;
  managerComments: string | null;
  managementRating: number | null;
  managementComments: string | null;
};

export type CycleSubmissionView = {
  id: number;
  cycleYear: number;
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  teamSlug: string | null;
  teamName: string | null;
  dateOfJoining: string | null;
  canFill: boolean;
  daysUntilEditable: number | null;
  canEditEmployeeFields: boolean;
  canEditManagerFields: boolean;
  canEditManagementFields: boolean;
  showManagerReview: boolean;
  showManagementReview: boolean;
  managerSubmittedAt: string | null;
  employeeSubmittedAt: string | null;
  managementSubmittedAt: string | null;
  overallEmployeeRating: number | null;
  overallManagerRating: number | null;
  overallManagementRating: number | null;
  overallEmployeeComments: string | null;
  overallManagerComments: string | null;
  overallManagementComments: string | null;
  answers: CycleAnswerRow[];
  template: AppraisalTemplate | null;
  employeeUpdatedAt: string | null;
  managerUpdatedAt: string | null;
  managementUpdatedAt: string | null;
  /** Past cycle years with saved data (read-only in UI). */
  historyCycleYears: number[];
  activeCycleYear: number;
  employeeWindowOpen: boolean;
  /** Goal sheet only: why employee self-edit may be blocked. */
  employeeEditNote?: string | null;
};
