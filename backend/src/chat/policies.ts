/**
 * Policy lookup for the HR chatbot.
 * Reads the SAME policies HR edits on the Policies page (database table policy_sections),
 * so a new or changed policy is answered right away - no second copy to keep in sync.
 */
import { listPolicyDocuments } from "../policies/store.js";
import type { PolicyDocument, PolicySection } from "../policies/defaults.js";

let cache: { at: number; docs: PolicyDocument[] } | null = null;
const CACHE_MS = 60_000;

/** Called after HR saves a change, so the chatbot sees it immediately. */
export function invalidatePolicyCache(): void {
    cache = null;
}

async function loadPolicies(): Promise<PolicyDocument[]> {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.docs;
    const docs = (await listPolicyDocuments(false)) as PolicyDocument[];
    cache = { at: Date.now(), docs };
    return docs;
}


/** Plain text of the policies (optionally only sections matching a topic). */
export async function policyText(topic?: string): Promise<string> {
    const ALL_POLICIES = await loadPolicies()
    const t = (topic ?? '').trim().toLowerCase()
    const out: string[] = []
    for (const doc of ALL_POLICIES) {
        const sections = t
            ? doc.sections.filter((s) =>
                [s.title, s.summary, ...s.rules].join(' ').toLowerCase().includes(t) ||
                doc.title.toLowerCase().includes(t),
            )
            : doc.sections
        if (sections.length === 0) continue
        out.push(`# ${doc.title}`)
        if (!t) out.push(doc.intro)
        for (const s of sections) {
            out.push(`## ${s.title}`, s.summary, ...s.rules.map((r) => `- ${r}`))
            if (s.note) out.push(`Note: ${s.note}`)
        }
        if (doc.footnote && !t) out.push(`${doc.footnote.title} ${doc.footnote.text}`)
    }
    return out.join('\n')
}
const STOP = new Set(['policy', 'policies', 'company', 'what', 'about', 'the', 'our', 'rule', 'rules', 'tell', 'brief', 'info', 'please', 'give', 'kya', 'hai'])
const SYNONYMS: Record<string, string[]> = {
    posh: ['harassment'],
    harassment: ['harassment'],
    wfh: ['work from home', 'wfh'],
    'work from home': ['work from home', 'wfh'],
    late: ['late'],
    leave: ['leave'],
    holiday: ['holiday'],
    'half day': ['half day', 'half-day'],
    laptop: ['laptop', 'device'],
    salary: ['salary', 'payroll'],
}

export type PolicyMatch = {
    found: boolean
    /** Matching sections as markdown. */
    markdown: string
    /** Every section title, to suggest topics when nothing matched. */
    allTitles: string[]
    /** true when a section is about this topic (not just one line mentioning it) */
    titleMatch: boolean
}

/** Find policy sections for a topic by keywords. Never falls back to unrelated sections. */
export async function policySections(topic?: string): Promise<PolicyMatch> {
    const ALL_POLICIES = await loadPolicies()
    const allTitles = ALL_POLICIES.flatMap((d) => d.sections.map((s) => s.title))
    const raw = (topic ?? '').toLowerCase().trim()
    const words = raw.split(/[^a-z0-9-]+/).filter((w) => w.length >= 3 && !STOP.has(w))
    const terms = new Set<string>()
    for (const [k, v] of Object.entries(SYNONYMS)) if (raw.includes(k)) v.forEach((x) => terms.add(x))
    words.forEach((w) => terms.add(w))
    // Whole words only: "late" must not match "violate" or "latest". Allows plurals ("leave" -> "leaves").
    const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]+')
    const patterns = [...terms].map((t) => new RegExp(`\\b${esc(t)}(s|es)?\\b`, 'i'))
    const hits = (text: string) => patterns.some((re) => re.test(text))

    type Hit = { doc: PolicyDocument; section: PolicySection; byTitle: boolean; lines: string[] }
    const found: Hit[] = []
    if (patterns.length > 0) {
        for (const doc of ALL_POLICIES) {
            for (const section of doc.sections) {
                const byTitle = hits(section.title)
                const lines = [section.summary, ...section.rules].filter(hits)
                if (byTitle || lines.length > 0) found.push({ doc, section, byTitle, lines })
            }
        }
    }
    // A section that is ABOUT the topic wins; only fall back to single matching lines when none is.
    const titleMatch = found.some((h) => h.byTitle)
    const chosen = titleMatch ? found.filter((h) => h.byTitle) : found
    const out: string[] = []
    for (const h of chosen) {
        const s = h.section
        if (h.byTitle) {
            out.push(`**${s.title}** (${h.doc.title})`, s.summary, ...s.rules.map((r) => `- ${r}`))
            if (s.note) out.push(`Note: ${s.note}`)
        } else {
            out.push(`**${s.title}** (${h.doc.title})`, ...h.lines.filter((l) => l !== s.summary).map((r) => `- ${r}`))
        }
        out.push('')
    }
    return { found: out.length > 0, markdown: out.join('\n').trim(), allTitles, titleMatch }
}