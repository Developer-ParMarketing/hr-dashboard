import type pg from "pg";
import { staticSalaryFields, type SalaryBaseFields } from "./salaryBase.js";

/** Push Admin → People base salary fields to every saved payroll row for this employee. */
export async function syncEmployeeSalaryFieldsToAllSheetRows(
  client: pg.PoolClient,
  input: {
    company: string;
    employeeId: number;
    fields: SalaryBaseFields;
    actor: string;
  },
): Promise<number> {
  const company = input.company.trim() || "PM";
  const f = staticSalaryFields(input.fields);
  const result = await client.query(
    `UPDATE salary_sheet_rows SET
       in_hand = $3,
       pf_employee = $4,
       esi_employee = $5,
       pt = $6,
       gratuity = $7,
       employer_pf = $8,
       employer_pf_arr = $9,
       employer_esi = $10,
       updated_by = $11,
       updated_at = NOW()
     WHERE company = $1 AND employee_id = $2`,
    [
      company,
      input.employeeId,
      f.inHand,
      f.pfEmployee,
      f.esiEmployee,
      f.pt,
      f.gratuity,
      f.employerPf,
      f.employerPfArr,
      f.employerEsi,
      input.actor,
    ],
  );
  return result.rowCount ?? 0;
}
