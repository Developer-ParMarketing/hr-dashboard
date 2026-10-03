import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { Navigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../auth/AuthContext'
import { listAdminEmployees, type AdminEmployeeDetail } from '../api/admin'
import {
  downloadRelievingLetter,
  downloadRelievingLetterPdf,
  fetchRelievingLetterMeta,
  saveRelievingSignature,
  type RelievingLetterForm,
  type RelievingLetterMeta,
} from '../api/relievingLetters'
import { DEFAULT_UPLOAD_COMPANY } from '../constants/companies'
import { canUseOfferLetters } from '../auth/permissions'
import { DOJ_INPUT_PLACEHOLDER, formatDojDdMmYyyy } from '../utils/dojFormat'
import { notifyEmployeeRegistryUpdated } from '../utils/employeeRegistryEvents'

function todayDdMmYyyy(): string {
  const d = new Date()
  return formatDojDdMmYyyy(
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
  )
}

function emptyForm(): RelievingLetterForm {
  return {
    letterDate: todayDdMmYyyy(),
    employeeName: '',
    employeeCode: '',
    gender: '',
    designation: '',
    dateOfJoining: '',
    dateOfLeaving: '',
  }
}

function errorMessage(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    if (e.response?.data instanceof Blob) return fallback
    return (e.response?.data as { message?: string })?.message ?? e.message ?? fallback
  }
  return e instanceof Error ? e.message : fallback
}

function formFromEmployee(emp: AdminEmployeeDetail): Partial<RelievingLetterForm> {
  return {
    employeeName: emp.name,
    employeeCode: emp.employeeCode,
    gender: emp.gender ?? '',
    designation: emp.department ?? '',
    dateOfJoining: emp.dateOfJoining ? formatDojDdMmYyyy(emp.dateOfJoining) : '',
  }
}

