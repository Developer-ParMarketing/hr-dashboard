import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { registerToastRunner, type ToastOptions, type ToastVariant } from '../utils/toastBridge'

type ToastItem = {
  id: number
  message: string
  variant: ToastVariant
  exiting: boolean
}

const DEFAULT_DURATION_MS = 3000

function ToastBubble({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  return (
    <div
      className={`toast-item toast-item-${item.variant} ${item.exiting ? 'toast-item-exit' : 'toast-item-enter'}`}
      role="status"
      aria-live="polite"
    >
      <p className="toast-item-message">{item.message}</p>
      <button
        type="button"
        className="toast-item-close"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(item.id)}
      >
        ×
      </button>
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)))
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 220)
  }, [])

  const push = useCallback(
    (message: string, options?: ToastOptions) => {
      const id = Date.now() + Math.floor(Math.random() * 1000)
      const variant = options?.variant ?? 'success'
      const durationMs = options?.durationMs ?? DEFAULT_DURATION_MS
      setToasts((prev) => [...prev, { id, message, variant, exiting: false }])
      window.setTimeout(() => dismiss(id), durationMs)
    },
    [dismiss],
  )

  useEffect(() => {
    registerToastRunner(push)
    return () => registerToastRunner(null)
  }, [push])

  return (
    <>
      {children}
      {createPortal(
        <div className="toast-stack" aria-label="Notifications">
          {toasts.map((item) => (
            <ToastBubble key={item.id} item={item} onDismiss={dismiss} />
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
