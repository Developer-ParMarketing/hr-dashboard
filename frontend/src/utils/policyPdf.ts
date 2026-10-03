import { jsPDF } from 'jspdf'
import type { PolicyDocument } from '../constants/policies'
import { formatDisplayDate, isoFromYmd } from './displayDate'

const MARGIN = 48
const LINE = 14
const PAGE_HEIGHT = 842
const BRAND = '#c45c26'

function ensureSpace(pdf: jsPDF, y: number, needed: number): number {
  if (y + needed > PAGE_HEIGHT - MARGIN) {
    pdf.addPage()
    return MARGIN
  }
  return y
}

function wrapText(pdf: jsPDF, text: string, maxWidth: number): string[] {
  return pdf.splitTextToSize(text, maxWidth) as string[]
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = window.document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  window.document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

async function downloadStaticPolicyPdf(document: PolicyDocument): Promise<void> {
  const path = document.staticPdfPath
  if (!path) return
  const res = await fetch(path, { cache: 'no-store' })
  if (!res.ok) {
    throw new Error('Could not load the policy PDF. Contact HR if this keeps happening.')
  }
  const blob = await res.blob()
  downloadBlob(blob, document.pdfFileName)
}

function generatePolicyPdf(document: PolicyDocument): void {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const maxWidth = pageWidth - MARGIN * 2
  let y = MARGIN

  pdf.setTextColor(BRAND)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(10)
  pdf.text(document.kicker.toUpperCase(), MARGIN, y)
  y += LINE

  pdf.setTextColor('#1a1a1a')
  pdf.setFontSize(20)
  pdf.text(document.title, MARGIN, y)
  y += LINE + 4

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.setTextColor('#444444')
  const introLines = wrapText(pdf, document.intro, maxWidth)
  pdf.text(introLines, MARGIN, y)
  y += introLines.length * LINE + 8

  pdf.setDrawColor('#e8e0d8')
  pdf.line(MARGIN, y, pageWidth - MARGIN, y)
  y += LINE

  document.sections.forEach((section, index) => {
    y = ensureSpace(pdf, y, LINE * 6)

    pdf.setTextColor(BRAND)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9)
    pdf.text(String(index + 1).padStart(2, '0'), MARGIN, y)

    pdf.setTextColor('#1a1a1a')
    pdf.setFontSize(13)
    pdf.text(section.title, MARGIN + 22, y)
    y += LINE

    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(10)
    pdf.setTextColor('#555555')
    const summaryLines = wrapText(pdf, section.summary, maxWidth - 22)
    pdf.text(summaryLines, MARGIN + 22, y)
    y += summaryLines.length * LINE + 4

    pdf.setTextColor('#1a1a1a')
    pdf.setFontSize(10)
    for (const rule of section.rules) {
      const ruleLines = wrapText(pdf, `• ${rule}`, maxWidth - 28)
      y = ensureSpace(pdf, y, ruleLines.length * LINE)
      pdf.text(ruleLines, MARGIN + 22, y)
      y += ruleLines.length * LINE + 2
    }

    if (section.note) {
      y = ensureSpace(pdf, y, LINE * 2)
      pdf.setFont('helvetica', 'italic')
      pdf.setTextColor('#666666')
      const noteLines = wrapText(pdf, section.note, maxWidth - 22)
      pdf.text(noteLines, MARGIN + 22, y)
      y += noteLines.length * LINE + 2
      pdf.setFont('helvetica', 'normal')
    }

    y += 6
  })

  if (document.footnote) {
    y = ensureSpace(pdf, y, LINE * 4)
    pdf.setDrawColor('#e8e0d8')
    pdf.line(MARGIN, y, pageWidth - MARGIN, y)
    y += LINE
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(10)
    pdf.setTextColor('#1a1a1a')
    pdf.text(document.footnote.title, MARGIN, y)
    y += LINE
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor('#555555')
    const footLines = wrapText(pdf, document.footnote.text, maxWidth)
    pdf.text(footLines, MARGIN, y)
  }

  const now = new Date()
  const generated = formatDisplayDate(
    isoFromYmd(now.getFullYear(), now.getMonth() + 1, now.getDate()),
  )
  pdf.setFontSize(8)
  pdf.setTextColor('#999999')
  pdf.text(`Par HR · Generated ${generated}`, MARGIN, PAGE_HEIGHT - 28)

  pdf.save(document.pdfFileName)
}

export async function downloadPolicyPdf(document: PolicyDocument): Promise<void> {
  if (document.staticPdfPath) {
    await downloadStaticPolicyPdf(document)
    return
  }
  generatePolicyPdf(document)
}