export function RelievingLetterPage() {
  const { user } = useAuth()
  const allowed = canUseOfferLetters(user)

  const [meta, setMeta] = useState<RelievingLetterMeta | null>(null)
  const [employees, setEmployees] = useState<AdminEmployeeDetail[]>([])
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | ''>('')
  const [form, setForm] = useState<RelievingLetterForm>(() => emptyForm())
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signatureFile, setSignatureFile] = useState<File | null>(null)
  const [rememberSignature, setRememberSignature] = useState(true)
  const [signaturePreview, setSignaturePreview] = useState<string | null>(null)

  useEffect(() => {
    if (!allowed) return
    void Promise.all([
      fetchRelievingLetterMeta(),
      listAdminEmployees(DEFAULT_UPLOAD_COMPANY),
    ])
      .then(([m, emps]) => {
        setMeta(m)
        setEmployees(emps.filter((e) => e.effectiveStatus === 'active'))
      })
      .catch((e) => setError(errorMessage(e, 'Could not load letter settings')))
      .finally(() => setLoading(false))
  }, [allowed])

  const sortedEmployees = useMemo(
    () =>
      [...employees].sort((a, b) =>
        a.employeeCode.localeCompare(b.employeeCode, undefined, { numeric: true }),
      ),
    [employees],
  )

  const onSelectEmployee = useCallback(
    (id: number | '') => {
      setSelectedEmployeeId(id)
      if (id === '') {
        setForm(emptyForm())
        return
      }
      const emp = employees.find((e) => e.id === id)
      if (!emp) return
      setForm((prev) => ({
        ...prev,
        ...formFromEmployee(emp),
        letterDate: prev.letterDate || todayDdMmYyyy(),
      }))
    },
    [employees],
  )

  async function onGenerateWord() {
    setError(null)
    setGenerating(true)
    try {
      await downloadRelievingLetter(form)
      notifyEmployeeRegistryUpdated()
      const emps = await listAdminEmployees(DEFAULT_UPLOAD_COMPANY)
      setEmployees(emps.filter((e) => e.effectiveStatus === 'active'))
    } catch (e) {
      setError(errorMessage(e, 'Could not generate letter'))
    } finally {
      setGenerating(false)
    }
  }

  async function onGeneratePdf() {
    setError(null)
    if (!meta?.pdfConversionAvailable) {
      setError(
        'PDF export needs LibreOffice on the server (soffice). Ask your admin to install it and restart the API.',
      )
      return
    }
    if (!signatureFile && !meta?.hasSavedSignature) {
      setError('Upload a digital signature image (PNG or JPEG) before generating the PDF.')
      return
    }
    setGeneratingPdf(true)
    try {
      await downloadRelievingLetterPdf(form, {
        signatureFile,
        rememberSignature: rememberSignature && Boolean(signatureFile),
      })
      notifyEmployeeRegistryUpdated()
      const emps = await listAdminEmployees(DEFAULT_UPLOAD_COMPANY)
      setEmployees(emps.filter((e) => e.effectiveStatus === 'active'))
      if (rememberSignature && signatureFile) {
        setMeta((m) => (m ? { ...m, hasSavedSignature: true } : m))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate PDF')
    } finally {
      setGeneratingPdf(false)
    }
  }

  function onSignatureFileChange(file: File | null) {
    setSignatureFile(file)
    setSignaturePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return file ? URL.createObjectURL(file) : null
    })
  }

  async function onSaveSignatureOnly() {
    if (!signatureFile) {
      setError('Choose a signature image first.')
      return
    }
    setError(null)
    try {
      await saveRelievingSignature(signatureFile)
      setMeta((m) => (m ? { ...m, hasSavedSignature: true } : m))
    } catch (e) {
      setError(errorMessage(e, 'Could not save signature'))
    }
  }

  if (!allowed) return <Navigate to="/" replace />

  return (
    <AppShell active="relievingLetter">
      <main className="app-page">
        <header className="page-header">
          <p className="page-kicker">People</p>
          <h1 className="page-title">Experience &amp; relieving letter</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--color-warm-text)]">
            Uses your company Word template (letterhead included). Fill employee details, upload an
            authorised signatory image, then download a PDF to share with the employee.
          </p>
        </header>

        <div className="page-body max-w-2xl">
          {loading ? (
            <p className="text-sm text-[var(--color-warm-text)]">Loading…</p>
          ) : (
            <>
              {meta && !meta.pdfConversionAvailable ? (
                <p className="alert-error mb-4 text-sm leading-relaxed">
                  PDF for employees needs LibreOffice on the server (`soffice`). Install LibreOffice,
                  restart backend, then use Download PDF. Word download still works.
                </p>
              ) : null}
              {meta?.hasSavedSignature && !signatureFile ? (
                <p className="mb-4 text-sm text-[var(--color-warm-text)]">
                  A saved signature is on file - upload a new file to replace it, or generate PDF as-is.
                </p>
              ) : null}
              {meta && !meta.templateAvailable ? (
                <p className="alert-error mb-4">
                  Letter template is missing on the server. Contact your administrator.
                </p>
              ) : null}
              {error ? <p className="alert-error mb-4">{error}</p> : null}

              <div className="card border space-y-4 p-5 sm:p-6">
                <label className="block text-sm">
                  <span className="font-medium text-[var(--color-ink)]">Employee</span>
                  <select
                    className="field mt-1.5 w-full"
                    value={selectedEmployeeId === '' ? '' : String(selectedEmployeeId)}
                    onChange={(e) => {
                      const v = e.target.value
                      onSelectEmployee(v === '' ? '' : Number.parseInt(v, 10))
                    }}
                  >
                    <option value="">Select from people directory…</option>
                    {sortedEmployees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.employeeCode} - {emp.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="font-medium text-[var(--color-ink)]">Letter date</span>
                    <input
                      className="field mt-1.5 w-full"
                      placeholder={DOJ_INPUT_PLACEHOLDER}
                      value={form.letterDate}
                      onChange={(e) => setForm({ ...form, letterDate: e.target.value })}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium text-[var(--color-ink)]">Employee code</span>
                    <input
                      className="field mt-1.5 w-full font-mono"
                      value={form.employeeCode}
                      onChange={(e) => setForm({ ...form, employeeCode: e.target.value })}
                    />
                  </label>
                  <label className="block text-sm sm:col-span-2">
                    <span className="font-medium text-[var(--color-ink)]">Employee name</span>
                    <input
                      className="field mt-1.5 w-full"
                      value={form.employeeName}
                      onChange={(e) => setForm({ ...form, employeeName: e.target.value })}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium text-[var(--color-ink)]">Gender</span>
                    <input
                      className="field mt-1.5 w-full"
                      placeholder="e.g. female / male"
                      value={form.gender}
                      onChange={(e) => setForm({ ...form, gender: e.target.value })}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium text-[var(--color-ink)]">Designation</span>
                    <input
                      className="field mt-1.5 w-full"
                      value={form.designation}
                      onChange={(e) => setForm({ ...form, designation: e.target.value })}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium text-[var(--color-ink)]">Date of joining</span>
                    <input
                      className="field mt-1.5 w-full"
                      placeholder={DOJ_INPUT_PLACEHOLDER}
                      value={form.dateOfJoining}
                      onChange={(e) => setForm({ ...form, dateOfJoining: e.target.value })}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium text-[var(--color-ink)]">Date of leaving</span>
                    <input
                      className="field mt-1.5 w-full"
                      placeholder={DOJ_INPUT_PLACEHOLDER}
                      value={form.dateOfLeaving}
                      onChange={(e) => setForm({ ...form, dateOfLeaving: e.target.value })}
                    />
                  </label>
                </div>

                <div className="border-t border-[var(--color-warm-muted)] pt-4">
                  <p className="text-sm font-medium text-[var(--color-ink)]">Digital signature</p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--color-warm-text)]">
                    {meta?.signatureHint ?? 'PNG or JPEG'} - placed above “Authorised signatory” on the PDF.
                  </p>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg"
                    className="field mt-2 w-full text-sm"
                    onChange={(e) => onSignatureFileChange(e.target.files?.[0] ?? null)}
                  />
                  {signaturePreview ? (
                    <img
                      src={signaturePreview}
                      alt="Signature preview"
                      className="mt-3 max-h-20 max-w-[240px] object-contain"
                    />
                  ) : null}
                  <label className="mt-3 flex items-center gap-2 text-sm text-[var(--color-warm-text)]">
                    <input
                      type="checkbox"
                      checked={rememberSignature}
                      onChange={(e) => setRememberSignature(e.target.checked)}
                    />
                    Remember signature on this account
                  </label>
                  {signatureFile ? (
                    <button
                      type="button"
                      className="btn-ghost mt-2 text-sm"
                      onClick={() => void onSaveSignatureOnly()}
                    >
                      Save signature only
                    </button>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-3 pt-2">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={
                      generatingPdf ||
                      !meta?.templateAvailable ||
                      !meta?.pdfConversionAvailable
                    }
                    onClick={() => void onGeneratePdf()}
                  >
                    {generatingPdf ? 'Building PDF…' : 'Download PDF for employee'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={generating || !meta?.templateAvailable}
                    onClick={() => void onGenerateWord()}
                  >
                    {generating ? 'Generating…' : 'Download Word only'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </AppShell>
  )
}
