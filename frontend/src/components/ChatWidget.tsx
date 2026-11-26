import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { fetchChatStatus, sendChat, type ChatStatus, type ChatTurn } from '../api/chat'

type Props = {
    user: { id?: number; name?: string | null; email?: string | null; role?: string | null }
}

const HR_SUGGESTIONS = [
    'Who is late today?',
    "Who hasn't punched in yet today?",
    'Who had the most late marks this month?',
    'Show Santosh attendance this week',
    'Upcoming holidays',
]

const EMPLOYEE_SUGGESTIONS = [
    'My attendance this month',
    'How many late marks do I have this month?',
    'What time did I punch in yesterday?',
    'What is the late mark policy?',
    'When is the next holiday?',
]

function storageKey(userId: number | string | undefined) {
    return `par_hr_chat_${userId ?? 'me'}`
}

function loadHistory(key: string): ChatTurn[] {
    try {
        const raw = sessionStorage.getItem(key)
        const parsed = raw ? (JSON.parse(raw) as ChatTurn[]) : []
        return Array.isArray(parsed) ? parsed.slice(-30) : []
    } catch {
        return []
    }
}

function saveHistory(key: string, turns: ChatTurn[]) {
    try {
        sessionStorage.setItem(key, JSON.stringify(turns.slice(-30)))
    } catch {
        /* private mode / quota: keep in memory only */
    }
}

/* ---------- tiny, safe markdown: **bold**, `code`, lists, tables ---------- */

function inline(text: string, keyBase: string): ReactNode[] {
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    return parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) return <strong key={`${keyBase}-${i}`}>{p.slice(2, -2)}</strong>
        if (p.startsWith('`') && p.endsWith('`'))
            return (
                <code key={`${keyBase}-${i}`} className="rounded bg-black/5 px-1 text-[0.85em]">
                    {p.slice(1, -1)}
                </code>
            )
        return <Fragment key={`${keyBase}-${i}`}>{p}</Fragment>
    })
}

