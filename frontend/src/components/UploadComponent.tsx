import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_UPLOAD_COMPANY } from '../constants/companies'
import { DOCUMENT_UPLOAD_ACCEPT } from '../constants/uploadFormats'

type Props = {
  reportView: 'daily' | 'weekly' | 'monthly'
  onReportViewChange: (v: 'daily' | 'weekly' | 'monthly') => void
  onFileSelect: (file: File | null) => void
  selectedFile: File | null
  leaveFile: File | null
  wfhFile: File | null
  onLeaveFileSelect: (file: File | null) => void
  onWfhFileSelect: (file: File | null) => void
  onProcess: () => void
  loading: boolean
  error: string | null
  canUpload?: boolean
}

const REPORT_TYPE_HINT: Record<'daily' | 'weekly' | 'monthly', string> = {
  daily: 'One-day ESSL register - optional leave and WFH files below.',
  weekly: 'Week grid - opens Weekly after processing. Optional leave and WFH files below.',
  monthly: 'Full month grid - opens Monthly after processing. Optional leave and WFH files below.',
}

function FlowStep({
  step,
  title,
  hint,
  children,
  last = false,
}: {
  step: number
  title: string
  hint?: string
  children: React.ReactNode
  last?: boolean
}) {
  return (
    <div className={`flow-step ${last ? '' : 'flow-step-divider'}`}>
      <div className="flow-step-marker" aria-hidden>
        {step}
      </div>
      <div className="min-w-0 flex-1 pb-6">
        <h3 className="text-sm font-semibold text-[var(--color-ink)]">{title}</h3>
        {hint ? (
          <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-warm-text)]">{hint}</p>
        ) : null}
        <div className="mt-3">{children}</div>
      </div>
    </div>
  )
}

