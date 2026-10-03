import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import axios from 'axios'
import { forgotPasswordRequest, forgotPasswordResetRequest } from '../api/auth'
import { useAuth } from '../auth/AuthContext'
import { PasswordInput } from '../components/PasswordInput'

const BRAND_LOGO = '/par-marketing-logo.png'

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

export function ForgotPasswordPage() {
  const { user, loading } = useAuth()
  const [step, setStep] = useState<'email' | 'reset' | 'done'>('email')
  const [email, setEmail] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [maskedEmail, setMaskedEmail] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!loading && user) {
    return <Navigate to="/" replace />
  }

  async function onEmailSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setSubmitting(true)
    try {
      const data = await forgotPasswordRequest(email)
      setInfo(data.message)
      if (data.challengeId) {
        setChallengeId(data.challengeId)
        setMaskedEmail(data.maskedEmail ?? email)
        setStep('reset')
      }
    } catch (err) {
      setError(readAxiosMessage(err, 'Could not start password reset'))
    } finally {
      setSubmitting(false)
    }
  }

  async function onResetSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    setSubmitting(true)
    try {
      const data = await forgotPasswordResetRequest({ challengeId, code, newPassword })
      setInfo(data.message)
      setStep('done')
    } catch (err) {
      setError(readAxiosMessage(err, 'Could not reset password'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="relative mb-8 flex flex-col items-center">
        <div className="rounded-2xl border border-[color-mix(in_srgb,var(--color-warm-muted)_85%,transparent)] bg-[var(--color-surface)] px-5 py-3 shadow-[var(--shadow-card)]">
          <img src={BRAND_LOGO} alt="Par Marketing" className="h-10 w-auto max-w-[220px] object-contain sm:h-12" />
        </div>
      </div>

      <div className="card relative w-full max-w-[26rem] overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-[var(--color-brand)] via-[#ff9a4a] to-[color-mix(in_srgb,var(--color-brand)_35%,#fff)]" />
        {step === 'email' ? (
          <form onSubmit={(e) => void onEmailSubmit(e)} className="space-y-5 px-6 py-8 sm:px-8">
            <div>
              <h1 className="text-2xl font-semibold text-[var(--color-ink)]">Forgot password</h1>
              <p className="mt-1.5 text-sm text-[var(--color-warm-text)]">
                Enter your account email. If it exists, we will send a reset code.
              </p>
            </div>
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="field"
              />
            </label>
            {info ? <p className="text-sm text-emerald-800">{info}</p> : null}
            {error ? <p className="text-sm text-red-800">{error}</p> : null}
            <button type="submit" disabled={submitting} className="btn-primary w-full">
              {submitting ? 'Sending…' : 'Send reset code'}
            </button>
            <p className="text-center text-sm">
              <Link to="/login" className="text-[var(--color-brand)] hover:underline">
                Back to sign in
              </Link>
            </p>
          </form>
        ) : step === 'reset' ? (
          <form onSubmit={(e) => void onResetSubmit(e)} className="space-y-5 px-6 py-8 sm:px-8">
            <div>
              <h1 className="text-2xl font-semibold text-[var(--color-ink)]">Reset password</h1>
              <p className="mt-1.5 text-sm text-[var(--color-warm-text)]">
                Enter the code sent to {maskedEmail} and choose a new password.
              </p>
            </div>
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">Reset code</span>
              <input
                type="text"
                inputMode="numeric"
                required
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="field text-center tracking-[0.35em]"
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
              <span className="font-medium">Confirm password</span>
              <PasswordInput
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </label>
            {error ? <p className="text-sm text-red-800">{error}</p> : null}
            <button type="submit" disabled={submitting} className="btn-primary w-full">
              {submitting ? 'Updating…' : 'Update password'}
            </button>
          </form>
        ) : (
          <div className="space-y-5 px-6 py-8 sm:px-8">
            <h1 className="text-2xl font-semibold text-[var(--color-ink)]">Password updated</h1>
            <p className="text-sm text-[var(--color-warm-text)]">{info}</p>
            <Link to="/login" className="btn-primary inline-flex w-full justify-center">
              Sign in
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
