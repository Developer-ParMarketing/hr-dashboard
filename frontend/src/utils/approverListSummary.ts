export function formatInListPendingApproved(rows: Array<{ status: string }>): string {
  let pending = 0
  let approved = 0
  for (const row of rows) {
    if (row.status === 'pending') pending += 1
    else if (row.status === 'approved') approved += 1
  }
  return `${rows.length} in list · ${pending} pending · ${approved} approved`
}
