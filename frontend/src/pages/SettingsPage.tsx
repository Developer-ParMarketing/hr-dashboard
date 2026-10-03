import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../auth/AuthContext'
import { changePasswordRequest, fetchMe, type LinkedEmployeeProfile } from '../api/auth'
import { formatDojDdMmYyyy } from '../utils/dojFormat'
import { isAdminUser, roleLabel } from '../auth/permissions'
import { AppShell } from '../components/AppShell'
import { PasswordInput } from '../components/PasswordInput'
import { DEFAULT_UPLOAD_COMPANY } from '../constants/companies'
import { confirmAction } from '../utils/confirmAction'
import { toastSuccess } from '../utils/toastBridge'

type SettingsSection = 'account' | 'profile' | 'workspace' | 'security'

const SECTIONS: { id: SettingsSection; label: string; hint: string }[] = [
  { id: 'account', label: 'Account', hint: 'Signed-in identity' },
  { id: 'profile', label: 'Employee profile', hint: 'Payroll record' },
  { id: 'workspace', label: 'Workspace', hint: 'Defaults & links' },
  { id: 'security', label: 'Security', hint: 'Password' },
]

function readAxiosMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const msg =
      typeof err.response?.data === 'string'
        ? err.response.data
        : (err.response?.data as { message?: string } | undefined)?.message
    return msg || fallback
  }
  return err instanceof Error ? err.message : fallback
}

function SettingsBlock({
  id,
  title,
  description,
  children,
}: {
  id: SettingsSection
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section id={`settings-${id}`} className="settings-block card border" aria-labelledby={`settings-${id}-title`}>
      <header className="settings-block-head">
        <h2 id={`settings-${id}-title`} className="settings-block-title">{title}</h2>
        <p className="settings-block-desc">{description}</p>
      </header>
      <div className="settings-block-body">{children}</div>
    </section>
  )
}

function SettingsField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="settings-field">
      <p className="settings-field-label">{label}</p>
      <p className="settings-field-value">{children}</p>
    </div>
  )
}

function SettingsLinkRow({ to, title, description }: { to: string; title: string; description: string }) {
  return (
    <Link to={to} className="settings-link-row">
      <span className="min-w-0 flex-1">
        <span className="settings-link-row-title">{title}</span>
        <span className="settings-link-row-desc">{description}</span>
      </span>
      <span className="settings-link-row-chevron" aria-hidden>→</span>
    </Link>
  )
}

