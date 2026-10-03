// Shared year-cycle forms: performance appraisal and goal sheet use the same
// submit flow (employee → manager → management), different tables/templates via config.

import { query, queryOne, withTransaction } from "../db/index.js";
import { findEmployeeIdByUserEmail } from "../auth/attendanceScope.js";
import { getAssignedEmployeeIds } from "../auth/managerAssignments.js";
import { userCanEdit, userIsAdmin } from "../auth/middleware.js";
import type { AuthUser } from "../auth/users.js";
import { isLeadershipReviewer } from "../performance/leadership.js";
import { isExecutiveLeaveApprover } from "../leaveRequests/approvers.js";
import type { AppraisalCriterion } from "../performance/templates.js";
import type { CycleFormModuleConfig, CycleSubmissionView } from "./types.js";
import { assertCycleFormSubmitComplete } from "./validation.js";
import {
  coerceCycleYearForView,
  daysUntilEmployeeWindowForPolicy,
  defaultCycleYearForPolicy,
  employeeWindowOpenForPolicy,
  filterHistoryCycleYears,
  goalSheetEmployeeEditNote,
  goalSheetOnProbation,
  resolveActiveCycleYearForPolicy,
} from "./windowPolicy.js";

type EmployeeContext = {
  id: number;
  employee_code: string;
  name: string;
  email: string | null;
  date_of_joining: string | null;
  team_slug: string | null;
  team_name: string | null;
};

