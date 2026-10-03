import { useState, type InputHTMLAttributes } from 'react'

function EyeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 3l18 18M10.5 10.7a2.5 2.5 0 0 0 3.5 3.5M7.2 7.3C5.4 8.6 4 10.2 3 12c0 0 3.5 7 9 7 1.8 0 3.4-.5 4.7-1.3M9.9 5.1A10.8 10.8 0 0 1 12 5c6.5 0 9 7 9 7a16.2 16.2 0 0 1-2.1 3.2"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  )
}

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  wrapperClassName?: string
}

export function PasswordInput({ className, wrapperClassName, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false)

  return (
    <div className={['password-field', wrapperClassName].filter(Boolean).join(' ')}>
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        className={['field password-field-input', className].filter(Boolean).join(' ')}
      />
      <button
        type="button"
        className="password-field-toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  )
}