export function SettingsPage() {
  const { user, logout, refreshUser } = useAuth()
  const navigate = useNavigate()
  const [activeSection, setActiveSection] = useState<SettingsSection>('account')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSubmitting, setPasswordSubmitting] = useState(false)
  const [employeeProfile, setEmployeeProfile] = useState<LinkedEmployeeProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const streamRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void fetchMe()
      .then((me) => setEmployeeProfile(me?.employeeProfile ?? null))
      .finally(() => setProfileLoading(false))
  }, [])

  useEffect(() => {
    const root = streamRef.current
    if (!root) return

    const ids = SECTIONS.map((s) => `settings-${s.id}`)
    const elements = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[]
    if (elements.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (!visible?.target.id) return
        const section = visible.target.id.replace('settings-', '') as SettingsSection
        if (SECTIONS.some((s) => s.id === section)) setActiveSection(section)
      },
      { root: null, rootMargin: '-20% 0px -55% 0px', threshold: [0, 0.15, 0.4, 1] },
    )

    for (const el of elements) observer.observe(el)
    return () => observer.disconnect()
  }, [])

  if (!user) return null

  const isAdmin = isAdminUser(user)
  const displayName = user.name || user.email || 'Signed in'
  const initial = (user.name || user.email || 'H').slice(0, 1).toUpperCase()
  const profileLinked = Boolean(employeeProfile?.linked)

  function scrollToSection(id: SettingsSection) {
    setActiveSection(id)
    document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function onChangePassword(e: FormEvent) {
    e.preventDefault()
    setPasswordError(null)
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match')
      return
    }
    if (!(await confirmAction('Change your dashboard password?'))) return
    setPasswordSubmitting(true)
    try {
      const data = await changePasswordRequest({ currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      toastSuccess(data.message)
      await refreshUser()
    } catch (err) {
      setPasswordError(readAxiosMessage(err, 'Could not change password'))
    } finally {
      setPasswordSubmitting(false)
    }
  }

  async function onResetPasswordViaEmail() {
    if (
      !(await confirmAction(
        'Sign out and reset your password with an email code? You must be able to read mail sent to your login address.',
      ))
    ) {
      return
    }
    await logout()
    navigate('/forgot-password')
  }

  return (
    <AppShell active="settings">
      <main className="app-page settings-page">
        <header className="page-header">
          <p className="page-kicker">Preferences</p>
          <h1 className="page-title">Settings</h1>
          <p className="settings-intro">
            Everything about your login, HR record, and workspace - scroll or use the menu to jump to a topic.
          </p>
        </header>

        <div className="settings-layout">
          <nav className="settings-rail" aria-label="Settings sections">
            <div className="settings-rail-inner card border">
              {SECTIONS.map(({ id, label, hint }) => {
                const active = activeSection === id
                return (
                  <button
                    key={id}
                    type="button"
                    className={`settings-rail-btn${active ? ' settings-rail-btn-active' : ''}`}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => scrollToSection(id)}
                  >
                    <span className="settings-rail-label">{label}</span>
                    <span className="settings-rail-hint">{hint}</span>
                  </button>
                )
              })}
            </div>
          </nav>

          <div ref={streamRef} className="settings-stream">
            <SettingsBlock
              id="account"
              title="Account"
              description="The identity used to sign in across attendance, requests, and payroll."
            >
              <div className="settings-account-hero">
                <span className="settings-account-avatar" aria-hidden>{initial}</span>
                <div className="min-w-0 flex-1">
                  <p className="settings-account-name">{displayName}</p>
                  {user.email ? <p className="settings-account-email">{user.email}</p> : null}
                  <p className="settings-account-role">{roleLabel(user)}</p>
                </div>
                <button type="button" className="btn-secondary shrink-0" onClick={() => void logout()}>
                  Log out
                </button>
              </div>
              <div className="settings-fields settings-fields-compact">
                <SettingsField label="Display name">{user.name || '-'}</SettingsField>
                <SettingsField label="Login email">{user.email || '-'}</SettingsField>
              </div>
            </SettingsBlock>

            <SettingsBlock
              id="profile"
              title="Employee profile"
              description="Read-only payroll record linked by HR - used for attendance, leave, and salary."
            >
              {profileLoading ? (
                <p className="settings-muted">Loading employee profile…</p>
              ) : profileLinked ? (
                <>
                  <p className="settings-status settings-status-ok">Linked to your login</p>
                  <div className="settings-fields settings-fields-grid">
                    <SettingsField label="Employee code">{employeeProfile?.employeeCode ?? '-'}</SettingsField>
                    <SettingsField label="Name on register">{employeeProfile?.name ?? '-'}</SettingsField>
                    <SettingsField label="Team">{employeeProfile?.teamName ?? 'Not assigned'}</SettingsField>
                    <SettingsField label="Department">{employeeProfile?.department ?? '-'}</SettingsField>
                    <SettingsField label="Date of joining">
                      {employeeProfile?.dateOfJoining
                        ? formatDojDdMmYyyy(employeeProfile.dateOfJoining)
                        : 'Not set - ask HR'}
                    </SettingsField>
                  </div>
                </>
              ) : (
                <>
                  <p className="settings-status settings-status-warn">Not linked yet</p>
                  <div className="settings-callout">
                    <p className="settings-callout-text">
                      Ask HR to connect your work email to an employee record so attendance, leave, and payslips
                      stay in sync with this account.
                    </p>
                  </div>
                </>
              )}
            </SettingsBlock>

            <SettingsBlock
              id="workspace"
              title="Workspace"
              description="Shared defaults for registers, salary runs, and reports."
            >
              <div className="settings-fields settings-fields-grid">
                <SettingsField label="Company">{DEFAULT_UPLOAD_COMPANY}</SettingsField>
                <SettingsField label="Timezone">Asia/Kolkata (IST)</SettingsField>
              </div>
              <div className="settings-link-stack">
                <SettingsLinkRow
                  to="/policies"
                  title="Attendance & leave policies"
                  description="Official rules and reference"
                />
                <SettingsLinkRow to="/" title="Dashboard" description="Month status and module shortcuts" />
              </div>
            </SettingsBlock>

            <SettingsBlock
              id="security"
              title="Security"
              description="Know your current password? Change it below. If not, reset with an email code (signs you out first)."
            >
              <form onSubmit={(e) => void onChangePassword(e)} className="settings-form">
                <div className="settings-form-grid">
                  <label className="settings-form-label">
                    <span>Current password</span>
                    <PasswordInput
                      required
                      autoComplete="current-password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                  </label>
                  <label className="settings-form-label">
                    <span>New password</span>
                    <PasswordInput
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                  </label>
                  <label className="settings-form-label settings-form-label-full">
                    <span>Confirm new password</span>
                    <PasswordInput
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                  </label>
                </div>
                {passwordError ? <p className="settings-form-error">{passwordError}</p> : null}
                <div className="settings-form-actions">
                  <button type="submit" disabled={passwordSubmitting} className="btn-primary">
                    {passwordSubmitting ? 'Saving…' : 'Change password'}
                  </button>
                  <button
                    type="button"
                    className="settings-inline-link"
                    onClick={() => void onResetPasswordViaEmail()}
                  >
                    Don&apos;t know your current password?
                  </button>
                </div>
              </form>
              {isAdmin ? (
                <div className="settings-admin-block">
                  <p className="settings-admin-label">Administration</p>
                  <SettingsLinkRow
                    to="/admin"
                    title="Admin panel"
                    description="People, access, and team assignments"
                  />
                </div>
              ) : null}
            </SettingsBlock>
          </div>
        </div>
      </main>
    </AppShell>
  )
}
