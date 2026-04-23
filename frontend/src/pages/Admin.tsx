import React, { useEffect, useState } from 'react'
import { apiFetch } from '../auth'

type User = {
  id: string
  email: string
  role: string
}

export default function Admin() {
  const [users, setUsers] = useState<User[]>([])
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('user')
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetchUsers()
  }, [])

  async function fetchUsers() {
    setError('')
    try {
      const res = await apiFetch('/admin/users')
      if (!res.ok) {
        setError('Failed to fetch users')
        return
      }
      const data = await res.json()
      setUsers(data.users || [])
    } catch (err) {
      setError('Network or authorization error')
    }
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault()
    setMessage('')
    setError('')
    setCreating(true)
    try {
      const res = await apiFetch('/admin/users', {
        method: 'POST',
        body: JSON.stringify({ email, password, role }),
      })
      if (!res.ok) {
        const txt = await res.text()
        setError(`Create failed: ${txt || res.status}`)
        return
      }
      setMessage('User created')
      setEmail('')
      setPassword('')
      fetchUsers()
    } catch (err) {
      setError('Network or authorization error')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="container">
      <h1 className="text-2xl mb-4">Admin</h1>
      <div className="mb-4">
        <button className="btn" onClick={fetchUsers}>Refresh users</button>
      </div>
      {error && <div className="error">{error}</div>}
      {message && <div className="alert alert-success mb-4">{message}</div>}

      <form onSubmit={createUser} className="card">
        <h3 className="text-lg">Create user</h3>
        <label>
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <div className="mt-2">
          <button className="btn btn-primary" type="submit" disabled={creating}>{creating ? 'Creating...' : 'Create'}</button>
        </div>
      </form>

      <ul className="mt-4">
        {users.map((u) => (
          <li key={u.id} className="py-1">{u.email} — {u.role}</li>
        ))}
      </ul>
    </div>
  )
}
