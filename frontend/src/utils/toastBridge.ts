export type ToastVariant = 'success' | 'error' | 'info'

export type ToastOptions = {
  variant?: ToastVariant
  /** Defaults to 3000ms */
  durationMs?: number
}

type ToastRunner = (message: string, options?: ToastOptions) => void

let runner: ToastRunner | null = null

export function registerToastRunner(next: ToastRunner | null): void {
  runner = next
}

export function showToast(message: string, options?: ToastOptions): void {
  const text = message.trim()
  if (!text) return
  if (runner) {
    runner(text, options)
    return
  }
}

/** Short-lived popup for completed actions (replaces inline alert-success boxes). */
export function toastSuccess(message: string, durationMs = 3000): void {
  showToast(message, { variant: 'success', durationMs })
}
