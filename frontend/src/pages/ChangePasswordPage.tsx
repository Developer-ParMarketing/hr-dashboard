import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { changePasswordRequest } from '../api/auth'
import { useAuth } from '../auth/AuthContext'
import { PasswordInput } from '../components/PasswordInput'
import { confirmAction } from '../utils/confirmAction'

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

export function ChangePasswordPage() {
  const { user, loading, refreshUser } = useAuth()
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!loading && !user) {
    return <Navigate to="/login" replace />
  }

  if (!loading && user && !user.mustChangePassword) {
    return <Navigate to="/" replace />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (!(await confirmAction('Set your new dashboard password?'))) return
    setSubmitting(true)
    try {
      await changePasswordRequest({ currentPassword, newPassword })
      await refreshUser()
      navigate('/', { replace: true })
    } catch (err) {
      setError(readAxiosMessage(err, 'Could not change password'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="card w-full max-w-[26rem] overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-[var(--color-brand)] via-[#ff9a4a] to-[color-mix(in_srgb,var(--color-brand)_35%,#fff)]" />
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-5 px-6 py-8 sm:px-8">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--color-ink)]">Change password</h1>
            <p className="mt-1.5 text-sm text-[var(--color-warm-text)]">
              {user?.mustChangePassword
                ? 'You must set a new password before continuing.'
                : 'Update your account password.'}
            </p>
          </div>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Current password</span>
            <PasswordInput
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">New password</span>
            <PasswordInput
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Confirm new password</span>
            <PasswordInput
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </label>
          {error ? <p className="text-sm text-red-800">{error}</p> : null}
          <button type="submit" disabled={submitting || loading} className="btn-primary w-full">
            {submitting ? 'Saving…' : 'Save password'}
          </button>
        </form>
      </div>
    </div>
  )
}
