import type express from "express";
import type { AuthedRequest } from "../auth/middleware.js";
import { canManageCompanyHolidays } from "./access.js";

export function requireHolidayManager(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const authed = req as AuthedRequest;
  if (!canManageCompanyHolidays(authed.authUser)) {
    res.status(403).json({
      message: "Only HR can update the holiday list.",
    });
    return;
  }
  next();
}