export function createCycleFormService(config: CycleFormModuleConfig) {
  const {
    submissionsTable,
    answersTable,
    getTemplate,
    getRatingScale,
    resourceLabel,
    employeeWindowKind,
  } = config;
  const resourceTitle = resourceLabel.charAt(0).toUpperCase() + resourceLabel.slice(1);

  function employeeSelfEditAllowed(doj: string | null, linkedId: number | null, employeeId: number): boolean {
    return linkedId === employeeId;
  }

  async function listHistoryCycleYears(employeeId: number, activeCycleYear: number): Promise<number[]> {
    const rows = await query<{ cycle_year: number }>(
      `SELECT DISTINCT cycle_year FROM ${submissionsTable}
       WHERE employee_id = $1
       ORDER BY cycle_year DESC`,
      [employeeId],
    );
    return filterHistoryCycleYears(
      activeCycleYear,
      rows.map((r) => r.cycle_year),
    );
  }

  function resolveActiveCycleYear(doj: string | null): number {
    return resolveActiveCycleYearForPolicy({ kind: employeeWindowKind, doj });
  }

  async function loadEmployeeContext(employeeId: number): Promise<EmployeeContext | null> {
    const row = await queryOne<EmployeeContext>(
      `SELECT e.id, e.employee_code, e.name, e.email, e.date_of_joining,
              t.slug AS team_slug, t.name AS team_name
       FROM employees e
       LEFT JOIN teams t ON t.id = e.team_id
       WHERE e.id = $1`,
      [employeeId],
    );
    return row ?? null;
  }

  function isoDoj(row: EmployeeContext): string | null {
    if (!row.date_of_joining) return null;
    return String(row.date_of_joining).slice(0, 10);
  }

  function validateRating(value: unknown): number | null {
    if (value == null || value === "") return null;
    const n = Number.parseInt(String(value), 10);
    if (!Number.isFinite(n) || n < 1 || n > 5) {
      throw Object.assign(new Error("Ratings must be between 1 and 5"), { status: 400 });
    }
    return n;
  }

  async function isManagerOfEmployee(managerUserId: number, employeeId: number): Promise<boolean> {
    const row = await queryOne<{ id: number }>(
      `SELECT id FROM manager_employee_assignments
       WHERE manager_user_id = $1 AND employee_id = $2`,
      [managerUserId, employeeId],
    );
    return row != null;
  }

  async function viewerCanEditManagerFields(
    user: AuthUser,
    employeeId: number,
    cycleYear: number,
  ): Promise<boolean> {
    const emp = await loadEmployeeContext(employeeId);
    if (!emp) return false;
    if (!(await isManagerOfEmployee(user.id, employeeId))) return false;

    const submitted = await queryOne<{
      manager_submitted_at: Date | null;
      employee_submitted_at: Date | null;
    }>(
      `SELECT manager_submitted_at, employee_submitted_at FROM ${submissionsTable}
       WHERE employee_id = $1 AND cycle_year = $2`,
      [employeeId, cycleYear],
    );
    if (submitted?.manager_submitted_at) return false;
    if (!submitted?.employee_submitted_at) return false;

    return true;
  }

  async function viewerCanEditEmployeeFields(
    user: AuthUser,
    employeeId: number,
    cycleYear: number,
  ): Promise<boolean> {
    const emp = await loadEmployeeContext(employeeId);
    if (!emp) return false;
    const linkedId = await findEmployeeIdByUserEmail(user.email);
    if (!employeeSelfEditAllowed(isoDoj(emp), linkedId, employeeId)) return false;
    if (employeeWindowKind === "goal_sheet_january" && !isoDoj(emp)) return false;

    const submitted = await queryOne<{ employee_submitted_at: Date | null }>(
      `SELECT employee_submitted_at FROM ${submissionsTable}
       WHERE employee_id = $1 AND cycle_year = $2`,
      [employeeId, cycleYear],
    );
    if (submitted?.employee_submitted_at) return false;
    if (
      !employeeWindowOpenForPolicy({
        kind: employeeWindowKind,
        doj: isoDoj(emp),
        cycleYear,
      })
    ) {
      return false;
    }
    return true;
  }

  async function assertCanView(user: AuthUser, employeeId: number): Promise<EmployeeContext> {
    const emp = await loadEmployeeContext(employeeId);
    if (!emp) {
      throw Object.assign(new Error("Employee not found"), { status: 404 });
    }
    if (userIsAdmin(user) || userCanEdit(user)) return emp;
    if (isLeadershipReviewer(user.email)) return emp;
    if (isExecutiveLeaveApprover(user)) return emp;
    const linkedId = await findEmployeeIdByUserEmail(user.email);
    if (linkedId === employeeId) return emp;
    const assignedIds = await getAssignedEmployeeIds(user.id);
    if (assignedIds.includes(employeeId)) return emp;
    throw Object.assign(new Error(`You do not have access to this ${resourceLabel}`), { status: 403 });
  }

  function canActAsManagementReviewer(user: AuthUser): boolean {
    return isLeadershipReviewer(user.email) || isExecutiveLeaveApprover(user);
  }

  function stripEmployeeSection(view: CycleSubmissionView): void {
    view.overallEmployeeRating = null;
    view.overallEmployeeComments = null;
    view.answers = view.answers.map((a) => ({
      ...a,
      employeeRating: null,
      employeeComments: null,
    }));
  }

  function stripManagerSection(view: CycleSubmissionView): void {
    view.overallManagerRating = null;
    view.overallManagerComments = null;
    view.answers = view.answers.map((a) => ({
      ...a,
      managerRating: null,
      managerComments: null,
    }));
  }

  function stripManagementSection(view: CycleSubmissionView): void {
    view.overallManagementRating = null;
    view.overallManagementComments = null;
    view.answers = view.answers.map((a) => ({
      ...a,
      managementRating: null,
      managementComments: null,
    }));
  }

  async function applyVisibilityRules(
    user: AuthUser,
    employeeId: number,
    view: CycleSubmissionView,
  ): Promise<CycleSubmissionView> {
    const linkedId = await findEmployeeIdByUserEmail(user.email);
    const isSelfEmployee =
      linkedId === employeeId &&
      !userIsAdmin(user) &&
      !userCanEdit(user) &&
      !isLeadershipReviewer(user.email);

    const isManagerViewer =
      !userIsAdmin(user) && !userCanEdit(user)
        ? await isManagerOfEmployee(user.id, employeeId)
        : false;

    const isStaffViewer = userIsAdmin(user) || userCanEdit(user);
    const isLeadership = isLeadershipReviewer(user.email);
    const isManagementReviewer = canActAsManagementReviewer(user);

    view.showManagerReview = !isSelfEmployee;
    view.showManagementReview = isStaffViewer || isLeadership || isManagementReviewer;

    const employeeSubmitted = view.employeeSubmittedAt != null;
    const managerSubmitted = view.managerSubmittedAt != null;
    const managementSubmitted = view.managementSubmittedAt != null;
    view.canEditManagementFields =
      isManagementReviewer && managerSubmitted && !managementSubmitted && !isSelfEmployee;

    if (isManagerViewer) {
      view.canEditManagerFields = await viewerCanEditManagerFields(user, employeeId, view.cycleYear);
    }

    if (isSelfEmployee) {
      view.overallManagerRating = null;
      view.overallManagementRating = null;
      view.overallManagerComments = null;
      view.overallManagementComments = null;
      view.managerSubmittedAt = null;
      view.canEditManagerFields = false;
      view.canEditManagementFields = false;
      view.answers = view.answers.map((a) => ({
        ...a,
        managerRating: null,
        managerComments: null,
        managementRating: null,
        managementComments: null,
      }));
    } else if (isManagerViewer && !isStaffViewer && !isLeadership) {
      view.overallManagementRating = null;
      view.overallManagementComments = null;
      view.answers = view.answers.map((a) => ({
        ...a,
        managementRating: null,
        managementComments: null,
      }));
      view.showManagementReview = false;
    }

    const canSeeEmployeeBody = isSelfEmployee || employeeSubmitted;
    if (!canSeeEmployeeBody) {
      stripEmployeeSection(view);
    }

    const canSeeManagerBody =
      (isManagerViewer &&
        !isSelfEmployee &&
        !isStaffViewer &&
        !isLeadership &&
        (view.canEditManagerFields || managerSubmitted)) ||
      ((isStaffViewer || isLeadership || isManagementReviewer) && managerSubmitted);

    if (!canSeeManagerBody) {
      stripManagerSection(view);
    }

    const canSeeManagementBody =
      (isStaffViewer || isLeadership || isManagementReviewer) &&
      (view.canEditManagementFields || managementSubmitted);

    if (!canSeeManagementBody) {
      stripManagementSection(view);
    }

    return view;
  }

  async function ensureSubmission(employeeId: number, cycleYear: number, teamSlug: string): Promise<number> {
    const existing = await queryOne<{ id: number }>(
      `SELECT id FROM ${submissionsTable}
       WHERE employee_id = $1 AND cycle_year = $2`,
      [employeeId, cycleYear],
    );
    if (existing) return existing.id;

    const inserted = await queryOne<{ id: number }>(
      `INSERT INTO ${submissionsTable} (employee_id, cycle_year, team_slug)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [employeeId, cycleYear, teamSlug],
    );
    if (!inserted) throw new Error(`Failed to create ${resourceLabel} submission`);
    return inserted.id;
  }

  async function seedAnswersFromTemplate(submissionId: number, criteria: AppraisalCriterion[]): Promise<void> {
    for (const c of criteria) {
      await query(
        `INSERT INTO ${answersTable} (submission_id, criterion_index)
         VALUES ($1, $2)
         ON CONFLICT (submission_id, criterion_index) DO NOTHING`,
        [submissionId, c.index],
      );
    }
  }

  async function loadAnswers(submissionId: number): Promise<CycleSubmissionView["answers"]> {
    const rows = await query<{
      criterion_index: number;
      employee_rating: number | null;
      employee_comments: string | null;
      manager_rating: number | null;
      manager_comments: string | null;
      management_rating: number | null;
      management_comments: string | null;
    }>(
      `SELECT criterion_index, employee_rating, employee_comments, manager_rating, manager_comments,
              management_rating, management_comments
       FROM ${answersTable}
       WHERE submission_id = $1
       ORDER BY criterion_index`,
      [submissionId],
    );
    return rows.map((r) => ({
      criterionIndex: r.criterion_index,
      employeeRating: r.employee_rating,
      employeeComments: r.employee_comments,
      managerRating: r.manager_rating,
      managerComments: r.manager_comments,
      managementRating: r.management_rating,
      managementComments: r.management_comments,
    }));
  }

  async function finalizeView(
    user: AuthUser,
    employeeId: number,
    view: CycleSubmissionView,
  ): Promise<CycleSubmissionView> {
    const visible = await applyVisibilityRules(user, employeeId, view);
    if (employeeWindowKind === "goal_sheet_january") {
      visible.employeeEditNote = goalSheetEmployeeEditNote({
        doj: visible.dateOfJoining,
        cycleYear: visible.cycleYear,
        employeeSubmitted: visible.employeeSubmittedAt != null,
      });
    }
    return visible;
  }

  async function buildSubmissionView(
    user: AuthUser,
    employeeId: number,
    requestedCycleYear: number,
  ): Promise<CycleSubmissionView> {
    const emp = await assertCanView(user, employeeId);
    const teamSlug = emp.team_slug;
    const template = getTemplate(teamSlug);
    const doj = isoDoj(emp);
    const activeCycleYear = resolveActiveCycleYear(doj);
    const cycleYear = coerceCycleYearForView(requestedCycleYear, activeCycleYear);
    const historyCycleYears = await listHistoryCycleYears(employeeId, activeCycleYear);
    const employeeWindowOpen = employeeWindowOpenForPolicy({
      kind: employeeWindowKind,
      doj,
      cycleYear,
    });
    const daysUntil = daysUntilEmployeeWindowForPolicy({
      kind: employeeWindowKind,
      doj,
      cycleYear,
    });

    if (!teamSlug || !template || template.criteria.length === 0) {
      const empty: CycleSubmissionView = {
        id: 0,
        cycleYear,
        employeeId: emp.id,
        employeeCode: emp.employee_code,
        employeeName: emp.name,
        teamSlug,
        teamName: emp.team_name,
        dateOfJoining: doj,
        canFill: employeeWindowOpen,
        daysUntilEditable: daysUntil,
        canEditEmployeeFields: false,
        canEditManagerFields: false,
        canEditManagementFields: false,
        showManagerReview: false,
        showManagementReview: false,
        managerSubmittedAt: null,
        employeeSubmittedAt: null,
        managementSubmittedAt: null,
        overallEmployeeRating: null,
        overallManagerRating: null,
        overallManagementRating: null,
        overallEmployeeComments: null,
        overallManagerComments: null,
        overallManagementComments: null,
        answers: [],
        template,
        employeeUpdatedAt: null,
        managerUpdatedAt: null,
        managementUpdatedAt: null,
        historyCycleYears,
        activeCycleYear,
        employeeWindowOpen,
      };
      return finalizeView(user, employeeId, empty);
    }

    const existingSub = await queryOne<{ id: number }>(
      `SELECT id FROM ${submissionsTable}
       WHERE employee_id = $1 AND cycle_year = $2`,
      [employeeId, cycleYear],
    );
    let submissionId = existingSub?.id ?? 0;
    if (!existingSub) {
      if (cycleYear === activeCycleYear) {
        submissionId = await ensureSubmission(employeeId, cycleYear, teamSlug);
        await seedAnswersFromTemplate(submissionId, template.criteria);
      }
    } else {
      submissionId = existingSub.id;
      await seedAnswersFromTemplate(submissionId, template.criteria);
    }

    const sub =
      submissionId > 0
        ? await queryOne<{
      id: number;
      overall_employee_rating: number | null;
      overall_manager_rating: number | null;
      overall_management_rating: number | null;
      overall_employee_comments: string | null;
      overall_manager_comments: string | null;
      overall_management_comments: string | null;
      employee_updated_at: Date | null;
      manager_updated_at: Date | null;
      management_updated_at: Date | null;
      manager_submitted_at: Date | null;
      employee_submitted_at: Date | null;
      management_submitted_at: Date | null;
    }>(
      `SELECT id, overall_employee_rating, overall_manager_rating, overall_management_rating,
              overall_employee_comments, overall_manager_comments, overall_management_comments,
              employee_updated_at, manager_updated_at, management_updated_at,
              manager_submitted_at, employee_submitted_at, management_submitted_at
       FROM ${submissionsTable} WHERE id = $1`,
      [submissionId],
    )
        : null;

    const emptyAnswers = template.criteria.map((c) => ({
      criterionIndex: c.index,
      employeeRating: null as number | null,
      employeeComments: null as string | null,
      managerRating: null as number | null,
      managerComments: null as string | null,
      managementRating: null as number | null,
      managementComments: null as string | null,
    }));

    if (!sub) {
      const canEditEmployee = await viewerCanEditEmployeeFields(user, employeeId, cycleYear);
      const emptyHistorical: CycleSubmissionView = {
        id: 0,
        cycleYear,
        employeeId: emp.id,
        employeeCode: emp.employee_code,
        employeeName: emp.name,
        teamSlug,
        teamName: emp.team_name,
        dateOfJoining: doj,
        canFill: employeeWindowOpen,
        daysUntilEditable: daysUntil,
        canEditEmployeeFields: canEditEmployee,
        canEditManagerFields: false,
        canEditManagementFields: false,
        showManagerReview: true,
        showManagementReview: false,
        managerSubmittedAt: null,
        employeeSubmittedAt: null,
        managementSubmittedAt: null,
        overallEmployeeRating: null,
        overallManagerRating: null,
        overallManagementRating: null,
        overallEmployeeComments: null,
        overallManagerComments: null,
        overallManagementComments: null,
        answers: emptyAnswers,
        template,
        employeeUpdatedAt: null,
        managerUpdatedAt: null,
        managementUpdatedAt: null,
        historyCycleYears,
        activeCycleYear,
        employeeWindowOpen,
      };
      return finalizeView(user, employeeId, emptyHistorical);
    }

    const canEditEmployee = await viewerCanEditEmployeeFields(user, employeeId, cycleYear);
    const canEditManager = await viewerCanEditManagerFields(user, employeeId, cycleYear);
    const employeeSubmitted = sub.employee_submitted_at != null;

    const view: CycleSubmissionView = {
      id: submissionId,
      cycleYear,
      employeeId: emp.id,
      employeeCode: emp.employee_code,
      employeeName: emp.name,
      teamSlug,
      teamName: emp.team_name,
      dateOfJoining: doj,
      canFill: employeeWindowOpen && !employeeSubmitted,
      daysUntilEditable: daysUntil,
      canEditEmployeeFields: canEditEmployee,
      canEditManagerFields: canEditManager,
      canEditManagementFields: false,
      showManagerReview: true,
      showManagementReview: false,
      managerSubmittedAt: sub.manager_submitted_at
        ? new Date(sub.manager_submitted_at).toISOString()
        : null,
      employeeSubmittedAt: sub.employee_submitted_at
        ? new Date(sub.employee_submitted_at).toISOString()
        : null,
      managementSubmittedAt: sub.management_submitted_at
        ? new Date(sub.management_submitted_at).toISOString()
        : null,
      overallEmployeeRating: sub.overall_employee_rating ?? null,
      overallManagerRating: sub.overall_manager_rating ?? null,
      overallManagementRating: sub.overall_management_rating ?? null,
      overallEmployeeComments: sub.overall_employee_comments ?? null,
      overallManagerComments: sub.overall_manager_comments ?? null,
      overallManagementComments: sub.overall_management_comments ?? null,
      answers: await loadAnswers(submissionId),
      template,
      employeeUpdatedAt: sub.employee_updated_at
        ? new Date(sub.employee_updated_at).toISOString()
        : null,
      managerUpdatedAt: sub.manager_updated_at ? new Date(sub.manager_updated_at).toISOString() : null,
      managementUpdatedAt: sub.management_updated_at
        ? new Date(sub.management_updated_at).toISOString()
        : null,
      historyCycleYears,
      activeCycleYear,
      employeeWindowOpen,
    };

    return finalizeView(user, employeeId, view);
  }

  async function resolveMyEmployeeId(user: AuthUser): Promise<number | null> {
    return findEmployeeIdByUserEmail(user.email);
  }

  async function listTeamSummaries(user: AuthUser, cycleYear: number) {
    const employeeIds = await getAssignedEmployeeIds(user.id);
    if (employeeIds.length === 0) {
      return [];
    }
    const summaries = [];
    for (const id of employeeIds) {
      const emp = await loadEmployeeContext(id);
      if (!emp) continue;
      const template = getTemplate(emp.team_slug);
      if (!template || template.criteria.length === 0) continue;
      const sub = await queryOne<{
        overall_employee_rating: number | null;
        overall_manager_rating: number | null;
        manager_submitted_at: Date | null;
        employee_submitted_at: Date | null;
        employee_updated_at: Date | null;
        manager_updated_at: Date | null;
      }>(
        `SELECT overall_employee_rating, overall_manager_rating, manager_submitted_at,
                employee_submitted_at, employee_updated_at, manager_updated_at
         FROM ${submissionsTable}
         WHERE employee_id = $1 AND cycle_year = $2`,
        [id, cycleYear],
      );
      const employeeSubmitted = sub?.employee_submitted_at != null;
      const managerSubmitted = sub?.manager_submitted_at != null;
      summaries.push({
        employeeId: emp.id,
        employeeCode: emp.employee_code,
        employeeName: emp.name,
        teamName: emp.team_name,
        canFill:
          employeeWindowOpenForPolicy({
            kind: employeeWindowKind,
            doj: isoDoj(emp),
            cycleYear,
          }) && !employeeSubmitted,
        employeeSubmittedAt: employeeSubmitted
          ? new Date(sub.employee_submitted_at!).toISOString()
          : null,
        overallEmployeeRating: employeeSubmitted ? sub?.overall_employee_rating ?? null : null,
        overallManagerRating: managerSubmitted ? sub?.overall_manager_rating ?? null : null,
        managerSubmittedAt: managerSubmitted
          ? new Date(sub.manager_submitted_at!).toISOString()
          : null,
        employeeUpdatedAt: !employeeSubmitted
          ? sub?.employee_updated_at
            ? new Date(sub.employee_updated_at).toISOString()
            : null
          : sub?.employee_updated_at
            ? new Date(sub.employee_updated_at).toISOString()
            : null,
        managerUpdatedAt:
          managerSubmitted && sub?.manager_updated_at
            ? new Date(sub.manager_updated_at).toISOString()
            : employeeSubmitted && sub?.manager_updated_at
              ? new Date(sub.manager_updated_at).toISOString()
              : null,
      });
    }
    return summaries;
  }

  async function listAdminSummaries(cycleYear: number) {
    const rows = await query<{
      submission_id: number;
      employee_id: number;
      employee_code: string;
      name: string;
      team_name: string | null;
      team_slug: string | null;
      date_of_joining: string | null;
      overall_employee_rating: number | null;
      overall_manager_rating: number | null;
      employee_submitted_at: Date | null;
      employee_updated_at: Date | null;
      manager_updated_at: Date | null;
      manager_submitted_at: Date | null;
    }>(
      `SELECT s.id AS submission_id, e.id AS employee_id, e.employee_code, e.name,
              t.name AS team_name, t.slug AS team_slug, e.date_of_joining,
              s.overall_employee_rating, s.overall_manager_rating,
              s.employee_submitted_at, s.employee_updated_at, s.manager_updated_at, s.manager_submitted_at
       FROM employees e
       LEFT JOIN teams t ON t.id = e.team_id
       LEFT JOIN ${submissionsTable} s
         ON s.employee_id = e.id AND s.cycle_year = $1
       WHERE e.status = 'active'
       ORDER BY t.sort_order NULLS LAST, e.employee_code`,
      [cycleYear],
    );

    return rows
      .filter((row) => {
        const template = getTemplate(row.team_slug);
        return template != null && template.criteria.length > 0;
      })
      .map((row) => {
        const doj = row.date_of_joining ? String(row.date_of_joining).slice(0, 10) : null;
        const employeeSubmitted = row.employee_submitted_at != null;
        const managerSubmitted = row.manager_submitted_at != null;
        return {
          submissionId: row.submission_id ?? 0,
          employeeId: row.employee_id,
          employeeCode: row.employee_code,
          employeeName: row.name,
          teamName: row.team_name,
          teamSlug: row.team_slug,
          dateOfJoining: doj,
          canFill:
            employeeWindowOpenForPolicy({
              kind: employeeWindowKind,
              doj,
              cycleYear,
            }) && !employeeSubmitted,
          employeeSubmittedAt: employeeSubmitted
            ? new Date(row.employee_submitted_at!).toISOString()
            : null,
          overallEmployeeRating: employeeSubmitted ? row.overall_employee_rating : null,
          overallManagerRating: managerSubmitted ? row.overall_manager_rating : null,
          managerSubmittedAt: managerSubmitted
            ? new Date(row.manager_submitted_at!).toISOString()
            : null,
          employeeUpdatedAt:
            !employeeSubmitted && row.employee_updated_at
              ? new Date(row.employee_updated_at).toISOString()
              : employeeSubmitted && row.employee_updated_at
                ? new Date(row.employee_updated_at).toISOString()
                : null,
          managerUpdatedAt:
            managerSubmitted && row.manager_updated_at
              ? new Date(row.manager_updated_at).toISOString()
              : null,
        };
      });
  }

  async function listLeadershipSummaries(user: AuthUser, cycleYear: number) {
    if (!canActAsManagementReviewer(user)) {
      return [];
    }

    const rows = await listAdminSummaries(cycleYear);
    return rows
      .filter((row) => row.managerSubmittedAt != null)
      .map((row) => ({
        employeeId: row.employeeId,
        employeeCode: row.employeeCode,
        employeeName: row.employeeName,
        teamName: row.teamName,
        employeeSubmittedAt: row.employeeSubmittedAt,
        overallEmployeeRating: row.overallEmployeeRating,
        overallManagerRating: row.overallManagerRating,
        managerSubmittedAt: row.managerSubmittedAt,
      }));
  }

  async function saveSubmission(
    user: AuthUser,
    employeeId: number,
    cycleYear: number,
    payload: {
      role: "employee" | "manager" | "management";
      submit?: boolean;
      overallRating?: number | null;
      overallComments?: string | null;
      answers?: Array<{
        criterionIndex: number;
        rating?: number | null;
        comments?: string | null;
      }>;
    },
  ): Promise<CycleSubmissionView> {
    const emp = await assertCanView(user, employeeId);
    const template = getTemplate(emp.team_slug);
    if (!template || template.criteria.length === 0) {
      throw Object.assign(new Error(`${resourceTitle} template is not available for this team yet`), {
        status: 400,
      });
    }

    const doj = isoDoj(emp);
    const activeCycleYear = resolveActiveCycleYear(doj);
    const effectiveCycleYear = coerceCycleYearForView(cycleYear, activeCycleYear);

    if (payload.role === "employee") {
      if (!(await viewerCanEditEmployeeFields(user, employeeId, effectiveCycleYear))) {
        const linkedId = await findEmployeeIdByUserEmail(user.email);
        const submitted = await queryOne<{ employee_submitted_at: Date | null }>(
          `SELECT employee_submitted_at FROM ${submissionsTable}
           WHERE employee_id = $1 AND cycle_year = $2`,
          [employeeId, effectiveCycleYear],
        );
        let msg = `This ${resourceLabel} is read-only for the selected cycle year.`;
        if (linkedId !== employeeId) {
          msg = `You can only edit your own ${resourceLabel} when your login email matches your employee record.`;
        } else if (submitted?.employee_submitted_at) {
          msg = `Your ${resourceLabel} is already submitted for this cycle.`;
        } else if (
          employeeWindowKind === "goal_sheet_january" &&
          isoDoj(emp) &&
          goalSheetOnProbation(isoDoj(emp)!)
        ) {
          msg = "Goal sheet editing opens after you complete probation (3 months from joining).";
        } else if (
          !employeeWindowOpenForPolicy({
            kind: employeeWindowKind,
            doj: isoDoj(emp),
            cycleYear: effectiveCycleYear,
          })
        ) {
          msg =
            employeeWindowKind === "goal_sheet_january"
              ? "Goal sheet is not open for editing for this cycle (probation, January window, or post-probation deadline)."
              : "Performance appraisal editing opens one month before your date-of-joining anniversary.";
        }
        throw Object.assign(new Error(msg), { status: 403 });
      }
    } else if (payload.role === "manager") {
      if (!(await viewerCanEditManagerFields(user, employeeId, effectiveCycleYear))) {
        const gate = await queryOne<{ employee_submitted_at: Date | null }>(
          `SELECT employee_submitted_at FROM ${submissionsTable}
           WHERE employee_id = $1 AND cycle_year = $2`,
          [employeeId, effectiveCycleYear],
        );
        throw Object.assign(
          new Error(
            gate?.employee_submitted_at
              ? "You cannot edit manager review for this employee"
              : "Manager review opens after the employee submits their self-assessment",
          ),
          { status: 403 },
        );
      }
    } else if (payload.role === "management") {
      if (!canActAsManagementReviewer(user)) {
        throw Object.assign(new Error("Not authorized for management review"), { status: 403 });
      }
    }

    const submissionId = await ensureSubmission(employeeId, effectiveCycleYear, emp.team_slug!);
    await seedAnswersFromTemplate(submissionId, template.criteria);

    const subRow = await queryOne<{
      manager_submitted_at: Date | null;
      employee_submitted_at: Date | null;
      management_submitted_at: Date | null;
    }>(
      `SELECT manager_submitted_at, employee_submitted_at, management_submitted_at
       FROM ${submissionsTable} WHERE id = $1`,
      [submissionId],
    );

    if (payload.role === "employee" && subRow?.employee_submitted_at) {
      throw Object.assign(new Error(`Your ${resourceLabel} is already submitted`), { status: 403 });
    }
    if (payload.role === "manager" && subRow?.manager_submitted_at) {
      throw Object.assign(new Error("Manager review is already submitted for this cycle"), { status: 403 });
    }
    if (payload.role === "management" && subRow?.management_submitted_at) {
      throw Object.assign(new Error("Management review is already submitted"), { status: 403 });
    }

    if (payload.role === "management" && !subRow?.manager_submitted_at) {
      throw Object.assign(
        new Error("Management review opens after the manager submits their review"),
        { status: 403 },
      );
    }

    const overall =
      payload.role === "employee" ||
      payload.role === "manager" ||
      payload.role === "management"
        ? validateRating(payload.overallRating)
        : null;
    const overallComments =
      payload.overallComments === undefined || payload.overallComments === null
        ? null
        : String(payload.overallComments).trim() || null;
    const answers = payload.answers ?? [];

    if (payload.submit) {
      assertCycleFormSubmitComplete(
        payload.role,
        template.criteria,
        answers,
        overall,
        payload.overallComments,
      );
    }

    await withTransaction(async (client) => {
      for (const answer of answers) {
        const rating =
          payload.role === "employee" ||
          payload.role === "manager" ||
          payload.role === "management"
            ? validateRating(answer.rating)
            : null;
        const comments =
          answer.comments === undefined || answer.comments === null
            ? null
            : String(answer.comments).trim() || null;

        if (payload.role === "employee") {
          await client.query(
            `UPDATE ${answersTable}
             SET employee_rating = $1, employee_comments = $2
             WHERE submission_id = $3 AND criterion_index = $4`,
            [rating, comments, submissionId, answer.criterionIndex],
          );
        } else if (payload.role === "manager") {
          await client.query(
            `UPDATE ${answersTable}
             SET manager_rating = $1, manager_comments = $2
             WHERE submission_id = $3 AND criterion_index = $4`,
            [rating, comments, submissionId, answer.criterionIndex],
          );
        } else if (payload.role === "management") {
          await client.query(
            `UPDATE ${answersTable}
             SET management_rating = $1, management_comments = $2
             WHERE submission_id = $3 AND criterion_index = $4`,
            [rating, comments, submissionId, answer.criterionIndex],
          );
        }
      }

      if (payload.role === "employee") {
        await client.query(
          `UPDATE ${submissionsTable}
           SET overall_employee_rating = $1, overall_employee_comments = $2,
               employee_updated_at = NOW(), updated_at = NOW()
           WHERE id = $3`,
          [overall, overallComments, submissionId],
        );
        if (payload.submit) {
          await client.query(
            `UPDATE ${submissionsTable}
             SET employee_submitted_at = COALESCE(employee_submitted_at, NOW()), updated_at = NOW()
             WHERE id = $1`,
            [submissionId],
          );
        }
      } else if (payload.role === "manager") {
        await client.query(
          `UPDATE ${submissionsTable}
           SET overall_manager_rating = $1, overall_manager_comments = $2,
               manager_user_id = $3, manager_updated_at = NOW(), updated_at = NOW()
           WHERE id = $4`,
          [overall, overallComments, user.id, submissionId],
        );
        if (payload.submit) {
          await client.query(
            `UPDATE ${submissionsTable}
             SET manager_submitted_at = COALESCE(manager_submitted_at, NOW()), updated_at = NOW()
             WHERE id = $1`,
            [submissionId],
          );
        }
      } else if (payload.role === "management") {
        await client.query(
          `UPDATE ${submissionsTable}
           SET overall_management_rating = $1, overall_management_comments = $2,
               management_updated_at = NOW(), updated_at = NOW()
           WHERE id = $3`,
          [overall, overallComments, submissionId],
        );
        if (payload.submit) {
          await client.query(
            `UPDATE ${submissionsTable}
             SET management_submitted_at = COALESCE(management_submitted_at, NOW()), updated_at = NOW()
             WHERE id = $1`,
            [submissionId],
          );
        }
      }
    });

    return buildSubmissionView(user, employeeId, effectiveCycleYear);
  }

  async function resolveDefaultCycleYear(employeeId: number): Promise<number> {
    const emp = await loadEmployeeContext(employeeId);
    return defaultCycleYearForPolicy({ kind: employeeWindowKind, doj: emp ? isoDoj(emp) : null });
  }

  return {
    buildSubmissionView,
    resolveMyEmployeeId,
    resolveDefaultCycleYear,
    listTeamSummaries,
    listLeadershipSummaries,
    listAdminSummaries,
    saveSubmission,
    getRatingScale,
  };
}
