const ITEMS = [
  { className: 'legend-people', label: 'People' },
  { className: 'legend-attendance', label: 'Attendance' },
  { className: 'legend-payroll', label: 'Payroll' },
  { className: 'legend-actions', label: 'Actions' },
] as const

export function DashboardInsightsLegend() {
  return (
    <ul className="dashboard-insights-legend" aria-label="Metric categories">
      {ITEMS.map((item) => (
        <li key={item.label}>
          <span className={`legend-dot ${item.className}`} aria-hidden />
          {item.label}
        </li>
      ))}
    </ul>
  )
}
