import { client } from './client'

export type DocumentTypeSpec = {
  id: string
  label: string
  section: string
  sectionLabel: string
  maxFiles: number
  minFiles: number
  oneOfGroup?: string
  slotLabels?: string[]
  helpText?: string
}

export type EmployeeDocumentUpload = {
  id: number
  documentType: string
  slot: number
  fileName: string
  mimeType: string
  fileSize: number
  uploadedAt: string
}

export type PreviousEmployerDetail = {
  id: number
  sortOrder: number
  companyName: string
  dateOfJoining: string | null
  dateOfLeaving: string | null
  position: string | null
  location: string | null
  reasonForLeaving: string | null
  referenceContactName: string | null
  referenceContactInfo: string | null
  updatedAt: string
}

export type PreviousEmployerInput = {
  companyName: string
  dateOfJoining?: string | null
  dateOfLeaving?: string | null
  position?: string | null
  location?: string | null
  reasonForLeaving?: string | null
  referenceContactName?: string | null
  referenceContactInfo?: string | null
}

export type DocumentCompletion = {
  complete: boolean
  uploadedCount: number
  requiredCount: number
  missingLabels: string[]
}

export type EmployeeDocumentsMeta = {
  specs: DocumentTypeSpec[]
  sectionLabels: Record<string, string>
  canUpload: boolean
  canViewAll: boolean
  maxFileBytes: number
  allowedMime: string[]
}

export type MyDocumentsResponse = {
  employeeId: number
  uploads: EmployeeDocumentUpload[]
  previousEmployers: PreviousEmployerDetail[]
  completion: DocumentCompletion
  specs: DocumentTypeSpec[]
  sectionLabels: Record<string, string>
  canUpload: boolean
}

export type EmployeeDocumentListItem = {
  employeeId: number
  employeeCode: string
  name: string
  email: string | null
  uploadCount: number
  complete: boolean
  missingLabels: string[]
}

export type AdminEmployeeDocumentsResponse = {
  employee: {
    id: number
    employeeCode: string
    name: string
    email: string | null
  }
  uploads: EmployeeDocumentUpload[]
  previousEmployers: PreviousEmployerDetail[]
  completion: DocumentCompletion
  specs: DocumentTypeSpec[]
  sectionLabels: Record<string, string>
}

export async function fetchEmployeeDocumentsMeta(): Promise<EmployeeDocumentsMeta> {
  const { data } = await client.get<EmployeeDocumentsMeta>('/api/employee-documents/meta')
  return data
}

export async function fetchMyEmployeeDocuments(): Promise<MyDocumentsResponse> {
  const { data } = await client.get<MyDocumentsResponse>('/api/employee-documents/mine')
  return data
}

export async function fetchEmployeesDocumentStatus(): Promise<EmployeeDocumentListItem[]> {
  const { data } = await client.get<{ employees: EmployeeDocumentListItem[] }>(
    '/api/employee-documents/admin/employees',
  )
  return data.employees
}

export async function fetchEmployeeDocumentsForAdmin(
  employeeId: number,
): Promise<AdminEmployeeDocumentsResponse> {
  const { data } = await client.get<AdminEmployeeDocumentsResponse>(
    `/api/employee-documents/admin/employees/${employeeId}`,
  )
  return data
}

export async function uploadEmployeeDocument(
  documentType: string,
  slot: number,
  file: File,
): Promise<{ uploadId: number; uploads: EmployeeDocumentUpload[]; completion: DocumentCompletion }> {
  const form = new FormData()
  form.append('file', file)
  form.append('documentType', documentType)
  form.append('slot', String(slot))
  const { data } = await client.post('/api/employee-documents/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function deleteEmployeeDocument(id: number): Promise<void> {
  await client.delete(`/api/employee-documents/${id}`)
}

export async function savePreviousEmployers(
  employers: PreviousEmployerInput[],
): Promise<PreviousEmployerDetail[]> {
  const { data } = await client.put<{ previousEmployers: PreviousEmployerDetail[] }>(
    '/api/employee-documents/previous-employers',
    { employers },
  )
  return data.previousEmployers
}

/** Opens file in a new tab (auth via session cookie + Bearer from same origin proxy). */
export function openEmployeeDocumentFile(id: number, inline = true): void {
  const q = inline ? '?inline=1' : ''
  window.open(`/api/employee-documents/file/${id}${q}`, '_blank', 'noopener,noreferrer')
}

export function downloadEmployeeDocumentFile(id: number): void {
  window.open(`/api/employee-documents/file/${id}`, '_blank', 'noopener,noreferrer')
}

export function specLabel(specs: DocumentTypeSpec[], documentType: string, slot: number): string {
  const spec = specs.find((s) => s.id === documentType)
  if (!spec) return documentType
  if (spec.slotLabels?.[slot]) return spec.slotLabels[slot]
  if (documentType === 'education' && slot >= 2) {
    return `Additional certificate ${slot - 1}`
  }
  if (spec.maxFiles > 1) return `${spec.label} (${slot + 1})`
  return spec.label
}

export function educationSlotLabel(spec: DocumentTypeSpec, slot: number): string {
  if (spec.slotLabels?.[slot]) return spec.slotLabels[slot]
  if (spec.id === 'education' && slot >= 2) return `Additional certificate ${slot - 1}`
  if (spec.maxFiles > 1) return `File ${slot + 1}`
  return 'Upload'
}

export function educationSlotsForUpload(
  spec: DocumentTypeSpec,
  uploads: EmployeeDocumentUpload[],
  optionalRowsRequested: number,
): number[] {
  const slots: number[] = [0, 1]
  const existing = uploads.filter((u) => u.documentType === spec.id).map((u) => u.slot)
  const optional = new Set<number>()
  for (const s of existing) {
    if (s >= 2) optional.add(s)
  }
  for (let i = 0; i < optionalRowsRequested; i += 1) {
    const slot = 2 + i
    if (slot < spec.maxFiles) optional.add(slot)
  }
  for (const s of [...optional].sort((a, b) => a - b)) {
    slots.push(s)
  }
  return slots
}

export function educationHasRequiredUploads(
  uploads: EmployeeDocumentUpload[],
  documentType: string,
): boolean {
  return (
    Boolean(uploadForSlot(uploads, documentType, 0)) &&
    Boolean(uploadForSlot(uploads, documentType, 1))
  )
}

export function educationCanAddMore(
  spec: DocumentTypeSpec,
  uploads: EmployeeDocumentUpload[],
  optionalRowsRequested: number,
): boolean {
  if (spec.id !== 'education') return false
  if (!educationHasRequiredUploads(uploads, spec.id)) return false
  const slots = educationSlotsForUpload(spec, uploads, optionalRowsRequested)
  if (slots.length >= spec.maxFiles) return false
  const openOptional = slots.filter((s) => s >= 2).some((s) => !uploadForSlot(uploads, spec.id, s))
  return !openOptional
}

function uploadForSlot(
  uploads: EmployeeDocumentUpload[],
  documentType: string,
  slot: number,
): EmployeeDocumentUpload | undefined {
  return uploads.find((u) => u.documentType === documentType && u.slot === slot)
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
