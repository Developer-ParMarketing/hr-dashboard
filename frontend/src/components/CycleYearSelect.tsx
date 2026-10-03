type Props = {
  label?: string
  cycleYear: number
  activeCycleYear: number
  historyCycleYears: number[]
  onChange: (year: number) => void
}

/** Pick current cycle or a past year with saved submissions (read-only in the form). */
export function CycleYearSelect({
  label = 'Cycle year',
  cycleYear,
  activeCycleYear,
  historyCycleYears,
  onChange,
}: Props) {
  const years = Array.from(
    new Set([activeCycleYear, ...historyCycleYears.filter((y) => y !== activeCycleYear)]),
  ).sort((a, b) => b - a)
  if (years.length <= 1 && cycleYear === activeCycleYear) {
    return (
      <p className="text-sm text-[var(--color-warm-text)]">
        {label}: <span className="font-medium text-[var(--color-warm-heading)]">{cycleYear}</span>
        {cycleYear === activeCycleYear ? ' (current cycle)' : ' (history)'}
      </p>
    )
  }

  return (
    <label className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-warm-text)]">
      <span>{label}</span>
      <select
        className="input-select min-w-[7rem]"
        value={cycleYear}
        onChange={(e) => onChange(Number.parseInt(e.target.value, 10))}
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
            {y === activeCycleYear ? ' (current)' : ' (history)'}
          </option>
        ))}
      </select>
    </label>
  )
}
