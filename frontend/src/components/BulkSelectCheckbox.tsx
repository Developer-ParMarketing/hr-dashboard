import { useEffect, useRef } from 'react'

type Props = {
  checked: boolean
  indeterminate?: boolean
  disabled?: boolean
  onChange: () => void
  ariaLabel: string
  className?: string
}

export function BulkSelectCheckbox({
  checked,
  indeterminate = false,
  disabled = false,
  onChange,
  ariaLabel,
  className,
}: Props) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      aria-label={ariaLabel}
      className={
        className ??
        'h-4 w-4 rounded border-[var(--color-warm-muted)] text-[var(--color-brand)] focus:ring-[var(--color-brand)] disabled:opacity-40'
      }
    />
  )
}
