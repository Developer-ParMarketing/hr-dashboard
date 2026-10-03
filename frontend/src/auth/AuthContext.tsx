import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  fetchCurrentUser,
  loginStartRequest,
  loginVerifyRequest,
  loginResendRequest,
  logoutRequest,
  type AuthUser,
  type LoginStartResponse,
} from '../api/auth'
import { setUnauthorizedHandler } from '../api/client'

type AuthState = {
  user: AuthUser | null
  loading: boolean
  startLogin: (email: string, password: string) => Promise<LoginStartResponse>
  verifyLogin: (challengeId: string, code: string) => Promise<void>
  resendLoginCode: (challengeId: string) => Promise<{ challengeId: string; maskedEmail?: string }>
  refreshUser: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const logout = useCallback(async () => {
    await logoutRequest()
    setUser(null)
  }, [])

  const refreshUser = useCallback(async () => {
    const next = await fetchCurrentUser()
    setUser(next)
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null))
    void fetchCurrentUser()
      .then((next) => setUser(next))
      .finally(() => setLoading(false))
    return () => setUnauthorizedHandler(null)
  }, [])

  const startLogin = useCallback(async (email: string, password: string) => {
    const data = await loginStartRequest(email, password)
    if ('token' in data && data.user) {
      setUser(data.user)
    }
    return data
  }, [])

  const verifyLogin = useCallback(async (challengeId: string, code: string) => {
    const data = await loginVerifyRequest(challengeId, code)
    setUser(data.user)
  }, [])

  const resendLoginCode = useCallback(async (challengeId: string) => {
    const data = await loginResendRequest(challengeId)
    return { challengeId: data.challengeId, maskedEmail: data.maskedEmail }
  }, [])

  const value = useMemo(
    () => ({ user, loading, startLogin, verifyLogin, resendLoginCode, refreshUser, logout }),
    [user, loading, startLogin, verifyLogin, resendLoginCode, refreshUser, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
