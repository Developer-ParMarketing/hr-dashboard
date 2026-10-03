export type ReportType =
  | 'admin'
  | 'self'
  | 'team'
  | 'leave'
  | 'in-out'
  | 'payroll'
  | 'contact'
  | 'email'

export type ReportColumn = {
  key: string
  label: string
  align?: 'left' | 'right'
}

export type ReportStat = {
  label: string
  value: string | number
}

export type ReportTableSection = {
  title: string
  columns: ReportColumn[]
  rows: Array<Record<string, string | number | null>>
  emptyMessage?: string
}

export type ReportData = {
  type: ReportType
  title: string
  period: {
    year: number
    month: number
    company: string
    label: string
  }
  columns: ReportColumn[]
  rows: Array<Record<string, string | number | null>>
  stats?: ReportStat[]
  sections?: ReportTableSection[]
  emptyMessage?: string
}
