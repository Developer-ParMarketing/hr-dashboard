import { client } from './client'
import type { AxiosResponse } from 'axios'

export type RelievingLetterForm = {
  letterDate: string
  employeeName: string
  employeeCode: string
  gender: string
  designation: string
  dateOfJoining: string
  dateOfLeaving: string
}

export type RelievingLetterMeta = {
  templateFile: string
  templateAvailable: boolean
  pdfConversionAvailable: boolean
  hasSavedSignature: boolean
  signatureHint?: string
  fields: Array<{ key: string; label: string; hint?: string }>
  placeholders: string[]
}

export async function fetchRelievingLetterMeta(): Promise<RelievingLetterMeta> {
  const { data } = await client.get<RelievingLetterMeta>('/api/relieving-letters/meta')
  return data
}

async function downloadBlobResponse(response: AxiosResponse<Blob>, fallbackName: string) {
  const blob = response.data as Blob
  const disposition = response.headers['content-disposition'] as string | undefined
  let filename = fallbackName
  const match = disposition?.match(/filename="([^"]+)"/)
  if (match?.[1]) filename = match[1]
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

async function parseBlobError(e: unknown, fallback: string): Promise<string> {
  if (typeof e === 'object' && e != null && 'response' in e) {
    const res = (e as { response?: { data?: unknown } }).response
    const data = res?.data
    if (data instanceof Blob) {
      try {
        const text = await data.text()
        const parsed = JSON.parse(text) as { message?: string }
        if (parsed.message) return parsed.message
      } catch {
        /* ignore */
      }
    }
    if (data && typeof data === 'object' && 'message' in data) {
      return String((data as { message: unknown }).message)
    }
  }
  return e instanceof Error ? e.message : fallback
}

export async function downloadRelievingLetter(form: RelievingLetterForm): Promise<void> {
  const response = await client.post('/api/relieving-letters/generate', form, {
    responseType: 'blob',
  })
  await downloadBlobResponse(response, 'experience-relieving-letter.docx')
}

export async function downloadRelievingLetterPdf(
  form: RelievingLetterForm,
  opts: { signatureFile?: File | null; rememberSignature?: boolean },
): Promise<void> {
  const fd = new FormData()
  for (const [key, value] of Object.entries(form)) {
    fd.append(key, value)
  }
  if (opts.rememberSignature) {
    fd.append('rememberSignature', 'true')
  }
  if (opts.signatureFile) {
    fd.append('signature', opts.signatureFile)
  }
  try {
    const response = await client.post('/api/relieving-letters/generate-pdf', fd, {
      responseType: 'blob',
    })
    await downloadBlobResponse(response, 'experience-relieving-letter.pdf')
  } catch (e) {
    throw new Error(await parseBlobError(e, 'Could not generate PDF'))
  }
}

export async function saveRelievingSignature(signatureFile: File): Promise<void> {
  const fd = new FormData()
  fd.append('signature', signatureFile)
  await client.post('/api/relieving-letters/signature', fd)
}
