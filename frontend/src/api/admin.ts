import type { AuthUser } from './auth'
import { client } from './client'

export type AdminUserRecord = AuthUser & {
  createdAt: string
  updatedAt: string
}

export type SalaryWorkbookInfo = {
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

export async function listAdminUsers(): Promise<AdminUserRecord[]> {
  const { data } = await client.get<{ users: AdminUserRecord[] }>('/api/admin/users')
  return data.users
}

export async function createAdminUser(input: {
  email: string
  name: string
  password?: string
  role: string
}): Promise<AuthUser> {
  const { data } = await client.post<{ user: AuthUser }>('/api/admin/users', input)
  return data.user
}

export async function updateAdminUser(
  id: number,
  input: { email?: string; name?: string; role?: string; password?: string },
): Promise<AuthUser> {
  const { data } = await client.patch<{ user: AuthUser }>(`/api/admin/users/${id}`, input)
  return data.user
}

export async function deleteAdminUser(id: number): Promise<void> {
  await client.delete(`/api/admin/users/${id}`)
}

export async function loadAdminSalaryWorkbook(
  year: number,
  month: number,
  company: string,
): Promise<SalaryWorkbookInfo | null> {
  const params = new URLSearchParams({
    year: String(year),
    month: String(month),
    company,
  })
  const { data } = await client.get<{ workbook: SalaryWorkbookInfo | null }>(
    `/api/admin/salary-workbook?${params}`,
  )
  return data.workbook
}

export async function uploadAdminSalaryWorkbook(
  file: File,
  year: number,
  month: number,
  company: string,
): Promise<SalaryWorkbookInfo> {
  const form = new FormData()
  form.append('file', file)
  form.append('year', String(year))
  form.append('month', String(month))
  form.append('company', company)
  form.append('companyName', company)
  const { data } = await client.post<{ workbook: SalaryWorkbookInfo }>(
    '/api/admin/salary-workbook',
    form,
  )
  return data.workbook
}

export async function removeAdminSalaryWorkbook(
  year: number,
  month: number,
  company: string,
): Promise<void> {
  const params = new URLSearchParams({
    year: String(year),
    month: String(month),
    company,
  })
  await client.delete(`/api/admin/salary-workbook?${params}`)
}

export async function downloadAdminSalaryWorkbookHistory(id: number): Promise<void> {
  const response = await client.get(`/api/admin/salary-workbook/history/${id}/file`, {
    responseType: 'blob',
  })
  const disposition = response.headers['content-disposition'] as string | undefined
  const match = disposition?.match(/filename="([^"]+)"/)
  const fileName = match?.[1] ?? `salary-upload-${id}.xlsx`
  const url = URL.createObjectURL(response.data as Blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

export type ManagerRecord = AuthUser & { assignedCount: number }

export type AssignableEmployee = {
  id: number
  employeeCode: string
  name: string
  company: string | null
  teamId: number | null
  teamName: string | null
}

export async function listManagers(): Promise<ManagerRecord[]> {
  const { data } = await client.get<{ managers: ManagerRecord[] }>('/api/admin/managers')
  return data.managers
}

export async function listEmployeesForAssignment(company?: string): Promise<AssignableEmployee[]> {
  const params = company ? `?company=${encodeURIComponent(company)}` : ''
  const { data } = await client.get<{ employees: AssignableEmployee[] }>(
    `/api/admin/employees-for-assignment${params}`,
  )
  return data.employees
}

export async function loadManagerAssignments(managerId: number): Promise<{
  manager: AuthUser
  employees: AssignableEmployee[]
  employeeIds: number[]
}> {
  const { data } = await client.get(`/api/admin/managers/${managerId}/assignments`)
  return data
}

export async function saveManagerAssignments(
  managerId: number,
  employeeIds: number[],
): Promise<{ assignedCount: number }> {
  const { data } = await client.put<{ assignedCount: number }>(
    `/api/admin/managers/${managerId}/assignments`,
    { employeeIds },
  )
  return data
}

export type AdminEmployeeSalaryBase = {
  inHand: number
  pfEmployee: number
  esiEmployee: number
  pt: number
  gratuity: number
  employerPf: number
  employerPfArr: number
  employerEsi: number
  incrementPercent?: number | null
}

export type AdminEmployeeDetail = {
  id: number
  employeeCode: string
  name: string
  email: string | null
  company: string | null
  department: string | null
  gender: string | null
  dateOfJoining: string | null
  dateOfLeaving: string | null
  effectiveStatus: 'active' | 'inactive'
  teamId: number | null
  teamName: string | null
  teamSortOrder: number
  teamManagerName: string | null
  shiftStart: string | null
  status: string
  salaryBase: AdminEmployeeSalaryBase | null
  updatedAt: string
  inPeriodRegister?: boolean
}

export type SimilarWorkEmailMatch = {
  employeeId: number
  employeeCode: string
  name: string
  email: string
  kind: 'duplicate' | 'similar'
  score: number
}

export async function checkAdminWorkEmailSimilarity(
  email: string,
  excludeEmployeeId?: number | null,
): Promise<SimilarWorkEmailMatch[]> {
  const q = new URLSearchParams({ email: email.trim().toLowerCase() })
  if (excludeEmployeeId != null) q.set('excludeEmployeeId', String(excludeEmployeeId))
  const { data } = await client.get<{ matches: SimilarWorkEmailMatch[] }>(
    `/api/admin/employees/check-work-email?${q.toString()}`,
  )
  return data.matches ?? []
}

export async function listAdminEmployees(
  company: string,
  options?: { registerYear?: number; registerMonth?: number },
): Promise<AdminEmployeeDetail[]> {
  const q = new URLSearchParams()
  if (company) q.set('company', company)
  if (options?.registerYear != null) q.set('registerYear', String(options.registerYear))
  if (options?.registerMonth != null) q.set('registerMonth', String(options.registerMonth))
  const params = q.toString() ? `?${q.toString()}` : ''
  const { data } = await client.get<{ employees: AdminEmployeeDetail[] }>(
    `/api/admin/employees${params}`,
  )
  return data.employees
}

export async function createAdminEmployee(input: {
  employeeCode: string
  name: string
  email: string
  company: string
  department?: string
  gender?: string | null
  dateOfJoining?: string | null
  dateOfLeaving?: string | null
  teamId?: number | null
  shiftStart?: string
  status?: string
  salaryBase: AdminEmployeeSalaryBase
}): Promise<AdminEmployeeDetail> {
  const { data } = await client.post<{ employee: AdminEmployeeDetail }>('/api/admin/employees', input)
  return data.employee
}

export async function updateAdminEmployee(
  id: number,
  input: Partial<{
    employeeCode: string
    name: string
    email?: string
    company: string
    department: string | null
    gender: string | null
    dateOfJoining: string | null
    dateOfLeaving: string | null
    teamId: number | null
    shiftStart: string | null
    status: string
    salaryBase: AdminEmployeeSalaryBase | null
  }>,
): Promise<AdminEmployeeDetail> {
  const { data } = await client.patch<{ employee: AdminEmployeeDetail }>(
    `/api/admin/employees/${id}`,
    input,
  )
  return data.employee
}
