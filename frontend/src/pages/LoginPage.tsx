import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../auth/AuthContext'
import { PasswordInput } from '../components/PasswordInput'
import type { LoginChallengeResponse } from '../api/auth'

const BRAND_LOGO = '/par-marketing-logo.png'

function readAxiosMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    if (!err.response) {
      if (err.code === 'ERR_NETWORK' || err.message === 'Network Error') {
        return 'Unable to connect right now. Please try again in a moment.'
      }
      return err.message || fallback
    }
    const msg =
      typeof err.response?.data === 'string'
        ? err.response.data
        : (err.response?.data as { message?: string } | undefined)?.message
    return msg || fallback
  }
  return err instanceof Error ? err.message : fallback
}

export function LoginPage() {
  const { user, loading, startLogin, verifyLogin, resendLoginCode } = useAuth()
  const navigate = useNavigate()

  const [step, setStep] = useState<'password' | 'otp'>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [maskedEmail, setMaskedEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [resending, setResending] = useState(false)

  if (!loading && user) {
    if (user.mustChangePassword) {
      return <Navigate to="/change-password" replace />
    }
    return <Navigate to="/" replace />
  }

  async function onPasswordSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setSubmitting(true)
    try {
      const data = await startLogin(email, password)
      if ('token' in data && data.user) {
        navigate('/', { replace: true })
        return
      }
      const challenge = data as LoginChallengeResponse
      setChallengeId(challenge.challengeId)
      setMaskedEmail(challenge.maskedEmail)
      setCode('')
      setStep('otp')
      setInfo(challenge.message)
    } catch (err) {
      setError(readAxiosMessage(err, 'Could not sign in'))
    } finally {
      setSubmitting(false)
    }
  }

  async function onOtpSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setSubmitting(true)
    try {
      await verifyLogin(challengeId, code)
      navigate('/', { replace: true })
    } catch (err) {
      setError(readAxiosMessage(err, 'Invalid verification code'))
    } finally {
      setSubmitting(false)
    }
  }

  async function onResend() {
    if (!challengeId) return
    setError(null)
    setResending(true)
    try {
      const next = await resendLoginCode(challengeId)
      setChallengeId(next.challengeId)
      if (next.maskedEmail) setMaskedEmail(next.maskedEmail)
      setInfo('A new verification code was sent.')
    } catch (err) {
      setError(readAxiosMessage(err, 'Could not resend code'))
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden
      >
        <div className="absolute -left-24 top-10 h-72 w-72 rounded-full bg-[color-mix(in_srgb,var(--color-brand)_22%,transparent)] blur-3xl" />
        <div className="absolute -right-16 bottom-8 h-80 w-80 rounded-full bg-[color-mix(in_srgb,var(--color-brand)_12%,transparent)] blur-3xl" />
      </div>

      <div className="relative mb-8 flex flex-col items-center">
        <div className="rounded-2xl border border-[color-mix(in_srgb,var(--color-warm-muted)_85%,transparent)] bg-[var(--color-surface)] px-5 py-3 shadow-[var(--shadow-card)]">
          <img
            src={BRAND_LOGO}
            alt="Par Marketing"
            className="h-10 w-auto max-w-[220px] object-contain sm:h-12"
            width={240}
            height={72}
          />
        </div>
      </div>

      <div className="card relative w-full max-w-[26rem] overflow-hidden">
        <div
          className="h-1.5 bg-gradient-to-r from-[var(--color-brand)] via-[#ff9a4a] to-[color-mix(in_srgb,var(--color-brand)_35%,#fff)]"
          aria-hidden
        />
        {step === 'password' ? (
          <form onSubmit={(e) => void onPasswordSubmit(e)} className="space-y-5 px-6 py-8 sm:px-8">
            <div>
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-brand)]">
                Team portal
              </p>
              <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
                Sign in
              </h1>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-warm-text)]">
                Use your work email and password. Employees, managers, and HR all sign in here.
              </p>
            </div>
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-[var(--color-ink)]">Email</span>
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="field"
              />
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-[var(--color-ink)]">Password</span>
              <PasswordInput
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error ? (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" disabled={submitting || loading} className="btn-primary w-full">
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
            <p className="text-center text-sm text-[var(--color-warm-text)]">
              <Link to="/forgot-password" className="text-[var(--color-brand)] underline-offset-2 hover:underline">
                Forgot password?
              </Link>
              <span className="mx-2">·</span>
              <Link to="/activate" className="text-[var(--color-brand)] underline-offset-2 hover:underline">
                First-time setup
              </Link>
            </p>
          </form>
        ) : (
          <form onSubmit={(e) => void onOtpSubmit(e)} className="space-y-5 px-6 py-8 sm:px-8">
            <div>
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-brand)]">
                Verification
              </p>
              <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
                Enter code
              </h1>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-warm-text)]">
                We sent a 6-digit code to {maskedEmail || 'your email'}.
              </p>
            </div>
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-[var(--color-ink)]">Verification code</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                maxLength={6}
                pattern="[0-9]{6}"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="field text-center text-lg tracking-[0.35em]"
              />
            </label>
            {info ? (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                {info}
              </p>
            ) : null}
            {error ? (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" disabled={submitting || loading || code.length !== 6} className="btn-primary w-full">
              {submitting ? 'Verifying…' : 'Sign in'}
            </button>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <button
                type="button"
                className="text-[var(--color-brand)] underline-offset-2 hover:underline"
                onClick={() => {
                  setStep('password')
                  setError(null)
                  setInfo(null)
                }}
              >
                Back
              </button>
              <button
                type="button"
                className="text-[var(--color-brand)] underline-offset-2 hover:underline disabled:opacity-50"
                disabled={resending}
                onClick={() => void onResend()}
              >
                {resending ? 'Sending…' : 'Resend code'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
