import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { getFeatureModuleContent } from '../constants/featureModules'
import { getModuleById } from '../modules/registry'
import type { ModuleId } from '../modules/types'

type FeatureModulePageProps = {
  moduleId: ModuleId
}

function RequestFormShell({ kind }: { kind: 'leave' | 'in-out' | 'reimbursement' }) {
  if (kind === 'leave') {
    return (
      <form className="feature-form card border" onSubmit={(e) => e.preventDefault()}>
        <div className="feature-form-grid">
          <label className="feature-field">
            <span>Leave type</span>
            <select disabled defaultValue="pl">
              <option value="pl">Personal Leave (PL)</option>
              <option value="sl">Sick Leave (SL)</option>
              <option value="cl">Casual Leave (CL)</option>
            </select>
          </label>
          <label className="feature-field">
            <span>From</span>
            <input type="date" disabled />
          </label>
          <label className="feature-field">
            <span>To</span>
            <input type="date" disabled />
          </label>
        </div>
        <label className="feature-field">
          <span>Reason</span>
          <textarea rows={3} disabled placeholder="Brief reason for leave" />
        </label>
        <p className="feature-form-note">Submit requests through HR once the workflow is enabled.</p>
        <button type="button" className="btn-ghost" disabled>
          Submit request
        </button>
      </form>
    )
  }

  if (kind === 'in-out') {
    return (
      <form className="feature-form card border" onSubmit={(e) => e.preventDefault()}>
        <div className="feature-form-grid">
          <label className="feature-field">
            <span>Date</span>
            <input type="date" disabled />
          </label>
          <label className="feature-field">
            <span>Correction type</span>
            <select disabled defaultValue="in">
              <option value="in">Missed IN</option>
              <option value="out">Missed OUT</option>
              <option value="both">Both IN and OUT</option>
            </select>
          </label>
          <label className="feature-field">
            <span>Actual time</span>
            <input type="time" disabled />
          </label>
        </div>
        <label className="feature-field">
          <span>Reason</span>
          <textarea rows={3} disabled placeholder="Why the punch was missed" />
        </label>
        <p className="feature-form-note">HR will update attendance after manager approval.</p>
        <button type="button" className="btn-ghost" disabled>
          Submit request
        </button>
      </form>
    )
  }

  return (
    <form className="feature-form card border" onSubmit={(e) => e.preventDefault()}>
      <div className="feature-form-grid">
        <label className="feature-field">
          <span>Expense date</span>
          <input type="date" disabled />
        </label>
        <label className="feature-field">
          <span>Category</span>
          <select disabled defaultValue="travel">
            <option value="travel">Travel</option>
            <option value="client">Client visit</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="feature-field">
          <span>Amount (₹)</span>
          <input type="number" disabled placeholder="0" />
        </label>
      </div>
      <label className="feature-field">
        <span>Description</span>
        <textarea rows={3} disabled placeholder="Expense details" />
      </label>
      <p className="feature-form-note">Attach bills when submitting to finance.</p>
      <button type="button" className="btn-ghost" disabled>
        Submit claim
      </button>
    </form>
  )
}

export function FeatureModulePage({ moduleId }: FeatureModulePageProps) {
  const content = getFeatureModuleContent(moduleId)
  const module = getModuleById(moduleId)
  const comingSoon = Boolean(module?.comingSoon)

  if (!content) return null

  return (
    <AppShell active={moduleId}>
      <main className="app-page feature-page">
        <header className="page-header">
          <p className="page-kicker">{content.kicker}</p>
          <div className="feature-title-row">
            <h1 className="page-title">{content.title}</h1>
            {comingSoon ? <span className="feature-soon-pill">Coming soon</span> : null}
          </div>
          <p className="feature-intro">{content.intro}</p>
        </header>

        {comingSoon ? (
          <aside className="feature-soon-banner card border" role="status">
            <p className="feature-soon-banner-title">This module is not live yet</p>
            <p className="feature-soon-banner-body">
              {content.comingSoonNote ??
                'Forms and downloads below are previews only. Nothing is submitted or stored until this workflow is connected to payroll data.'}
            </p>
            {content.actions && content.actions.length > 0 ? (
              <div className="feature-soon-banner-actions">
                {content.actions.map((action) => (
                  <Link key={action.href} to={action.href} className="btn-ghost">
                    {action.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </aside>
        ) : content.actions && content.actions.length > 0 ? (
          <div className="feature-actions">
            {content.actions.map((action) => (
              <Link key={action.href} to={action.href} className="btn-ghost">
                {action.label}
              </Link>
            ))}
          </div>
        ) : null}

        {!comingSoon && content.requestForm ? <RequestFormShell kind={content.requestForm} /> : null}

        <div className={`feature-sections${comingSoon ? ' feature-sections-muted' : ''}`}>
          {content.sections.map((section) => (
            <article key={section.title} className="feature-card card border">
              <h2 className="feature-card-title">{section.title}</h2>
              <ul className="feature-list">
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </main>
    </AppShell>
  )
}
