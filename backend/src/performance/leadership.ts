const LEADERSHIP_JAY_EMAIL = "jay.parmar@parmarketing.agency";
const LEADERSHIP_MANSI_EMAIL = "mansi.prasad@parmarketing.agency";

export function normalizeReviewerEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isLeadershipJay(email: string): boolean {
  return normalizeReviewerEmail(email) === LEADERSHIP_JAY_EMAIL;
}

export function isLeadershipMansi(email: string): boolean {
  return normalizeReviewerEmail(email) === LEADERSHIP_MANSI_EMAIL;
}

export function isLeadershipReviewer(email: string): boolean {
  return isLeadershipJay(email) || isLeadershipMansi(email);
}

export function leadershipCcEmails(): string[] {
  return [LEADERSHIP_JAY_EMAIL, LEADERSHIP_MANSI_EMAIL];
}

// No late/weekly/holiday/offboarding blast to Jay or Mansi. Offer letters still CC them.
export function isExemptFromAttendanceAlertEmails(email: string | null | undefined): boolean {
  if (!email?.trim()) return false;
  return isLeadershipReviewer(email);
}
