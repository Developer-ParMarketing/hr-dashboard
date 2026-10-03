import { Link } from 'react-router-dom'

type Props = {
  variant: 'employee' | 'admin'
  loginEmail?: string | null
  unlinkedCount?: number
  className?: string
}

export function AccountLinkBanner({ variant, loginEmail, unlinkedCount = 0, className = '' }: Props) {
  if (variant === 'admin' && unlinkedCount <= 0) return null
  if (variant === 'employee' && !loginEmail) return null

  if (variant === 'admin') {
    return (
      <div
        className={`account-link-banner account-link-banner-admin ${className}`}
        role="status"
      >
        <span className="account-link-banner-icon" aria-hidden>!</span>
        <div className="account-link-banner-main min-w-0">
          <p className="account-link-banner-title">
            {unlinkedCount} {unlinkedCount === 1 ? 'person' : 'people'}: work email doesn&apos;t match login
          </p>
          <p className="account-link-banner-hint">Match emails in People so self-service works.</p>
        </div>
        <Link to="/admin?section=people&filter=unlinked-email" className="btn-secondary account-link-banner-cta shrink-0 text-xs">
          Fix in People
        </Link>
      </div>
    )
  }

  return (
    <div className={`account-link-banner account-link-banner-employee ${className}`} role="status">
      <span className="account-link-banner-icon" aria-hidden>!</span>
      <div className="account-link-banner-main min-w-0">
        <p className="account-link-banner-title">Account not linked to HR</p>
        <p className="account-link-banner-hint">
          Sign in with the same email HR has on your employee record ({loginEmail}).
        </p>
      </div>
      <Link to="/settings" className="btn-secondary account-link-banner-cta shrink-0 text-xs">
        Settings
      </Link>
    </div>
  )
}