function Markdown({ text }: { text: string }) {
    const lines = text.replace(/\r/g, '').split('\n')
    const blocks: ReactNode[] = []
    let i = 0
    while (i < lines.length) {
        const line = lines[i]!
        // table
        if (/^\s*\|.*\|\s*$/.test(line)) {
            const rows: string[][] = []
            while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) {
                const cells = lines[i]!.trim().slice(1, -1).split('|').map((c) => c.trim())
                if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells)
                i++
            }
            const [head, ...body] = rows
            blocks.push(
                <div key={`t${i}`} className="my-1.5 overflow-x-auto">
                    <table className="w-full border-collapse text-[0.78rem]">
                        {head ? (
                            <thead>
                                <tr>
                                    {head.map((c, j) => (
                                        <th key={j} className="border border-[var(--color-warm-muted)] bg-black/[0.03] px-1.5 py-1 text-left font-semibold">
                                            {inline(c, `th${i}${j}`)}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                        ) : null}
                        <tbody>
                            {body.map((r, ri) => (
                                <tr key={ri}>
                                    {r.map((c, j) => (
                                        <td key={j} className="border border-[var(--color-warm-muted)] px-1.5 py-1 align-top">
                                            {inline(c, `td${i}${ri}${j}`)}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>,
            )
            continue
        }
        // list
        if (/^\s*([-*•]|\d+\.)\s+/.test(line)) {
            const items: { text: string; sub: boolean }[] = []
            const ordered = /^\s*\d+\./.test(line)
            const baseIndent = line.match(/^\s*/)![0].length
            while (i < lines.length && /^\s*([-*•]|\d+\.)\s+/.test(lines[i]!)) {
                const indent = lines[i]!.match(/^\s*/)![0].length
                items.push({ text: lines[i]!.replace(/^\s*([-*•]|\d+\.)\s+/, ''), sub: indent > baseIndent })
                i++
            }
            const ListTag = ordered ? 'ol' : 'ul'
            blocks.push(
                <ListTag key={`l${i}`} className={`my-1 space-y-0.5 pl-5 ${ordered ? 'list-decimal' : 'list-disc'}`}>
                    {items.map((it, j) => (
                        <li key={j} className={it.sub ? 'ml-4 list-[circle] text-[0.95em] opacity-90' : undefined}>
                            {inline(it.text, `li${i}${j}`)}
                        </li>
                    ))}
                </ListTag>,
            )
            continue
        }
        if (line.trim() === '') {
            i++
            continue
        }
        const heading = line.match(/^#{1,4}\s+(.*)$/)
        blocks.push(
            <p key={`p${i}`} className={heading ? 'mt-1 font-semibold' : 'my-0.5'}>
                {inline(heading ? heading[1]! : line, `p${i}`)}
            </p>,
        )
        i++
    }
    return <>{blocks}</>
}

/* --------------------------------- widget --------------------------------- */

export function ChatWidget({ user }: Props) {
    const key = storageKey(user.id ?? user.email ?? undefined)
    const [status, setStatus] = useState<ChatStatus | null>(null)
    const [open, setOpen] = useState(false)
    const [turns, setTurns] = useState<ChatTurn[]>(() => loadHistory(key))
    const [input, setInput] = useState('')
    const [sending, setSending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [elapsed, setElapsed] = useState(0)
    const listRef = useRef<HTMLDivElement | null>(null)
    const inputRef = useRef<HTMLTextAreaElement | null>(null)

    const role = (user.role ?? '').toLowerCase()
    const suggestions = role === 'hr' || role === 'admin' || role === 'manager' ? HR_SUGGESTIONS : EMPLOYEE_SUGGESTIONS

    useEffect(() => {
        let cancelled = false
        fetchChatStatus()
            .then((s) => {
                if (!cancelled) setStatus(s)
            })
            .catch(() => {
                if (!cancelled) setStatus({ enabled: false, model: null, reachable: false })
            })
        return () => {
            cancelled = true
        }
    }, [])

    useEffect(() => {
        saveHistory(key, turns)
    }, [key, turns])

    useEffect(() => {
        if (!open) return
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
    }, [turns, sending, open])

    useEffect(() => {
        if (open) setTimeout(() => inputRef.current?.focus(), 50)
    }, [open])

    useEffect(() => {
        if (!sending) return
        setElapsed(0)
        const t = setInterval(() => setElapsed((s) => s + 1), 1000)
        return () => clearInterval(t)
    }, [sending])

    if (!status?.enabled) return null

    async function ask(question: string) {
        const q = question.trim()
        if (!q || sending) return
        setError(null)
        const next: ChatTurn[] = [...turns, { role: 'user', content: q }]
        setTurns(next)
        setInput('')
        setSending(true)
        try {
            const reply = await sendChat(next.slice(-10))
            setTurns((prev) => [...prev, { role: 'assistant', content: reply.answer }])
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Something went wrong.')
        } finally {
            setSending(false)
        }
    }

    const firstName = (user.name || '').split(' ')[0] || 'there'

    return (
        <>
            {open ? (
                <div
                    className="fixed bottom-24 right-4 z-[60] flex h-[min(620px,calc(100vh-8rem))] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[var(--color-warm-muted)] bg-[var(--color-surface)] shadow-[0_18px_50px_rgba(0,0,0,0.22)]"
                    role="dialog"
                    aria-label="HR assistant"
                >
                    <div className="flex items-center justify-between gap-2 border-b border-[var(--color-warm-muted)] bg-[color-mix(in_srgb,var(--color-brand-muted)_55%,#fff)] px-4 py-3">
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-[var(--color-ink)]">Par HR Assistant</p>
                            <p className="flex items-center gap-1.5 text-[0.7rem] text-[var(--color-warm-text)]">
                                <span
                                    className={`inline-block h-2 w-2 rounded-full ${status.reachable ? 'bg-emerald-500' : 'bg-amber-500'}`}
                                    aria-hidden
                                />
                                {status.reachable ? 'Online · answers from HR data' : 'AI server is starting or offline'}
                            </p>
                        </div>
                        <div className="flex items-center gap-1">
                            {turns.length > 0 ? (
                                <button
                                    type="button"
                                    className="rounded-md px-2 py-1 text-xs text-[var(--color-warm-text)] hover:bg-black/5"
                                    onClick={() => {
                                        setTurns([])
                                        setError(null)
                                    }}
                                    disabled={sending}
                                >
                                    Clear
                                </button>
                            ) : null}
                            <button
                                type="button"
                                className="rounded-md px-2 py-1 text-lg leading-none text-[var(--color-warm-text)] hover:bg-black/5"
                                onClick={() => setOpen(false)}
                                aria-label="Close assistant"
                            >
                                ×
                            </button>
                        </div>
                    </div>

                    <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
                        {turns.length === 0 ? (
                            <div>
                                <p className="text-[var(--color-ink)]">
                                    Hi {firstName}! Ask me about attendance, punch times, late marks, leaves, holidays or company policy.
                                </p>
                                <div className="mt-3 flex flex-wrap gap-1.5">
                                    {suggestions.map((s) => (
                                        <button
                                            key={s}
                                            type="button"
                                            onClick={() => void ask(s)}
                                            className="rounded-full border border-[var(--color-warm-muted)] bg-[var(--color-surface)] px-3 py-1 text-xs text-[var(--color-warm-text)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
                                        >
                                            {s}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        {turns.map((t, idx) => (
                            <div key={idx} className={t.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                                <div
                                    className={`max-w-[88%] rounded-2xl px-3 py-2 leading-relaxed ${t.role === 'user'
                                        ? 'rounded-br-md bg-[var(--color-brand)] text-white'
                                        : 'rounded-bl-md bg-[color-mix(in_srgb,var(--color-warm-page)_70%,#fff)] text-[var(--color-ink)]'
                                        }`}
                                >
                                    {t.role === 'user' ? <span className="whitespace-pre-wrap">{t.content}</span> : <Markdown text={t.content} />}
                                </div>
                            </div>
                        ))}

                        {sending ? (
                            <div className="flex justify-start">
                                <div className="rounded-2xl rounded-bl-md bg-[color-mix(in_srgb,var(--color-warm-page)_70%,#fff)] px-3 py-2 text-[var(--color-warm-text)]">
                                    <span className="inline-flex items-center gap-1">
                                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
                                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
                                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
                                    </span>
                                    <span className="ml-2 text-xs">
                                        {elapsed < 4 ? 'Thinking…' : `Looking up HR data… ${elapsed}s`}
                                    </span>
                                </div>
                            </div>
                        ) : null}

                        {error ? <p className="alert-error text-xs">{error}</p> : null}
                    </div>

                    <form
                        className="flex items-end gap-2 border-t border-[var(--color-warm-muted)] px-3 py-2.5"
                        onSubmit={(e) => {
                            e.preventDefault()
                            void ask(input)
                        }}
                    >
                        <textarea
                            ref={inputRef}
                            rows={1}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault()
                                    void ask(input)
                                }
                            }}
                            placeholder="Ask about attendance, leaves, policy…"
                            maxLength={1000}
                            className="field max-h-28 min-h-[2.4rem] flex-1 resize-none py-2 text-sm"
                            disabled={sending}
                        />
                        <button type="submit" className="btn-primary px-3 py-2 text-sm" disabled={sending || !input.trim()}>
                            Send
                        </button>
                    </form>
                    <p className="px-4 pb-2 text-[0.62rem] text-[var(--color-warm-text)]">
                        AI answers can be wrong - check the attendance pages before acting on them.
                    </p>
                </div>
            ) : null}

            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="fixed bottom-5 right-5 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-brand)] text-white shadow-[0_10px_28px_rgba(0,0,0,0.25)] transition hover:scale-105"
                aria-label={open ? 'Close HR assistant' : 'Open HR assistant'}
                title="HR assistant"
            >
                {open ? (
                    <span className="text-2xl leading-none">×</span>
                ) : (
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                )}
            </button>
        </>
    )
}