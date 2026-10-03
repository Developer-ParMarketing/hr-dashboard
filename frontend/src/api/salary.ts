import type {
  SalaryCalculationResponse,
  SalaryResultsResponse,
  SalarySheetInputRow,
  SalarySheetResponse,
  SalarySheetRow,
  SalaryUploadRow,
  SalaryValidationResponse,
} from '../types/salary'
import { client } from './client'

export async function loadSalarySheet(
  year: number,
  month: number,
  company: string,
): Promise<SalarySheetResponse> {
  const params = new URLSearchParams({ year: String(year), month: String(month), company })
  const { data } = await client.get<SalarySheetResponse>(`/api/salary/sheet?${params}`)
  return data
}

export async function saveSalarySheet(
  year: number,
  month: number,
  company: string,
  rows: SalarySheetInputRow[],
): Promise<SalarySheetResponse> {
  const { data } = await client.put<SalarySheetResponse>('/api/salary/sheet', {
    year,
    month,
    company,
    companyName: company,
    rows,
  })
  return data
}

export async function saveSalarySheetRow(
  year: number,
  month: number,
  company: string,
  row: SalarySheetInputRow,
): Promise<SalarySheetRow> {
  const { data } = await client.patch<SalarySheetRow>('/api/salary/sheet/row', {
    year,
    month,
    company,
    companyName: company,
    row,
  })
  return data
}

export async function previewSalarySheet(
  year: number,
  month: number,
  company: string,
  rows: SalarySheetInputRow[],
): Promise<SalarySheetResponse> {
  const { data } = await client.post<SalarySheetResponse>('/api/salary/sheet/preview', {
    year,
    month,
    company,
    companyName: company,
    rows,
  })
  return data
}

export async function validateSalaryExcel(
  file: File,
  year: number,
  month: number,
  company: string,
): Promise<SalaryValidationResponse> {
  const form = new FormData()
  form.append('file', file)
  form.append('year', String(year))
  form.append('month', String(month))
  form.append('company', company)
  form.append('companyName', company)
  const { data } = await client.post<SalaryValidationResponse>('/api/salary/validate', form)
  return data
}

export async function calculateSalary(
  input:
    | { uploadId: string; year?: never; month?: never; company?: never }
    | { uploadId?: string; year: number; month: number; company: string },
  rows?: { employeeCode: string; grossSalary: number; adjustment: number }[],
): Promise<SalaryCalculationResponse> {
  const { data } = await client.post<SalaryCalculationResponse>('/api/salary/calculate', {
    ...('year' in input && input.year != null
      ? { year: input.year, month: input.month, company: input.company }
      : { uploadId: input.uploadId }),
    rows,
  })
  return data
}

export async function loadSalaryResults(
  year: number,
  month: number,
  company?: string,
): Promise<SalaryResultsResponse> {
  const params = new URLSearchParams({ year: String(year), month: String(month) })
  if (company) params.set('company', company)
  const { data } = await client.get<SalaryResultsResponse>(`/api/salary/results?${params}`)
  return data
}

export async function importSalaryBaseExcel(
  file: File,
  company: string,
): Promise<{ message: string; matched: number; unmatched: string[]; parsed: number }> {
  const form = new FormData()
  form.append('file', file)
  form.append('company', company)
  form.append('companyName', company)
  const { data } = await client.post<{
    message: string
    matched: number
    unmatched: string[]
    parsed: number
  }>('/api/salary/base/import', form)
  return data
}

export async function downloadSalaryExcel(
  year: number,
  month: number,
  company: string,
  useResults = true,
): Promise<void> {
  const params = new URLSearchParams({
    year: String(year),
    month: String(month),
    company,
    results: useResults ? '1' : '0',
  })
  const response = await client.get(`/api/salary/export?${params}`, {
    responseType: 'blob',
  })
  const blob = response.data as Blob
  const disposition = response.headers['content-disposition'] as string | undefined
  const match = disposition?.match(/filename="([^"]+)"/)
  const fileName = match?.[1] ?? `salary-${company}-${year}-${String(month).padStart(2, '0')}.xlsx`
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

export type SalaryWorkbookResponse = {
  uploadId: string
  fileName: string
  year: number
  month: number
  company: string
  uploadedBy: string | null
  uploadedAt: string
  summary: {
    totalRows: number
    validRows: number
    matchedRows: number
    errorRows: number
    blockedByApproval: number
    canCalculate: boolean
  }
}

export async function loadSalaryWorkbook(
  year: number,
  month: number,
  company: string,
): Promise<SalaryWorkbookResponse | null> {
  const params = new URLSearchParams({
    year: String(year),
    month: String(month),
    company,
  })
  const { data } = await client.get<{ workbook: SalaryWorkbookResponse | null }>(
    `/api/salary/workbook?${params}`,
  )
  return data.workbook
}

export type SalaryWorkbookHistoryEntry = SalaryWorkbookResponse & {
  id: number
  isCurrent: boolean
}

export type SalaryWorkbookHistoryPreview = {
  entry: SalaryWorkbookHistoryEntry
  rows: SalaryUploadRow[]
}

export async function loadSalaryWorkbookHistory(
  year: number,
  month: number,
  company: string,
  limit = 20,
  offset = 0,
): Promise<{ entries: SalaryWorkbookHistoryEntry[]; total: number }> {
  const params = new URLSearchParams({
    year: String(year),
    month: String(month),
    company,
    limit: String(limit),
    offset: String(offset),
  })
  const { data } = await client.get<{ entries: SalaryWorkbookHistoryEntry[]; total: number }>(
    `/api/salary/workbook/history?${params}`,
  )
  return data
}

export async function loadSalaryWorkbookPreview(id: number): Promise<SalaryWorkbookHistoryPreview> {
  const { data } = await client.get<SalaryWorkbookHistoryPreview>(
    `/api/salary/workbook/history/${id}/preview`,
  )
  return data
}
