import axios from 'axios'
import { client } from './client'

export type ChatTurn = { role: 'user' | 'assistant'; content: string }

export type ChatStatus = { enabled: boolean; model: string | null; reachable: boolean }

export type ChatReply = { answer: string; toolsUsed: string[]; durationMs: number }

export async function fetchChatStatus(): Promise<ChatStatus> {
    const { data } = await client.get<ChatStatus>('/api/chat/status')
    return data
}

/** Send the conversation (last item = the new question). AI on CPU can take a while. */
export async function sendChat(messages: ChatTurn[]): Promise<ChatReply> {
    try {
        const { data } = await client.post<ChatReply>('/api/chat', { messages }, { timeout: 150_000 })
        return data
    } catch (e) {
        if (axios.isAxiosError(e)) {
            const msg = (e.response?.data as { message?: string } | undefined)?.message
            if (msg) throw new Error(msg)
            if (e.code === 'ECONNABORTED') throw new Error('The assistant took too long. Please try again.')
        }
        throw new Error('Could not reach the assistant.')
    }
}