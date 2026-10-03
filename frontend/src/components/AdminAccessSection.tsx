import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import {
  createAdminUser,
  deleteAdminUser,
  listAdminUsers,
  updateAdminUser,
  type AdminUserRecord,
} from '../api/admin'
import { DASHBOARD_ROLE_OPTIONS, roleLabel } from '../auth/permissions'
import { PasswordInput } from '../components/PasswordInput'
import { confirmAction, confirmDelete, confirmUpdate } from '../utils/confirmAction'

type Props = {
  currentUserId: number
  onGoToPeople: () => void
  onMessage?: (msg: { error?: string | null; success?: string | null }) => void
}

type LoginFormState = {
  email: string
  name: string
  role: string
  password: string
}

const EMPTY_LOGIN: LoginFormState = {
  email: '',
  name: '',
  role: 'viewer',
  password: '',
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Unknown'
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function errorMessage(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    return (e.response?.data as { message?: string })?.message ?? e.message ?? fallback
  }
  return e instanceof Error ? e.message : fallback
}

export function AdminAccessSection({ currentUserId, onGoToPeople, onMessage }: Props) {
  const [users, setUsers] = useState<AdminUserRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [showLoginOnly, setShowLoginOnly] = useState(false)
  const [form, setForm] = useState<LoginFormState>(EMPTY_LOGIN)

  const notify = useCallback(
    (error: string | null, success: string | null) => {
      onMessage?.({ error, success })
    },
    [onMessage],
  )

  const loadUsers = useCallback(async () => {
    setLoading(true)
    try {
      setUsers(await listAdminUsers())
    } catch (e) {
      notify(errorMessage(e, 'Could not load access accounts'), null)
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    )
  }, [users, search])

  const editingUser = useMemo(
    () => (editingId != null ? users.find((u) => u.id === editingId) : null),
    [editingId, users],
  )

  const roleHint = useMemo(
    () => DASHBOARD_ROLE_OPTIONS.find((o) => o.value === form.role.trim().toLowerCase())?.hint ?? '',
    [form.role],
  )

  const resetForm = () => {
    setEditingId(null)
    setForm(EMPTY_LOGIN)
    setShowLoginOnly(false)
  }

  const startEdit = (user: AdminUserRecord) => {
    setEditingId(user.id)
    setShowLoginOnly(false)
    setForm({
      email: user.email,
      name: user.name,
      role: user.role.trim().toLowerCase(),
      password: '',
    })
  }

  const onSave = async () => {
    if (editingId != null) {
      if (!(await confirmUpdate(`dashboard access for ${form.email.trim()}`))) return
    } else if (!(await confirmAction(`Create dashboard login for ${form.email.trim()}?`))) {
      return
    }
    setSaving(true)
    notify(null, null)
    try {
      if (editingId != null) {
        await updateAdminUser(editingId, {
          email: form.email,
          name: form.name,
          role: form.role,
          ...(form.password ? { password: form.password } : {}),
        })
        notify(null, `Updated access for ${form.email}.`)
      } else {
        await createAdminUser(form)
        notify(null, `Created login for ${form.email}. Setup email sent (check SMTP).`)
      }
      resetForm()
      await loadUsers()
    } catch (e) {
      notify(errorMessage(e, 'Could not save access account'), null)
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async (user: AdminUserRecord) => {
    if (!(await confirmDelete(`dashboard access for ${user.email}`))) return
    notify(null, null)
    try {
      await deleteAdminUser(user.id)
      notify(null, `Removed access for ${user.email}.`)
      if (editingId === user.id) resetForm()
      await loadUsers()
    } catch (e) {
      notify(errorMessage(e, 'Could not remove access'), null)
    }
  }

  return (
    <div className="px-4 pb-6 pt-2 sm:px-6 lg:px-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-sm leading-relaxed text-[var(--color-warm-text)]">
          Dashboard accounts for HR, managers, and admins. Payroll-only staff usually do not need a login
          - add them under <strong className="font-medium text-[var(--color-ink)]">People</strong> instead.
        </p>
        <button type="button" className="btn-secondary shrink-0 text-xs" onClick={onGoToPeople}>
          Open People
        </button>
      </div>

      {(editingUser || showLoginOnly) && (
        <div className="admin-form-card admin-form-card-editing mb-5 p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-[var(--color-ink)]">
            {editingUser ? `Edit access · ${editingUser.email}` : 'Login-only account'}
          </h3>
          {!editingUser ? (
            <p className="mt-1 text-xs text-[var(--color-warm-text)]">
              For HR or IT who need login but are not on the payroll register.
            </p>
          ) : null}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="field-label">Email</span>
              <input
                type="email"
                className="field field-compact mt-1 w-full"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </label>
            <label className="block">
              <span className="field-label">Name</span>
              <input
                type="text"
                className="field field-compact mt-1 w-full"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>
            <label className="block">
              <span className="field-label">Role</span>
              <select
                className="field field-compact mt-1 w-full"
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              >
                {DASHBOARD_ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {roleHint ? (
                <span className="mt-1.5 block text-xs text-[var(--color-warm-text)]">{roleHint}</span>
              ) : null}
            </label>
            <label className="block sm:col-span-2">
              <span className="field-label">
                Password{editingUser ? ' (leave blank to keep)' : ' (optional)'}
              </span>
              {!editingUser ? (
                <span className="mt-1 block text-xs text-[var(--color-warm-text)]">
                  Leave blank to email a setup link and code - recommended. Only set a password if
                  you must hand it to them manually.
                </span>
              ) : null}
              <PasswordInput
                className="field-compact mt-1 w-full max-w-md"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary text-xs"
              disabled={
                saving ||
                !form.email.trim() ||
                !form.name.trim() ||
                (!editingUser && form.password.length > 0 && form.password.length < 8)
              }
              onClick={() => void onSave()}
            >
              {saving ? 'Saving…' : editingUser ? 'Save access' : 'Create login'}
            </button>
            <button type="button" className="btn-ghost text-xs" disabled={saving} onClick={resetForm}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="admin-directory">
        <div className="admin-directory-head">
          <div>
            <h3 className="text-base font-semibold text-[var(--color-ink)]">Dashboard accounts</h3>
            <p className="mt-0.5 text-xs text-[var(--color-warm-text)]">{users.length} total</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              className="field field-compact min-w-0 flex-1 sm:max-w-xs"
              placeholder="Search name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {!showLoginOnly && !editingUser ? (
              <button
                type="button"
                className="btn-ghost shrink-0 text-xs"
                onClick={() => {
                  setShowLoginOnly(true)
                  setEditingId(null)
                  setForm(EMPTY_LOGIN)
                }}
              >
                Login-only account
              </button>
            ) : null}
          </div>
        </div>
        <div className="admin-table-scroll min-w-0 max-w-full overflow-x-auto">
          <table className="admin-table min-w-max w-full border-collapse text-left text-sm">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Updated</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-[var(--color-warm-text)]">
                    Loading…
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-[var(--color-warm-text)]">
                    No dashboard accounts yet.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user, index) => (
                  <tr
                    key={user.id}
                    className={`border-b border-[color-mix(in_srgb,var(--color-warm-muted)_55%,transparent)] ${index % 2 === 1 ? 'bg-[color-mix(in_srgb,var(--color-warm-page)_55%,#fff)]' : ''}`}
                  >
                    <td className="font-medium text-[var(--color-ink)]">{user.name}</td>
                    <td className="text-[var(--color-warm-text)]">{user.email}</td>
                    <td>
                      <span className="rounded-full bg-[var(--color-brand-muted)] px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--color-brand)]">
                        {roleLabel(user)}
                      </span>
                    </td>
                    <td className="text-xs text-[var(--color-warm-text)]">
                      {formatWhen(user.updatedAt)}
                    </td>
                    <td className="text-right">
                      <div className="flex justify-end gap-2">
                        <button type="button" className="btn-ghost text-xs" onClick={() => startEdit(user)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn-ghost text-xs text-red-700 disabled:opacity-40"
                          disabled={user.id === currentUserId}
                          onClick={() => void onDelete(user)}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