export function UploadComponent({
  reportView,
  onReportViewChange,
  onFileSelect,
  selectedFile,
  leaveFile,
  wfhFile,
  onLeaveFileSelect,
  onWfhFileSelect,
  onProcess,
  loading,
  error,
  canUpload = true,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const leaveInputRef = useRef<HTMLInputElement>(null)
  const wfhInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  const fileOk = Boolean(selectedFile)
  const canProcess = fileOk && !loading && canUpload

  useEffect(() => {
    if (!selectedFile && inputRef.current) inputRef.current.value = ''
  }, [selectedFile])

  useEffect(() => {
    if (!leaveFile && leaveInputRef.current) leaveInputRef.current.value = ''
  }, [leaveFile])

  useEffect(() => {
    if (!wfhFile && wfhInputRef.current) wfhInputRef.current.value = ''
  }, [wfhFile])

  const pickFile = useCallback(
    (file: File | undefined) => {
      if (!file) return
      onFileSelect(file)
    },
    [onFileSelect],
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      pickFile(e.dataTransfer.files[0])
    },
    [pickFile],
  )

  return (
    <section className="card overflow-hidden">
      <div className="card-head">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-brand)]">
          New register
        </p>
        <h2 className="mt-1 text-lg font-semibold tracking-tight text-[var(--color-ink)]">
          Upload & process
        </h2>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[var(--color-warm-text)]">
          Pick register type and file - month and date are read from the ESSL export automatically. After
          processing, use Daily, Weekly, or Monthly above to review.
        </p>
        <button
          type="button"
          onClick={() => setHelpOpen((v) => !v)}
          className="mt-2 text-xs font-semibold text-[var(--color-brand)] hover:underline"
          aria-expanded={helpOpen}
        >
          {helpOpen ? 'Hide tips' : 'Show tips (ESSL, late rule, company note)'}
        </button>
        {helpOpen ? (
          <div className="alert-info mt-3 text-xs leading-relaxed">
            <p>
              <strong className="font-medium text-[var(--color-ink)]">Optional files:</strong> leave
              and WFH are separate Computex exports - attach one or both to cross-check AB cells.{' '}
              <strong className="font-medium text-[var(--color-ink)]">Late</strong> = first punch after
              shift start + 15 min.
            </p>
            <p className="mt-2">
              <strong className="font-medium text-[var(--color-ink)]">Period:</strong> taken from the
              register date in your PDF or sheet header - no manual month/year step.
            </p>
            <p className="mt-2">
              Registers are saved for <strong className="font-medium">{DEFAULT_UPLOAD_COMPANY}</strong>{' '}
              (Par Marketing). The file still includes everyone in the export.
            </p>
          </div>
        ) : null}
      </div>

      {!canUpload ? (
        <div className="border-b border-[var(--color-warm-muted)] bg-[color-mix(in_srgb,var(--color-warm-muted)_35%,#fff)] px-6 py-3 text-sm text-[var(--color-warm-text)] sm:px-8">
          Attendance registers are read-only on your account. HR uploads registers; open saved months from the
          Attendance history page in the menu.
        </div>
      ) : null}

      <div className="px-6 py-6 sm:px-8">
        <FlowStep step={1} title="Register type" hint={REPORT_TYPE_HINT[reportView]}>
          <div className="seg sm:max-w-md" role="group" aria-label="Register type">
            {(
              [
                ['daily', 'Daily'],
                ['weekly', 'Weekly'],
                ['monthly', 'Monthly'],
              ] as const
            ).map(([id, label]) => {
              const active = reportView === id
              return (
                <button
                  key={id}
                  type="button"
                  disabled={loading}
                  onClick={() => onReportViewChange(id)}
                  className={`seg-btn flex-1 text-center ${active ? 'seg-btn-active' : ''}`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </FlowStep>

        <FlowStep
          step={2}
          title="ESSL register file"
          hint="Upload the ESSL attendance export for this register - usually a PDF from ESSL, or Excel/CSV if you export from there."
          last
        >
          <div className="mb-4 grid gap-3 rounded-xl border border-[color-mix(in_srgb,var(--color-warm-muted)_80%,transparent)] bg-[color-mix(in_srgb,var(--color-warm-page)_40%,#fff)] p-3 sm:grid-cols-2">
            <OptionalFileChip
              label="Leave file"
              file={leaveFile}
              inputRef={leaveInputRef}
              loading={loading}
              onPick={() => leaveInputRef.current?.click()}
              onClear={() => {
                onLeaveFileSelect(null)
                if (leaveInputRef.current) leaveInputRef.current.value = ''
              }}
              onChange={(f) => onLeaveFileSelect(f)}
            />
            <OptionalFileChip
              label="WFH file"
              file={wfhFile}
              inputRef={wfhInputRef}
              loading={loading}
              onPick={() => wfhInputRef.current?.click()}
              onClear={() => {
                onWfhFileSelect(null)
                if (wfhInputRef.current) wfhInputRef.current.value = ''
              }}
              onChange={(f) => onWfhFileSelect(f)}
            />
          </div>

          <div
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                inputRef.current?.click()
              }
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`dropzone ${dragOver ? 'dropzone-active' : ''}`}
          >
            <input
              ref={inputRef}
              type="file"
              accept={DOCUMENT_UPLOAD_ACCEPT}
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
            {selectedFile && (
              <button
                type="button"
                aria-label="Remove selected file"
                disabled={loading}
                onClick={(e) => {
                  e.stopPropagation()
                  onFileSelect(null)
                  if (inputRef.current) inputRef.current.value = ''
                }}
                className="pointer-events-auto absolute right-3 top-3 z-10 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-[color-mix(in_srgb,var(--color-warm-muted)_90%,#000)] bg-[var(--color-surface)] text-[var(--color-ink)] shadow-sm transition hover:bg-[color-mix(in_srgb,var(--color-brand-muted)_80%,#fff)] hover:text-[var(--color-brand)] disabled:pointer-events-none disabled:opacity-40"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
            <div className="pointer-events-none">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-brand-muted)] text-[var(--color-brand)]">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M12 12V4m0 0L8 8m4-4l4 4"
                  />
                </svg>
              </div>
              <p className="text-sm font-semibold text-[var(--color-ink)]">
                {selectedFile ? selectedFile.name : 'Upload ESSL PDF here'}
              </p>
              {!selectedFile ? (
                <p className="mt-1 text-xs text-[var(--color-warm-text)]">
                  Drop your ESSL file or click to browse · PDF, Excel, CSV, TSV, ODS
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-4">
            <button
              type="button"
              onClick={onProcess}
              disabled={!canProcess}
              className="btn-primary w-full sm:w-auto sm:min-w-[10rem]"
            >
              {loading ? (
                <>
                  <Spinner className="mr-2" />
                  Processing…
                </>
              ) : (
                'Process register'
              )}
            </button>
          </div>
        </FlowStep>

        {error ? <p className="alert-error mt-2">{error}</p> : null}
      </div>
    </section>
  )
}

function OptionalFileChip({
  label,
  file,
  inputRef,
  loading,
  onPick,
  onClear,
  onChange,
}: {
  label: string
  file: File | null
  inputRef: React.RefObject<HTMLInputElement | null>
  loading: boolean
  onPick: () => void
  onClear: () => void
  onChange: (f: File | null) => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="field-label">{label} (optional)</span>
      <input
        ref={inputRef}
        type="file"
        accept={DOCUMENT_UPLOAD_ACCEPT}
        className="hidden"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onPick} disabled={loading} className="btn-ghost px-2.5 py-1.5 text-xs">
          Browse
        </button>
        <span
          className={
            file
              ? 'min-w-0 truncate rounded-full bg-[var(--color-brand-muted)] px-2.5 py-0.5 text-xs font-medium text-[var(--color-brand)]'
              : 'text-xs text-[var(--color-warm-text)]'
          }
          title={file?.name}
        >
          {file ? file.name : 'Not added'}
        </span>
        {file ? (
          <button type="button" className="text-xs text-red-700 underline" onClick={onClear}>
            Remove
          </button>
        ) : null}
      </div>
    </div>
  )
}

function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`h-4 w-4 animate-spin ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}
