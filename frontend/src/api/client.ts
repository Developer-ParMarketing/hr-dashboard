import axios from 'axios'

const TOKEN_KEY = 'attendance_token'

export function getStoredToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setStoredToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token)
    else sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore quota / private mode */
  }
}

const base = import.meta.env.VITE_API_BASE ?? ''

export const client = axios.create({
  baseURL: base,
  timeout: 120_000,
  withCredentials: true,
})

client.interceptors.request.use((config) => {
  const token = getStoredToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

let onUnauthorized: (() => void) | null = null

export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler
}

client.interceptors.response.use(
  (res) => res,
  (error: unknown) => {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 502 || error.code === 'ECONNREFUSED') {
        error.message = 'Unable to connect right now. Please try again in a moment.'
      }
      if (error.response?.status === 401) {
        const url = String(error.config?.url ?? '')
        const isPublicAuth =
          url.includes('/api/auth/login') ||
          url.includes('/api/auth/forgot-password') ||
          url.includes('/api/auth/account-setup') ||
          url.includes('/api/auth/me')
        if (!isPublicAuth) {
          setStoredToken(null)
          onUnauthorized?.()
        }
      }
    }
    return Promise.reject(error)
  },
)
