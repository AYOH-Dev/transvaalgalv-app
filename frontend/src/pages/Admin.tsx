import React, { useEffect, useState, useRef, useCallback } from 'react'
import { apiFetch } from '../auth'
import { useToast } from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'
import { SkeletonRows } from '../components/Skeleton'

type User = { id: string; email: string; display_name?: string; role: string; is_active?: boolean }
type Form = { email: string; password: string; displayName: string; role: string }

export default function Admin() {
  const toast = useToast()

  const [users, setUsers]     = useState<User[]>([])
  const [roles, setRoles]     = useState<string[]>(['user', 'admin'])
  const [loading, setLoading] = useState(false)
  const [search, setSearch]   = useState('')
  const [showInactive, setShowInactive] = useState(false)

  // Create form
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating]     = useState(false)
  const [form, setForm]             = useState<Form>({ email: '', password: '', displayName: '', role: 'user' })

  // Edit modal
  const [editUser, setEditUser]         = useState<User | null>(null)
  const [editName, setEditName]         = useState('')
  const [editRole, setEditRole]         = useState('')
  const [editActive, setEditActive]     = useState(true)
  const [saving, setSaving]             = useState(false)

  // Confirm deactivate
  const [confirmUser, setConfirmUser]   = useState<User | null>(null)

  // Overflow menu
  const [menuUserId, setMenuUserId]     = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => { fetchUsers(); fetchRoles() }, [])

  useEffect(() => {
    const close = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuUserId(null) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  async function fetchUsers() {
    setLoading(true)
    try {
      const res = await apiFetch('/admin/users')
      if (!res.ok) { toast.error('Failed to fetch users'); return }
      const data = await res.json()
      setUsers(data.users || [])
    } catch { toast.error('Network error fetching users') }
    finally { setLoading(false) }
  }

  async function fetchRoles() {
    for (const url of ['/admin/roles', '/getRoles']) {
      try {
        const r = await apiFetch(url)
        if (!r.ok) continue
        const d = await r.json()
        if (Array.isArray(d.roles)) { setRoles(d.roles); return }
        if (d.Root?.DataPage) {
          const parsed = d.Root.DataPage.map((it: any) => it.Record.RoleName || it.Record.Role).filter(Boolean)
          if (parsed.length) { setRoles(parsed); return }
        }
      } catch { /* try next */ }
    }
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    try {
      const res = await apiFetch('/admin/users', {
        method: 'POST',
        body: JSON.stringify({ email: form.email, password: form.password, role: form.role, display_name: form.displayName }),
      })
      if (!res.ok) { const t = await res.text(); toast.error(`Create failed: ${t || res.status}`); return }
      toast.success(`User ${form.email} created`)
      setForm({ email: '', password: '', displayName: '', role: 'user' })
      setShowCreate(false)
      fetchUsers()
    } catch { toast.error('Network error') }
    finally { setCreating(false) }
  }

  function openEdit(u: User) {
    setEditUser(u)
    setEditName(u.display_name || '')
    setEditRole(u.role || '')
    setEditActive(u.is_active === undefined ? true : !!u.is_active)
    setMenuUserId(null)
  }

  async function submitEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editUser) return
    setSaving(true)
    try {
      const body: any = { is_active: editActive }
      if (editName) body.display_name = editName
      if (editRole) body.role = editRole
      const res = await apiFetch(`/admin/users/${editUser.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      if (!res.ok) { const t = await res.text(); toast.error(`Update failed: ${t || res.status}`); return }
      toast.success('User updated')
      setEditUser(null)
      fetchUsers()
    } catch { toast.error('Network error') }
    finally { setSaving(false) }
  }

  async function doDeactivate() {
    if (!confirmUser) return
    try {
      const res = await apiFetch(`/admin/users/${confirmUser.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: false }) })
      if (!res.ok) { const t = await res.text(); toast.error(`Deactivate failed: ${t || res.status}`); return }
      toast.success(`${confirmUser.email} deactivated`)
      fetchUsers()
    } catch { toast.error('Network error') }
    finally { setConfirmUser(null) }
  }

  const visible = showInactive ? users : users.filter(u => u.is_active !== false)
  const filtered = search
    ? visible.filter(u => u.email.toLowerCase().includes(search.toLowerCase()) || (u.display_name || '').toLowerCase().includes(search.toLowerCase()))
    : visible

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Admin</h1>
          <p className="page-subtitle">Manage users and access</p>
        </div>
        <div className="header-actions">
          <input type="search" className="search-input" placeholder="Search users…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search users" />
          <button
            type="button"
            className={`btn btn-sm ${showInactive ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setShowInactive(s => !s)}
            disabled={loading}
            title="Include deactivated users"
            aria-pressed={showInactive}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginRight: 4 }}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" y1="8" x2="23" y2="14"/><line x1="23" y1="8" x2="17" y2="14"/></svg>
            {showInactive ? 'Hide deactivated' : 'Show deactivated'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={fetchUsers} disabled={loading}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={loading ? 'spin' : ''} aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Refresh
          </button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New User
          </button>
        </div>
      </div>

      {/* Users — desktop table */}
      <div className="section hide-mobile">
        <div className="section__header">
          <h2 className="section__title">Users <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.875rem' }}>({filtered.length})</span></h2>
        </div>
        <div className="table-wrap">
          <table className="data-table" aria-label="Users">
            <thead>
              <tr>
                <th scope="col">Email</th>
                <th scope="col">Display name</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col" style={{ width: 100 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? <SkeletonRows rows={4} cols={5} />
                : filtered.length === 0
                  ? (
                    <tr><td colSpan={5}>
                      <div className="empty-state">
                        <div className="empty-state__icon">
                          <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                        </div>
                        <p className="empty-state__title">{search ? 'No users match your search' : 'No users yet'}</p>
                        {!search && <button className="btn btn-primary" onClick={() => setShowCreate(true)}>Create first user</button>}
                      </div>
                    </td></tr>
                  )
                  : filtered.map(u => (
                    <tr key={u.id}>
                      <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{u.email}</td>
                      <td>{u.display_name || <span style={{ color: 'var(--text-subtle)' }}>—</span>}</td>
                      <td><span className="badge badge-blue">{u.role}</span></td>
                      <td><span className={`badge ${u.is_active === false ? 'badge-red' : 'badge-green'}`}>{u.is_active === false ? 'Inactive' : 'Active'}</span></td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => openEdit(u)} title="Edit user">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                          <div className="dropdown" ref={menuUserId === u.id ? menuRef : null}>
                            <button className="btn btn-icon btn-sm" onClick={() => setMenuUserId(id => id === u.id ? null : u.id)} aria-label="More actions" aria-expanded={menuUserId === u.id}>
                              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                            </button>
                            {menuUserId === u.id && (
                              <div className="dropdown-menu" role="menu">
                                {u.is_active !== false
                                  ? <button className="dropdown-item dropdown-item--danger" role="menuitem" onClick={() => { setConfirmUser(u); setMenuUserId(null) }}>
                                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                                      Deactivate
                                    </button>
                                  : <button className="dropdown-item dropdown-item--success" role="menuitem" onClick={() => openEdit({ ...u })}>
                                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                                      Reactivate
                                    </button>
                                }
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
      </div>

      {/* Users — mobile card list */}
      <div className="show-mobile">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.875rem' }}>
          <h2 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            Users <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.875rem' }}>({filtered.length})</span>
          </h2>
        </div>
        {loading
          ? <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>{[...Array(3)].map((_, i) => (
              <div key={i} className="user-card">
                <span className="skel" style={{ width: '60%', height: 16 }} />
                <span className="skel" style={{ width: '40%', height: 13, marginTop: 6 }} />
              </div>
            ))}</div>
          : filtered.length === 0
            ? <div className="empty-state">
                <div className="empty-state__icon"><svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div>
                <p className="empty-state__title">{search ? 'No users match your search' : 'No users yet'}</p>
                {!search && <button className="btn btn-primary" onClick={() => setShowCreate(true)}>Create first user</button>}
              </div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                {filtered.map(u => (
                  <div key={u.id} className="user-card">
                    <div className="user-card__top">
                      <div className="user-card__avatar" aria-hidden="true">
                        {(u.display_name || u.email)[0].toUpperCase()}
                      </div>
                      <div className="user-card__info">
                        <span className="user-card__email">{u.email}</span>
                        {u.display_name && <span className="user-card__name">{u.display_name}</span>}
                      </div>
                      <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
                        <span className={`badge ${u.is_active === false ? 'badge-red' : 'badge-green'}`}>
                          {u.is_active === false ? 'Inactive' : 'Active'}
                        </span>
                        <span className="badge badge-blue">{u.role}</span>
                      </div>
                    </div>
                    <div className="user-card__actions">
                      <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => openEdit(u)}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        Edit
                      </button>
                      {u.is_active !== false
                        ? <button className="btn btn-sm" style={{ flex: 1, background: 'var(--red-dim)', color: 'var(--red-fg)', border: '1px solid rgba(239,68,68,.25)' }} onClick={() => setConfirmUser(u)}>
                            Deactivate
                          </button>
                        : <button className="btn btn-sm" style={{ flex: 1, background: 'var(--green-dim)', color: 'var(--green-fg)', border: '1px solid rgba(16,185,129,.25)' }} onClick={() => openEdit({ ...u })}>
                            Reactivate
                          </button>
                      }
                    </div>
                  </div>
                ))}
              </div>
        }
      </div>

      {/* Create user modal */}
      {showCreate && (
        <div className="app-modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowCreate(false) }} role="dialog" aria-modal="true" aria-labelledby="create-title">
          <div className="app-modal">
            <div className="app-modal__header">
              <h2 className="app-modal__title" id="create-title">Create User</h2>
              <button className="btn btn-icon" onClick={() => setShowCreate(false)} aria-label="Close">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <form id="create-form" onSubmit={submitCreate}>
              <div className="app-modal__body">
                <div className="form">
                  <div className="form-row">
                    <div className="form-field">
                      <label htmlFor="c-name" className="form-label">Display name</label>
                      <input id="c-name" type="text" className="form-input" value={form.displayName} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))} placeholder="Jane Smith" />
                    </div>
                    <div className="form-field">
                      <label htmlFor="c-role" className="form-label required">Role</label>
                      <select id="c-role" className="form-select" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} required>
                        {roles.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="form-field">
                    <label htmlFor="c-email" className="form-label required">Email</label>
                    <input id="c-email" type="email" className="form-input" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="user@company.com" required autoComplete="off" />
                  </div>
                  <div className="form-field">
                    <label htmlFor="c-password" className="form-label required">Password</label>
                    <input id="c-password" type="password" className="form-input" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Temporary password" required autoComplete="new-password" />
                  </div>
                </div>
              </div>
            </form>
            <div className="app-modal__footer">
              <button className="btn btn-ghost" type="button" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" type="submit" form="create-form" disabled={creating}>
                {creating && <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="spin" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>}
                {creating ? 'Creating…' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit user modal */}
      {editUser && (
        <div className="app-modal-overlay" onClick={e => { if (e.target === e.currentTarget) setEditUser(null) }} role="dialog" aria-modal="true" aria-labelledby="edit-title">
          <div className="app-modal">
            <div className="app-modal__header">
              <h2 className="app-modal__title" id="edit-title">Edit User</h2>
              <button className="btn btn-icon" onClick={() => setEditUser(null)} aria-label="Close">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <form id="edit-form" onSubmit={submitEdit}>
              <div className="app-modal__body">
                <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', color: 'var(--text-muted)', background: 'var(--surface-2)', padding: '0.625rem 0.875rem', borderRadius: 'var(--radius)', fontFamily: 'monospace' }}>
                  {editUser.email}
                </p>
                <div className="form">
                  <div className="form-row">
                    <div className="form-field">
                      <label htmlFor="e-name" className="form-label">Display name</label>
                      <input id="e-name" type="text" className="form-input" value={editName} onChange={e => setEditName(e.target.value)} />
                    </div>
                    <div className="form-field">
                      <label htmlFor="e-role" className="form-label">Role</label>
                      <select id="e-role" className="form-select" value={editRole} onChange={e => setEditRole(e.target.value)}>
                        {roles.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', cursor: 'pointer', userSelect: 'none' }}>
                    <input type="checkbox" checked={editActive} onChange={e => setEditActive(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--blue)', cursor: 'pointer' }} />
                    <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Active account</span>
                  </label>
                </div>
              </div>
            </form>
            <div className="app-modal__footer">
              <button className="btn btn-ghost" type="button" onClick={() => setEditUser(null)}>Cancel</button>
              <button className="btn btn-primary" type="submit" form="edit-form" disabled={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm deactivate */}
      <ConfirmDialog
        open={!!confirmUser}
        title="Deactivate User"
        message={`Remove access for ${confirmUser?.email}? They will not be able to sign in.`}
        confirmLabel="Deactivate"
        variant="danger"
        onConfirm={doDeactivate}
        onCancel={() => setConfirmUser(null)}
      />
    </div>
  )
}
