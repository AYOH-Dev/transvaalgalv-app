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

  return (
    <div className="container">
      <h1>Admin</h1>
      <div>
        <button onClick={fetchUsers}>Refresh users</button>
      </div>
      {error && <div className="error">{error}</div>}
      <ul>
        {users.map((u) => (
          <li key={u.id}>{u.email} — {u.role}</li>
        ))}
      </ul>
    </div>
  )
}
