import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../auth'
import { SkeletonStats } from '../components/Skeleton'

export default function Dashboard() {
  const [ready, setReady]               = useState<any>(null)
  const [receiptsCount, setReceipts]    = useState<number | null>(null)
  const [usersCount, setUsers]          = useState<number | null>(null)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState('')

  useEffect(() => { refresh() }, [])

  async function refresh() {
    setError('')
    setLoading(true)
    try {
      const [rr, receiptRes, userRes] = await Promise.allSettled([
        apiFetch('/ready'),
        apiFetch('/receipts'),
        apiFetch('/admin/users'),
      ])
      if (rr.status === 'fulfilled' && rr.value.ok) setReady(await rr.value.json())
      if (receiptRes.status === 'fulfilled' && receiptRes.value.ok) {
        const d = await receiptRes.value.json()
        setReceipts((d.receipts && d.receipts.length) ?? 0)
      }
      if (userRes.status === 'fulfilled' && userRes.value.ok) {
        const d = await userRes.value.json()
        setUsers((d.users && d.users.length) ?? 0)
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }

  const statusOk  = ready && !ready.error
  const statusBadge = statusOk ? 'badge-green' : ready === null ? 'badge-default' : 'badge-red'
  const statusText  = ready === null ? 'Unknown' : statusOk ? 'Healthy' : 'Degraded'

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">System overview</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-ghost btn-sm" onClick={refresh} disabled={loading}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={loading ? 'spin' : ''} aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {error}
        </div>
      )}

      {/* Stat Cards */}
      {loading
        ? <SkeletonStats count={3} />
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px,1fr))', gap: '1.125rem', marginBottom: '1.75rem' }}>
            <div className="stat-card">
              <div className="stat-card__icon stat-card__icon--blue">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </div>
              <div>
                <div className="stat-card__value">
                  <span className={`badge ${statusBadge}`}>{statusText}</span>
                </div>
                <div className="stat-card__label">Service Status</div>
              </div>
            </div>

            <Link to="/receipts" className="stat-card">
              <div className="stat-card__icon stat-card__icon--green">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              </div>
              <div>
                <div className="stat-card__value">{receiptsCount ?? '—'}</div>
                <div className="stat-card__label">Receipts</div>
              </div>
            </Link>

            <Link to="/admin" className="stat-card">
              <div className="stat-card__icon stat-card__icon--purple">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <div>
                <div className="stat-card__value">{usersCount ?? '—'}</div>
                <div className="stat-card__label">Users</div>
              </div>
            </Link>
          </div>
        )
      }

      {/* System info */}
      {ready && (
        <div className="section">
          <div className="section__header">
            <h2 className="section__title">System Info</h2>
          </div>
          <div className="section__body">
            <pre>{JSON.stringify(ready, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  )
}
