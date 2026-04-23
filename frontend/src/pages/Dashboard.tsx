import React, { useEffect, useState } from 'react'
import { apiFetch } from '../auth'

export default function Dashboard() {
  const [ready, setReady] = useState<any>(null)
  const [receiptsCount, setReceiptsCount] = useState<number | null>(null)
  const [usersCount, setUsersCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    refresh()
  }, [])

  async function refresh() {
    setError('')
    setLoading(true)
    try {
      const r = await apiFetch('/ready')
      if (r.ok) {
        setReady(await r.json())
      }
      const rr = await apiFetch('/receipts')
      if (rr.ok) {
        const data = await rr.json()
        setReceiptsCount((data.receipts && data.receipts.length) || 0)
      }
      const ru = await apiFetch('/admin/users')
      if (ru.ok) {
        const ud = await ru.json()
        setUsersCount((ud.users && ud.users.length) || 0)
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container">
      <h1 className="text-2xl mb-4">Dashboard</h1>
      <div className="mb-4">
        <button className="btn" onClick={refresh} disabled={loading}>{loading ? 'Refreshing...' : 'Refresh'}</button>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="cards">
        <div className="card">
          <strong>Service status</strong>
          <div>{ready ? 'ok' : 'unknown'}</div>
        </div>
        <div className="card">
          <strong>Receipts</strong>
          <div>{receiptsCount ?? '—'}</div>
        </div>
        <div className="card">
          <strong>Users</strong>
          <div>{usersCount ?? '—'}</div>
        </div>
      </div>
      <pre className="mt-3">{ready ? JSON.stringify(ready, null, 2) : 'No readiness data'}</pre>
    </div>
  )
}
