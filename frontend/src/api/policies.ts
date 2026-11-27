import axios from 'axios'
import { client } from './client'
import type { PolicyDocument, PolicySection } from '../constants/policies'

export type StoredPolicySection = PolicySection & {
    dbId: number
    docId: 'attendance' | 'company'
    sortOrder: number
    hidden: boolean
    edited: boolean
    updatedAt: string
    updatedBy: string | null
}

export type StoredPolicyDocument = Omit<PolicyDocument, 'sections'> & {
    sections: StoredPolicySection[]
    editedAt: string | null
}

export type PolicyChange = {
    id: number
    docId: string
    action: string
    title: string
    changedBy: string | null
    changedAt: string
}

export type PolicySectionInput = {
    docId?: 'attendance' | 'company'
    title: string
    summary: string
    /** one rule per line */
    rules: string
    note: string
}

function message(e: unknown, fallback: string): Error {
    if (axios.isAxiosError(e)) {
        const m = (e.response?.data as { message?: string } | undefined)?.message
        if (m) return new Error(m)
    }
    return new Error(fallback)
}

export async function fetchPolicies(): Promise<StoredPolicyDocument[]> {
    const { data } = await client.get<{ documents: StoredPolicyDocument[] }>('/api/policies')
    return data.documents
}

export async function fetchManagePolicies(): Promise<{ documents: StoredPolicyDocument[]; changes: PolicyChange[] }> {
    try {
        const { data } = await client.get<{ documents: StoredPolicyDocument[]; changes: PolicyChange[] }>(
            '/api/policies/manage',
        )
        return data
    } catch (e) {
        throw message(e, 'Could not load policies')
    }
}

export async function addPolicySection(input: PolicySectionInput): Promise<void> {
    try {
        await client.post('/api/policies/sections', input)
    } catch (e) {
        throw message(e, 'Could not add the policy')
    }
}

export async function updatePolicySection(id: number, input: PolicySectionInput): Promise<void> {
    try {
        await client.put(`/api/policies/sections/${id}`, input)
    } catch (e) {
        throw message(e, 'Could not save the policy')
    }
}

export async function setPolicySectionHidden(id: number, hidden: boolean): Promise<void> {
    try {
        await client.post(`/api/policies/sections/${id}/hide`, { hidden })
    } catch (e) {
        throw message(e, 'Could not update the policy')
    }
}

export async function movePolicySection(id: number, direction: 'up' | 'down'): Promise<void> {
    try {
        await client.post(`/api/policies/sections/${id}/move`, { direction })
    } catch (e) {
        throw message(e, 'Could not move the policy')
    }
}

export async function deletePolicySection(id: number): Promise<void> {
    try {
        await client.delete(`/api/policies/sections/${id}`)
    } catch (e) {
        throw message(e, 'Could not delete the policy')
    }
}

export type DraftPolicySection = { title: string; summary: string; rules: string[] }

/** HR: read a .docx / .txt file (or pasted text) into draft sections. Nothing is saved yet. */
export async function importPolicyDocument(input: { file?: File; text?: string }): Promise<DraftPolicySection[]> {
    try {
        if (input.file) {
            const form = new FormData()
            form.append('file', input.file)
            const { data } = await client.post<{ sections: DraftPolicySection[] }>('/api/policies/import', form)
            return data.sections
        }
        const { data } = await client.post<{ sections: DraftPolicySection[] }>('/api/policies/import', { text: input.text ?? '' })
        return data.sections
    } catch (e) {
        throw message(e, 'Could not read the document')
    }
}
/** HR: upload a new official PDF copy for a policy (replaces the old one). */
export async function uploadPolicyFile(docId: 'attendance' | 'company', file: File): Promise<void> {
    try {
        const form = new FormData()
        form.append('file', file)
        await client.post(`/api/policies/file/${docId}`, form)
    } catch (e) {
        throw message(e, 'Could not upload the PDF')
    }
}

/** HR: remove the uploaded PDF (back to the built-in copy). */
export async function deletePolicyFile(docId: 'attendance' | 'company'): Promise<void> {
    try {
        await client.delete(`/api/policies/file/${docId}`)
    } catch (e) {
        throw message(e, 'Could not remove the PDF')
    }
}

/** Download the uploaded PDF (needs the login token, so it goes through the API client). */
export async function fetchPolicyFileBlob(url: string): Promise<Blob> {
    try {
        const { data } = await client.get<Blob>(url, { responseType: 'blob' })
        return data
    } catch (e) {
        throw message(e, 'Could not download the policy PDF. Contact HR if this keeps happening.')
    }
}