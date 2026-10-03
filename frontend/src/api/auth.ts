import { client, setStoredToken } from './client'

export type AuthUser = {
  id: number
  email: string
  name: string
  role: string
  mustChangePassword: boolean
}

export type LinkedEmployeeProfile = {
  linked: boolean
  employeeCode: string | null
  name: string | null
  teamName: string | null
  department: string | null
  dateOfJoining: string | null
}

export type MeResponse = {
  user: AuthUser
  employeeProfile: LinkedEmployeeProfile
  attendanceScope?: { mode: string; employeeIds: number[] | null }
  loginOtpRequired?: boolean
}

export type LoginChallengeResponse = {
  challengeId: string
  maskedEmail: string
  expiresInSec: number
  message: string
  otpRequired?: true
}

export type LoginVerifyResponse = {
  user: AuthUser
  token: string
  expiresIn: number
  otpRequired?: false
}

export type LoginStartResponse = LoginChallengeResponse | LoginVerifyResponse

function isDirectLogin(data: LoginStartResponse): data is LoginVerifyResponse {
  return typeof (data as LoginVerifyResponse).token === 'string'
}

export async function loginStartRequest(
  email: string,
  password: string,
): Promise<LoginStartResponse> {
  const { data } = await client.post<LoginStartResponse>('/api/auth/login', {
    email,
    password,
  })
  if (isDirectLogin(data)) {
    setStoredToken(data.token)
  }
  return data
}

export async function loginVerifyRequest(
  challengeId: string,
  code: string,
): Promise<LoginVerifyResponse> {
  const { data } = await client.post<LoginVerifyResponse>('/api/auth/login/verify', {
    challengeId,
    code,
  })
  setStoredToken(data.token)
  return data
}

export async function loginResendRequest(
  challengeId: string,
): Promise<{ challengeId: string; maskedEmail?: string; expiresInSec: number; message: string }> {
  const { data } = await client.post<{
    challengeId: string
    maskedEmail?: string
    expiresInSec: number
    message: string
  }>('/api/auth/login/resend', { challengeId })
  return data
}

export async function forgotPasswordRequest(
  email: string,
): Promise<{ challengeId?: string; maskedEmail?: string; expiresInSec?: number; message: string }> {
  const { data } = await client.post<{
    challengeId?: string
    maskedEmail?: string
    expiresInSec?: number
    message: string
  }>('/api/auth/forgot-password', { email })
  return data
}

export async function forgotPasswordResetRequest(input: {
  challengeId: string
  code: string
  newPassword: string
}): Promise<{ message: string }> {
  const { data } = await client.post<{ message: string }>('/api/auth/forgot-password/reset', input)
  return data
}

export async function fetchAccountSetupChallenge(challengeId: string): Promise<{
  challengeId: string
  maskedEmail: string
  expiresInSec: number
}> {
  const { data } = await client.get<{
    challengeId: string
    maskedEmail: string
    expiresInSec: number
  }>(`/api/auth/account-setup/challenge/${encodeURIComponent(challengeId)}`)
  return data
}

export async function accountSetupComplete(input: {
  challengeId: string
  code: string
  newPassword: string
}): Promise<{ message: string }> {
  const { data } = await client.post<{ message: string }>('/api/auth/account-setup/complete', input)
  return data
}

export async function resendAccountSetupCode(challengeId: string): Promise<{
  challengeId: string
  maskedEmail: string
  expiresInSec: number
  message: string
}> {
  const { data } = await client.post<{
    challengeId: string
    maskedEmail: string
    expiresInSec: number
    message: string
  }>('/api/auth/account-setup/resend', { challengeId })
  return data
}

export async function changePasswordRequest(input: {
  currentPassword: string
  newPassword: string
}): Promise<{ user: AuthUser; message: string }> {
  const { data } = await client.post<{ user: AuthUser; message: string }>(
    '/api/auth/change-password',
    input,
  )
  return data
}

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  const me = await fetchMe()
  return me?.user ?? null
}

export async function fetchMe(): Promise<MeResponse | null> {
  try {
    const { data } = await client.get<MeResponse>('/api/auth/me')
    return data
  } catch {
    return null
  }
}

export async function logoutRequest(): Promise<void> {
  try {
    await client.post('/api/auth/logout')
  } finally {
    setStoredToken(null)
  }
}
