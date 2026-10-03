type Props = {
  tone: 'info' | 'warning'
  message: string
  className?: string
}

export function DashboardBaselineNote({ tone, message, className = '' }: Props) {
  const styles =
    tone === 'warning'
      ? 'border-amber-200/80 bg-amber-50/90 text-amber-950'
      : 'border-[color-mix(in_srgb,var(--color-brand)_18%,transparent)] bg-[color-mix(in_srgb,var(--color-brand-soft)_70%,#fff)] text-[var(--color-ink)]'

  return (
    <p
      role="status"
      className={[
        'rounded-lg border px-3 py-2 text-sm leading-snug',
        styles,
        className,
      ].join(' ')}
    >
      {message}
    </p>
  )
}
