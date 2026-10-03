export type ConfirmDialogOptions = {
  message: string
  title?: string
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
  /** Single OK button - for validation / info (not a yes/no confirm). */
  alertOnly?: boolean
}

type ConfirmRunner = (options: ConfirmDialogOptions) => Promise<boolean>

let runner: ConfirmRunner | null = null

export function registerConfirmRunner(next: ConfirmRunner | null): void {
  runner = next
}

function fallbackConfirm(message: string): boolean {
  if (typeof window === 'undefined') return true
  return window.confirm(message)
}

export async function runConfirm(options: ConfirmDialogOptions): Promise<boolean> {
  if (runner) return runner(options)
  return fallbackConfirm(options.message)
}
