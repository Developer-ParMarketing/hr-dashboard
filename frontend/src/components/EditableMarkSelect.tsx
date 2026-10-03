import { ATTENDANCE_MARKS, INLINE_FIELD_CLASS } from '../constants/attendanceMarks'

type Props = {
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  className?: string
}

export function EditableMarkSelect({ value, onChange, ariaLabel, className }: Props) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className ?? INLINE_FIELD_CLASS}
      aria-label={ariaLabel}
    >
      <option value="">-</option>
      {ATTENDANCE_MARKS.map((m) => (
        <option key={m.value} value={m.value}>
          {m.label}
        </option>
      ))}
    </select>
  )
}
