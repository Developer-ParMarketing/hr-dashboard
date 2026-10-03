import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import axios from 'axios'
import {
  accountSetupComplete,
  fetchAccountSetupChallenge,
  resendAccountSetupCode,
} from '../api/auth'
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

export function ActivateAccountPage() {
  const { user, loading } = useAuth()
  const [searchParams] = useSearchParams()
  const challengeFromUrl = searchParams.get('c')?.trim() ?? ''

  const [challengeId, setChallengeId] = useState(challengeFromUrl)
  const [maskedEmail, setMaskedEmail] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [resending, setResending] = useState(false)
  const [done, setDone] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)

  useEffect(() => {
    if (!challengeFromUrl) {
      setLinkError('Missing setup link. Open the link from your HR invite email.')
      return
    }
    setChallengeId(challengeFromUrl)
    let cancelled = false
    void fetchAccountSetupChallenge(challengeFromUrl)
      .then((data) => {
        if (cancelled) return
        setMaskedEmail(data.maskedEmail)
        setLinkError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setLinkError(readAxiosMessage(err, 'This setup link is not valid anymore.'))
      })
    return () => {
      cancelled = true
    }
  }, [challengeFromUrl])

  if (!loading && user) {
    return <Navigate to="/" replace />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (!challengeId) {
      setError('Setup link is missing.')
      return
    }
    setSubmitting(true)
    try {
      const data = await accountSetupComplete({ challengeId, code, newPassword })
      setInfo(data.message)
      setDone(true)
    } catch (err) {
      setError(readAxiosMessage(err, 'Could not save password'))
    } finally {
      setSubmitting(false)
    }
  }

  async function onResend() {
    if (!challengeId) return
    setResending(true)
    setError(null)
    try {
      const data = await resendAccountSetupCode(challengeId)
      setChallengeId(data.challengeId)
      setInfo(data.message)
      if (data.challengeId !== challengeFromUrl) {
        const url = new URL(window.location.href)
        url.searchParams.set('c', data.challengeId)
        window.history.replaceState({}, '', url.toString())
      }
    } catch (err) {
      setError(readAxiosMessage(err, 'Could not resend code'))
    } finally {
      setResending(false)
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
        {done ? (
          <div className="space-y-5 px-6 py-8 sm:px-8">
            <h1 className="text-2xl font-semibold text-[var(--color-ink)]">You&apos;re all set</h1>
            <p className="text-sm text-[var(--color-warm-text)]">{info}</p>
            <Link to="/login" className="btn-primary inline-flex w-full justify-center">
              Sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={(e) => void onSubmit(e)} className="space-y-5 px-6 py-8 sm:px-8">
            <div>
              <h1 className="text-2xl font-semibold text-[var(--color-ink)]">Set up your password</h1>
              <p className="mt-1.5 text-sm text-[var(--color-warm-text)]">
                {maskedEmail
                  ? `Enter the code from your invite email for ${maskedEmail}, then choose a password.`
                  : 'Use the code from your HR invite email.'}
              </p>
            </div>
            {linkError ? <p className="text-sm text-red-800">{linkError}</p> : null}
            {info && !error ? <p className="text-sm text-emerald-800">{info}</p> : null}
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">Setup code</span>
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
              <span className="font-medium">Password</span>
              <PasswordInput required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
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
            <button type="submit" disabled={submitting || Boolean(linkError)} className="btn-primary w-full">
              {submitting ? 'Saving…' : 'Save password'}
            </button>
            <button
              type="button"
              className="btn-ghost w-full text-sm"
              disabled={resending || !challengeId}
              onClick={() => void onResend()}
            >
              {resending ? 'Sending…' : 'Resend code'}
            </button>
            <p className="text-center text-sm">
              <Link to="/login" className="text-[var(--color-brand)] hover:underline">
                Back to sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
