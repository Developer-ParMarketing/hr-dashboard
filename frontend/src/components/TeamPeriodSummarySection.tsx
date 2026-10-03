import type { TeamPeriodSummary } from '../utils/teamPeriodSummary'

type Props = {
  kicker?: string
  summary: TeamPeriodSummary
}

export function TeamPeriodSummarySection({ kicker = 'Team rollup', summary }: Props) {
  if (summary.cards.length === 0) return null

  return (
    <section className="card border p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-brand)]">
            {kicker}
          </p>
          <h2 className="mt-1 text-base font-semibold text-[var(--color-ink)] sm:text-lg">{summary.title}</h2>
          <p className="mt-1 text-sm text-[var(--color-warm-text)]">{summary.description}</p>
        </div>
        {summary.footer ? (
          <p className="text-sm font-medium tabular-nums text-[var(--color-ink)] sm:text-right">{summary.footer}</p>
        ) : null}
      </div>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {summary.cards.map((row) => (
          <li
            key={row.group.teamId ?? `unassigned-${row.group.teamName}`}
            className="rounded-lg border border-[color-mix(in_srgb,var(--color-warm-muted)_80%,transparent)] bg-[color-mix(in_srgb,var(--color-brand-muted)_35%,#fff)] px-3 py-2.5"
          >
            <p className="text-sm font-semibold text-[var(--color-ink)]">{row.group.teamName}</p>
            {row.group.teamManagerName ? (
              <p className="mt-0.5 text-xs text-[var(--color-warm-text)]">
                Manager: {row.group.teamManagerName}
              </p>
            ) : null}
            <p className="mt-1.5 text-sm font-semibold tabular-nums text-[var(--color-ink)]">{row.headline}</p>
            {row.details.map((line) => (
              <p key={line} className="mt-0.5 text-xs text-[var(--color-warm-text)]">
                {line}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </section>
  )
}
