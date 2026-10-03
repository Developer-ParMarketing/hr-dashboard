import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  registerConfirmRunner,
  type ConfirmDialogOptions,
} from '../utils/confirmBridge'

type OpenState = ConfirmDialogOptions & { resolve: (value: boolean) => void }

function parseMessage(message: string): { title: string; detail?: string } {
  const parts = message.split('\n\n').map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return { title: 'Confirm' }
  if (parts.length === 1) return { title: parts[0]! }
  return { title: parts[0]!, detail: parts.slice(1).join('\n\n') }
}

function ConfirmDialogView({
  open,
  title,
  detail,
  confirmLabel,
  cancelLabel,
  tone,
  alertOnly,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  detail?: string
  confirmLabel: string
  cancelLabel: string
  tone: 'default' | 'danger'
  alertOnly?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const titleId = useId()
  const detailId = useId()
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => confirmRef.current?.focus(), 0)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onCancel])

  if (!open) return null

  return createPortal(
    <div className="confirm-root" role="presentation">
      <button
        type="button"
        className="confirm-backdrop"
        aria-label="Dismiss dialog"
        onClick={onCancel}
      />
      <div
        className="confirm-panel card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={detail ? detailId : undefined}
      >
        <h2 id={titleId} className="confirm-title">
          {title}
        </h2>
        {detail ? (
          <p id={detailId} className="confirm-detail">
            {detail}
          </p>
        ) : null}
        <div className="confirm-actions">
          {!alertOnly ? (
            <button type="button" className="btn-ghost text-sm" onClick={onCancel}>
              {cancelLabel}
            </button>
          ) : null}
          <button
            ref={confirmRef}
            type="button"
            className={tone === 'danger' ? 'confirm-btn-danger text-sm' : 'btn-primary text-sm'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OpenState | null>(null)

  const runConfirm = useCallback((options: ConfirmDialogOptions) => {
    return new Promise<boolean>((resolve) => {
      setState({ ...options, resolve })
    })
  }, [])

  useEffect(() => {
    registerConfirmRunner(runConfirm)
    return () => registerConfirmRunner(null)
  }, [runConfirm])

  const close = useCallback((result: boolean) => {
    setState((prev) => {
      prev?.resolve(result)
      return null
    })
  }, [])

  const parsed = state ? parseMessage(state.message) : null
  const tone = state?.tone ?? 'default'
  const alertOnly = state?.alertOnly ?? false
  const confirmLabel =
    state?.confirmLabel ?? (alertOnly ? 'OK' : tone === 'danger' ? 'Delete' : 'Confirm')
  const cancelLabel = state?.cancelLabel ?? 'Cancel'
  const dialogTitle = state?.title ?? parsed?.title ?? 'Confirm'
  const dialogDetail = state?.detail ?? (state?.title ? state.message : parsed?.detail)

  return (
    <>
      {children}
      <ConfirmDialogView
        open={state != null}
        title={dialogTitle}
        detail={dialogDetail}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        tone={tone}
        alertOnly={alertOnly}
        onConfirm={() => close(true)}
        onCancel={() => close(false)}
      />
    </>
  )
}
