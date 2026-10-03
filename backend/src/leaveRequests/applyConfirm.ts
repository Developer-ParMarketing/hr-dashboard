export class LeaveApplyConfirmRequiredError extends Error {
  status = 409;
  warnings: string[];
  constructor(warnings: string[]) {
    super("Confirmation required");
    this.name = "LeaveApplyConfirmRequiredError";
    this.warnings = warnings;
  }
}
