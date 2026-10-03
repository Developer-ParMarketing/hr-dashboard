import type pg from "pg";
import { resolvePayrollIncrement } from "./incrementPayroll.js";

/** Payroll months an increment cycle applies after it is set (including the start month). */
export const INCREMENT_CYCLE_MONTHS = 12;

export type IncrementCycle = {
  incrementFromYear: number;
  incrementFromMonth: number;
  incrementPercent: number | null;
  /** Fixed rupee increment when incrementPercent is null. */
  incrementRupees: number;
};

export type IncrementCycleRowFields = {
  inHand: number;
  incrementPercent?: number | null;
  increment: number;
};

export function payrollMonthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

export function isPayrollMonthInIncrementCycle(
  fromYear: number,
  fromMonth: number,
  targetYear: number,
  targetMonth: number,
): boolean {
  const start = payrollMonthIndex(fromYear, fromMonth);
  const target = payrollMonthIndex(targetYear, targetMonth);
  return target >= start && target - start < INCREMENT_CYCLE_MONTHS;
}

export function incrementCycleEndIndex(fromYear: number, fromMonth: number): number {
  return payrollMonthIndex(fromYear, fromMonth) + INCREMENT_CYCLE_MONTHS - 1;
}

export function cycleIsActive(cycle: IncrementCycle | undefined | null): boolean {
  if (!cycle) return false;
  if (cycle.incrementFromYear < 2000 || cycle.incrementFromMonth < 1 || cycle.incrementFromMonth > 12) {
    return false;
  }
  if (cycle.incrementPercent != null && cycle.incrementPercent > 0) return true;
  return cycle.incrementRupees > 0;
}

export function applyIncrementCycleToRow<T extends IncrementCycleRowFields>(
  row: T,
  cycle: IncrementCycle,
  targetYear: number,
  targetMonth: number,
): T {
  if (!isPayrollMonthInIncrementCycle(cycle.incrementFromYear, cycle.incrementFromMonth, targetYear, targetMonth)) {
    return { ...row, incrementPercent: null, increment: 0 };
  }
  if (cycle.incrementPercent != null && cycle.incrementPercent > 0) {
    const resolved = resolvePayrollIncrement({
      inHand: row.inHand,
      incrementPercent: cycle.incrementPercent,
      increment: 0,
    });
    return { ...row, incrementPercent: resolved.incrementPercent, increment: resolved.increment };
  }
  const resolved = resolvePayrollIncrement({
    inHand: row.inHand,
    incrementPercent: null,
    increment: cycle.incrementRupees,
  });
  return { ...row, incrementPercent: resolved.incrementPercent, increment: resolved.increment };
}

export async function persistIncrementCycle(
  client: pg.PoolClient,
  input: {
    company: string;
    employeeId: number;
    fromYear: number;
    fromMonth: number;
    incrementPercent: number | null;
    increment: number;
    actor: string;
  },
): Promise<void> {
  const pct =
    input.incrementPercent != null && Number.isFinite(input.incrementPercent) && input.incrementPercent > 0
      ? input.incrementPercent
      : null;
  const rupees = pct != null ? 0 : Number(input.increment) || 0;

  await client.query(
    `INSERT INTO salary_base_profiles (
       company, employee_id, increment_from_year, increment_from_month,
       increment_percent, increment_rupees, updated_by, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (company, employee_id) DO UPDATE SET
       increment_from_year = EXCLUDED.increment_from_year,
       increment_from_month = EXCLUDED.increment_from_month,
       increment_percent = EXCLUDED.increment_percent,
       increment_rupees = EXCLUDED.increment_rupees,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [input.company, input.employeeId, input.fromYear, input.fromMonth, pct, rupees, input.actor],
  );
}

/** Push increment to every saved sheet row in the 12-month cycle window. */
export async function propagateIncrementToCycleSheetRows(
  client: pg.PoolClient,
  input: {
    company: string;
    employeeId: number;
    fromYear: number;
    fromMonth: number;
    incrementPercent: number | null;
    increment: number;
    actor: string;
  },
): Promise<void> {
  const startIdx = payrollMonthIndex(input.fromYear, input.fromMonth);
  const endIdx = incrementCycleEndIndex(input.fromYear, input.fromMonth);
  const pct =
    input.incrementPercent != null && Number.isFinite(input.incrementPercent) && input.incrementPercent > 0
      ? input.incrementPercent
      : null;
  const rupees = pct != null ? 0 : Number(input.increment) || 0;

  await client.query(
    `UPDATE salary_sheet_rows AS s SET
       increment_percent = $5,
       increment = $6,
       updated_by = $7,
       updated_at = NOW()
     WHERE s.company = $1 AND s.employee_id = $2
       AND (s.year * 12 + (s.month - 1)) >= $3
       AND (s.year * 12 + (s.month - 1)) <= $4`,
    [input.company, input.employeeId, startIdx, endIdx, pct, rupees, input.actor],
  );

  // When using %, recompute rupee increment from each row's in_hand.
  if (pct != null) {
    const rows = await client.query<{ id: number; in_hand: number }>(
      `SELECT id, in_hand FROM salary_sheet_rows AS s
       WHERE s.company = $1 AND s.employee_id = $2
         AND (s.year * 12 + (s.month - 1)) >= $3
         AND (s.year * 12 + (s.month - 1)) <= $4`,
      [input.company, input.employeeId, startIdx, endIdx],
    );
    for (const r of rows.rows) {
      const resolved = resolvePayrollIncrement({
        inHand: Number(r.in_hand) || 0,
        incrementPercent: pct,
        increment: 0,
      });
      await client.query(`UPDATE salary_sheet_rows SET increment = $1 WHERE id = $2`, [
        resolved.increment,
        r.id,
      ]);
    }
  }
}
