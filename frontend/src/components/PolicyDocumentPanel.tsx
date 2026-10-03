import { useState } from 'react'
import type { PolicyDocument } from '../constants/policies'
import { downloadPolicyPdf } from '../utils/policyPdf'

type Props = {
  document: PolicyDocument
}

export function PolicyDocumentPanel({ document }: Props) {
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  async function onDownload() {
    setDownloadError(null)
    setDownloading(true)
    try {
      await downloadPolicyPdf(document)
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="policy-document">
      <p className="policy-document-intro">{document.intro}</p>

      <div className="policies-grid">
        {document.sections.map((section, index) => (
          <article key={section.id} className="policy-card card border">
            <div className="policy-card-head">
              <span className="policy-index">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <h2 className="policy-title">{section.title}</h2>
                <p className="policy-summary">{section.summary}</p>
              </div>
            </div>
            <ul className="policy-rules">
              {section.rules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
            {section.note ? <p className="policy-note">{section.note}</p> : null}
          </article>
        ))}
      </div>

      {document.footnote ? (
        <aside className="policy-footnote card border">
          <p className="policy-footnote-title">{document.footnote.title}</p>
          <p className="policy-footnote-text">{document.footnote.text}</p>
        </aside>
      ) : null}

      <aside className="policy-download card border">
        <div className="policy-download-body">
          <div className="policy-download-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
              <path
                d="M12 3v10m0 0 4-4m-4 4-4-4M5 15v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="policy-download-copy">
            <p className="policy-download-title">PDF copy</p>
            <p className="policy-download-text">
              {document.staticPdfPath
                ? `Download the official ${document.title.toLowerCase()} PDF (${document.pdfFileName}).`
                : `Download the full ${document.title.toLowerCase()} for offline reading or sharing.`}
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary policy-download-btn shrink-0 text-xs"
            disabled={downloading}
            onClick={() => void onDownload()}
          >
            {downloading ? 'Downloading…' : 'Download PDF'}
          </button>
        </div>
        {downloadError ? (
          <p className="mt-2 text-sm text-red-700" role="alert">
            {downloadError}
          </p>
        ) : null}
      </aside>
    </div>
  )
}
