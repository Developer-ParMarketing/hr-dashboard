import type { ReportData } from '../types/reports'
import { downloadMatrixAsXlsx } from './downloadMatrixXlsx'

function formatExportCell(value: string | number | null | undefined): string {
  if (value == null || value === '') return ''
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : value.toFixed(2)
  }
  return String(value)
}

function matrixFromTable(
  columns: ReportData['columns'],
  rows: ReportData['rows'],
): { headers: string[]; rows: string[][] } {
  const headers = columns.map((column) => column.label)
  const body = rows.map((row) =>
    columns.map((column) => formatExportCell(row[column.key])),
  )
  return { headers, rows: body }
}

export function buildReportExportMatrix(report: ReportData): {
  headers: string[]
  rows: string[][]
} {
  if (report.sections && report.sections.length > 0) {
    const rows: string[][] = []
    for (const section of report.sections) {
      if (rows.length > 0) {
        rows.push([])
      }
      rows.push([section.title])
      const table = matrixFromTable(section.columns, section.rows)
      if (section.rows.length === 0) {
        rows.push([section.emptyMessage ?? 'No data'])
        continue
      }
      rows.push(table.headers)
      rows.push(...table.rows)
    }
    return { headers: ['Report'], rows }
  }

  return matrixFromTable(report.columns, report.rows)
}

function reportFileBaseName(report: ReportData): string {
  const month = String(report.period.month).padStart(2, '0')
  return `${report.type}-report-${report.period.year}-${month}`
}

export function downloadReportExcel(report: ReportData): void {
  const { headers, rows } = buildReportExportMatrix(report)
  downloadMatrixAsXlsx(
    `${reportFileBaseName(report)}.xlsx`,
    report.title.slice(0, 31) || 'Report',
    headers,
    rows,
  )
}
