import { client, getStoredToken } from './client'

export type OfferLetterRow = {
  email: string
  dateOfJoining: string
  name: string
  companyName: string
  position: string
  salary: string
  salutation?: string
  department?: string
  reportingTo?: string
  employmentType?: string
  probationPeriod?: string
  workingHours?: string
  workingDays?: string
  acceptByDate?: string
  offerValidUntil?: string
  photoCount?: string
  signatoryName?: string
  signatoryDesignation?: string
}

export type OfferLetterMeta = {
  columns: Array<{ key: string; label: string }>
  defaultSubject: string
  defaultBody: string
  ccRecipients: string[]
  joiningFormsAttachment: string
  joiningFormsAvailable: boolean
  smtpConfigured: boolean
  placeholders: string[]
}

export type EmailDraft = {
  to: string
  cc: string[]
  subject: string
  body: string
}

export async function fetchOfferLetterMeta(): Promise<OfferLetterMeta> {
  const { data } = await client.get<OfferLetterMeta>('/api/offer-letters/meta')
  return data
}

export async function parseOfferLetterExcel(file: File): Promise<OfferLetterRow[]> {
  const form = new FormData()
  form.append('file', file)
  const token = getStoredToken()
  const { data } = await client.post<{ candidates: OfferLetterRow[] }>(
    '/api/offer-letters/parse-excel',
    form,
    {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'multipart/form-data',
      },
    },
  )
  return data.candidates
}

export async function previewOfferEmail(input: {
  candidate: OfferLetterRow
  subject: string
  body: string
}): Promise<EmailDraft> {
  const { data } = await client.post<{ draft: EmailDraft }>('/api/offer-letters/preview-email', input)
  return data.draft
}

export async function previewOfferPdf(candidate: OfferLetterRow): Promise<{ pdfBase64: string; filename: string }> {
  const { data } = await client.post<{ pdfBase64: string; filename: string }>(
    '/api/offer-letters/preview-pdf',
    { candidate },
  )
  return data
}

export async function sendOfferLetters(input: {
  candidates: OfferLetterRow[]
  subject: string
  body: string
}): Promise<{
  sent: number
  skipped: number
  results: Array<{ email: string; name: string; ok: boolean; message: string }>
}> {
  const { data } = await client.post('/api/offer-letters/send', input)
  return data
}

export function emptyOfferRow(): OfferLetterRow {
  return {
    email: '',
    dateOfJoining: '',
    name: '',
    companyName: 'Par Marketing Pvt. Ltd.',
    position: '',
    salary: '',
    salutation: '',
    department: '',
    reportingTo: '',
  }
}
