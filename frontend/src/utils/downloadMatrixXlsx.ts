import * as XLSX from 'xlsx'

/** One sheet from header row + string data rows; writes `filename` (.xlsx added if missing). */
export function downloadMatrixAsXlsx(
  filename: string,
  sheetName: string,
  headers: string[],
  dataRows: string[][],
): void {
  const aoa: string[][] = [headers, ...dataRows.map((r) => r.map((c) => String(c)))]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  const safeSheet = sheetName.replace(/[*?:/\\[\]]/g, '_').slice(0, 31) || 'Export'
  XLSX.utils.book_append_sheet(wb, ws, safeSheet)
  const out = filename.toLowerCase().endsWith('.xlsx') ? filename : `${filename}.xlsx`
  XLSX.writeFile(wb, out)
}
