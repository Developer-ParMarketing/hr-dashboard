import { Link } from 'react-router-dom'

type Props = {
  /** Short label for current screen (shown after back). */
  title: string
  backTo?: string
  onBack?: () => void
  backLabel?: string
  className?: string
}

export function PageWayfinding({
  title,
  backTo,
  onBack,
  backLabel = 'Back',
  className = '',
}: Props) {
  const backClass =
    'page-wayfinding-back shrink-0 font-medium text-[var(--color-brand)] hover:underline'

  return (
    <nav
      className={`page-wayfinding flex min-w-0 flex-wrap items-center gap-2 text-sm ${className}`}
      aria-label="Page location"
    >
      {backTo ? (
        <Link to={backTo} className={backClass}>
          ← {backLabel}
        </Link>
      ) : onBack ? (
        <button type="button" className={backClass} onClick={onBack}>
          ← {backLabel}
        </button>
      ) : null}
      <span className="min-w-0 truncate font-medium text-[var(--color-ink)]" title={title}>
        {title}
      </span>
    </nav>
  )
}
