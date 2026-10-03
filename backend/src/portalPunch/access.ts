import type { AuthUser } from "../auth/users.js";
import {
  canSubmitEmployeeRequests,
  canViewAllRequests,
  requestCapabilities,
  type RequestCapabilities,
} from "../employeeRequests/workflow.js";

export function canViewAllPortalPunches(user: AuthUser): boolean {
  return canViewAllRequests(user);
}

export function portalPunchCapabilities(user: AuthUser): RequestCapabilities & { canPunch: boolean } {
  const cap = requestCapabilities(user);
  const canPunch = canSubmitEmployeeRequests(user);
  return {
    ...cap,
    canSubmit: canPunch,
    canPunch,
  };
}
