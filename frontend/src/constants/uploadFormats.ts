/**
 * Suggested file types in the system file picker (users can still choose “All files”).
 * Main register: PDF, spreadsheet, or delimited text. Leave / WFH: spreadsheet or CSV/TSV.
 */
export const DOCUMENT_UPLOAD_ACCEPT = [
  '.pdf',
  '.xlsx',
  '.xls',
  '.xlsm',
  '.csv',
  '.tsv',
  '.ods',
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet',
  'text/csv',
  'text/tab-separated-values',
  'text/plain',
].join(',')
