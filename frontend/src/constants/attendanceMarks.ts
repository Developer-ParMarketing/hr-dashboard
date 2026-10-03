/** Attendance mark options for inline HR edits (daily / grid rows). */
export const ATTENDANCE_MARKS = [
  { value: 'P', label: 'Present' },
  { value: 'AB', label: 'Absent' },
  { value: 'SL', label: 'Leave (SL)' },
  { value: 'PL', label: 'Leave (PL)' },
  { value: 'CL', label: 'Leave (CL)' },
  { value: 'WFH', label: 'WFH' },
  { value: 'WO', label: 'Weekly off' },
] as const

export const INLINE_FIELD_CLASS =
  'w-full min-w-0 rounded-md border border-[var(--color-warm-muted)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-ink)] outline-none focus:border-[var(--color-brand)]'
