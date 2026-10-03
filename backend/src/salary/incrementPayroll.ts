/**
 * Annual / monthly increment amounts (matches HR increment register):
 * Increment amount = Salary before × (% increase ÷ 100), rounded to 2 decimals.
 * Salary after = Salary before + increment amount.
 *
 * On the monthly payroll sheet, "salary before" is In Hand; the rupee increment
 * is added to net pay via pmSalaryCalculator.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function incrementAmountFromPercent(salaryBefore: number, percentIncrease: number): number {
  if (!Number.isFinite(salaryBefore) || salaryBefore <= 0) return 0;
  if (!Number.isFinite(percentIncrease) || percentIncrease <= 0) return 0;
  return round2(salaryBefore * (percentIncrease / 100));
}

export function salaryAfterIncrement(salaryBefore: number, percentIncrease: number): number {
  return round2(salaryBefore + incrementAmountFromPercent(salaryBefore, percentIncrease));
}

export function normalizeIncrementPercent(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
  if (!Number.isFinite(n) || n <= 0) return null;
  return round2(n);
}

export type PayrollIncrementFields = {
  inHand: number;
  incrementPercent?: number | null;
  increment?: number;
};

/** When increment % is set, derive rupee increment from In Hand; otherwise keep manual increment. */
export function resolvePayrollIncrement(row: PayrollIncrementFields): {
  incrementPercent: number | null;
  increment: number;
} {
  const pct = normalizeIncrementPercent(row.incrementPercent);
  if (pct != null) {
    return {
      incrementPercent: pct,
      increment: incrementAmountFromPercent(row.inHand, pct),
    };
  }
  const manual = Number(row.increment);
  return {
    incrementPercent: null,
    increment: Number.isFinite(manual) ? round2(manual) : 0,
  };
}
