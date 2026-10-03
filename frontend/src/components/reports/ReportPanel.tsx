import type { ReportColumn, ReportData, ReportStat, ReportTableSection } from '../../types/reports'
import { isReportStatusColumn, reportStatusBadgeClass } from '../../utils/reportUi'
import { ReportTableShell } from '../ReportTableShell'

type ReportPanelProps = {
  report: ReportData
}

function formatCell(value: string | number | null | undefined): string {
  if (value == null || value === '') return '-'
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : value.toFixed(2)
  }
  return String(value)
}

function ReportSummary({ stats }: { stats: ReportStat[] }) {
  const numeric = stats.filter((stat) => typeof stat.value === 'number')
  const textOnly = stats.filter((stat) => typeof stat.value !== 'number')
  if (numeric.length === 0 && textOnly.length === 0) return null

  return (
    <div className="report-summary" aria-label="Report summary">
      {numeric.map((stat) => (
        <div key={stat.label} className="report-summary-item">
          <span className="report-summary-value">{stat.value}</span>
          <span className="report-summary-label">{stat.label}</span>
        </div>
      ))}
      {textOnly.map((stat) => (
        <p key={stat.label} className="report-summary-note">
          {stat.label}: {stat.value}
        </p>
      ))}
    </div>
  )
}

function ReportCell({ column, value }: { column: ReportColumn; value: string | number | null | undefined }) {
  const text = formatCell(value)
  if (isReportStatusColumn(column.key) && text !== '-') {
    return <span className={reportStatusBadgeClass(text)}>{text}</span>
  }
  if (column.key === 'employee' && typeof value === 'string' && value.includes('\n')) {
    const [name, code] = value.split('\n')
    return (
      <>
        <span className="font-medium text-[var(--color-ink)]">{name}</span>
        <span className="block text-xs text-[var(--color-warm-text)]">{code}</span>
      </>
    )
  }
  if (column.key === 'reason' || column.key === 'decidedBy') {
    return <span className="report-cell-wrap inline-block max-w-[16rem]">{text}</span>
  }
  return text
}

function ReportTable({
  columns,
  rows,
  sectionKey,
  scrollable,
}: {
  columns: ReportColumn[]
  rows: ReportTableSection['rows']
  sectionKey: string
  scrollable?: boolean
}) {
  if (rows.length === 0) return null

  const table = (
    <table className="report-table">
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              className={column.align === 'right' ? 'report-cell-right' : undefined}
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${sectionKey}-${index}`}>
            {columns.map((column) => (
              <td
                key={column.key}
                className={column.align === 'right' ? 'report-cell-right' : undefined}
              >
                <ReportCell column={column} value={row[column.key]} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )

  if (scrollable) {
    return (
      <div className="workspace-table-scroll report-table-scroll">
        <ReportTableShell className="report-table-wrap--flat p-0">{table}</ReportTableShell>
      </div>
    )
  }

  return (
    <ReportTableShell className="report-table-wrap--flat p-0">{table}</ReportTableShell>
  )
}

function ReportSectionBlock({
  section,
  index,
  scrollable,
}: {
  section: ReportTableSection
  index: number
  scrollable?: boolean
}) {
  const sectionKey = `section-${index}`

  return (
    <div className="report-block">
      <div className="report-block-head">
        <h3 className="report-block-title">{section.title}</h3>
      </div>
      {section.rows.length === 0 ? (
        <p className="report-block-empty">{section.emptyMessage ?? 'No rows for this section.'}</p>
      ) : (
        <ReportTable
          columns={section.columns}
          rows={section.rows}
          sectionKey={sectionKey}
          scrollable={scrollable}
        />
      )}
    </div>
  )
}

export function ReportPanel({ report }: ReportPanelProps) {
  const sections = report.sections?.length ? report.sections : null

  return (
    <div className="report-panel">
      {report.stats && report.stats.length > 0 ? <ReportSummary stats={report.stats} /> : null}

      {sections ? (
        <div className="report-blocks">
          {sections.map((section, index) => (
            <ReportSectionBlock
              key={`${section.title}-${index}`}
              section={section}
              index={index}
              scrollable={index === 0 && section.rows.length > 8}
            />
          ))}
        </div>
      ) : report.rows.length === 0 ? (
        <p className="report-block-empty">{report.emptyMessage ?? 'No data for this report.'}</p>
      ) : (
        <ReportTable
          columns={report.columns}
          rows={report.rows}
          sectionKey={report.type}
          scrollable={report.rows.length > 12}
        />
      )}
    </div>
  )
}
