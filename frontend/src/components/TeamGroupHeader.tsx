import type { TeamGroupingMeta } from '../utils/teamGroups'

type Props = {
  group: TeamGroupingMeta
  memberCount: number
  colSpan: number
}

export function TeamGroupHeader({ group, memberCount, colSpan }: Props) {
  return (
    <tr className="team-group-header">
      <td
        colSpan={colSpan}
        className="border border-[var(--color-warm-muted)] bg-[color-mix(in_srgb,var(--color-brand-muted)_55%,#fff)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-ink)]"
      >
        <span>{group.teamName}</span>
        {group.teamManagerName ? (
          <span className="font-normal normal-case tracking-normal text-[var(--color-warm-text)]">
            {' '}
            · Manager: {group.teamManagerName}
          </span>
        ) : null}
        <span className="ml-2 font-normal normal-case tracking-normal text-[var(--color-warm-text)]">
          ({memberCount} {memberCount === 1 ? 'person' : 'people'})
        </span>
      </td>
    </tr>
  )
}
