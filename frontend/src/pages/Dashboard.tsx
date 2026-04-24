import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../auth'

type Receipt = {
  receipt_number?: string
  receiptNumber?: string
  supplier_name?: string
  supplierName?: string
  supplier?: string
  status?: string
  received_at?: string
  receivedAt?: string
  created_at?: string
  [key: string]: any
}

type StatusCounts = {
  draft: number
  received: number
  quality_hold: number
  matched: number
  archived: number
}

const EMPTY_COUNTS: StatusCounts = { draft: 0, received: 0, quality_hold: 0, matched: 0, archived: 0 }

function receiptNum(r: Receipt) { return r.receipt_number || r.receiptNumber || '—' }
function supplierName(r: Receipt) { return r.supplier_name || r.supplierName || r.supplier || 'Unknown supplier' }
function receiptDate(r: Receipt) {
  const raw = r.received_at || r.receivedAt || r.created_at
  if (!raw) return null
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d
}
function formatDate(d: Date) {
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffH = diffMs / 3600000
  if (diffH < 1) return 'Just now'
  if (diffH < 24) return `${Math.floor(diffH)}h ago`
  if (diffH < 48) return 'Yesterday'
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
}

const STATUS_META: Record<string, { label: string; badge: string; color: string }> = {
  draft:         { label: 'Draft',         badge: 'badge-default', color: 'var(--text-subtle)' },
  received:      { label: 'Received',      badge: 'badge-blue',    color: 'var(--blue)' },
  quality_hold:  { label: 'Quality Hold',  badge: 'badge-amber',   color: 'var(--amber)' },
  matched:       { label: 'Matched',       badge: 'badge-green',   color: 'var(--green)' },
  archived:      { label: 'Archived',      badge: 'badge-default', color: 'var(--text-subtle)' },
}

function StatusBadge({ status }: { status?: string }) {
  const meta = STATUS_META[status ?? ''] ?? { label: status ?? '—', badge: 'badge-default', color: '' }
  return <span className={`badge ${meta.badge}`}>{meta.label}</span>
}

export default function Dashboard() {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [counts, setCounts]     = useState<StatusCounts>(EMPTY_COUNTS)
  const [recent, setRecent]     = useState<Receipt[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')

  useEffect(() => { refresh() }, [])

  async function refresh() {
    setError('')
    setLoading(true)
    try {
      const res = await apiFetch('/receipts')
      if (!res.ok) { setError('Failed to load receipts'); return }
      const data = await res.json()
      const all: Receipt[] = data.receipts || []
      setReceipts(all)

      const c = { ...EMPTY_COUNTS }
      for (const r of all) {
        const s = r.status as keyof StatusCounts
        if (s in c) c[s]++
      }
      setCounts(c)

      const sorted = [...all].sort((a, b) => {
        const da = receiptDate(a)?.getTime() ?? 0
        const db = receiptDate(b)?.getTime() ?? 0
        return db - da
      })
      setRecent(sorted.slice(0, 5))
    } catch (e: any) {
      setError(e.message || 'Network error — check connection')
    } finally {
      setLoading(false)
    }
  }

  const totalActive = counts.draft + counts.received + counts.quality_hold

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Operational overview</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-ghost btn-sm" onClick={refresh} disabled={loading}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={loading ? 'spin' : ''} aria-hidden="true">
              <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {error}
        </div>
      )}

      {/* Pipeline Phase Banner */}
      <div className="pipeline-banner">
        <div className="pipeline-phase pipeline-phase--active">
          <div className="pipeline-phase__number">1</div>
          <div className="pipeline-phase__text">
            <span className="pipeline-phase__name">Receipting</span>
            <span className="pipeline-phase__status">Active</span>
          </div>
        </div>
        <div className="pipeline-connector" aria-hidden="true" />
        <div className="pipeline-phase pipeline-phase--soon">
          <div className="pipeline-phase__number">2</div>
          <div className="pipeline-phase__text">
            <span className="pipeline-phase__name">Dispatching</span>
            <span className="pipeline-phase__status">Coming soon</span>
          </div>
        </div>
        <div className="pipeline-connector" aria-hidden="true" />
        <div className="pipeline-phase pipeline-phase--soon">
          <div className="pipeline-phase__number">3</div>
          <div className="pipeline-phase__text">
            <span className="pipeline-phase__name">Processing</span>
            <span className="pipeline-phase__status">Coming soon</span>
          </div>
        </div>
      </div>

      {/* Status Breakdown */}
      <div className="section" style={{ marginBottom: '1.5rem' }}>
        <div className="section__header">
          <h2 className="section__title">Receipt Status</h2>
          <Link to="/receipts" className="section__action">View all</Link>
        </div>
        <div className="section__body" style={{ padding: 0 }}>
          {loading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px,1fr))', gap: '1px', background: 'var(--border)' }}>
              {[...Array(5)].map((_, i) => (
                <div key={i} style={{ background: 'var(--surface)', padding: '1rem 1.25rem' }}>
                  <span className="skel" style={{ width: '2rem', height: '1.75rem', marginBottom: '0.5rem', display: 'block' }} />
                  <span className="skel" style={{ width: '70%', height: '0.75rem' }} />
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px,1fr))', gap: '1px', background: 'var(--border)' }}>
              {(Object.entries(counts) as [keyof StatusCounts, number][]).map(([status, count]) => {
                const meta = STATUS_META[status]
                return (
                  <Link
                    key={status}
                    to="/receipts"
                    style={{ background: 'var(--surface)', padding: '1rem 1.25rem', textDecoration: 'none', display: 'block' }}
                    className="status-count-cell"
                  >
                    <div style={{ fontSize: '1.75rem', fontWeight: 700, color: meta.color, lineHeight: 1 }}>
                      {count}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', marginTop: '0.3rem' }}>
                      {meta.label}
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Recent Receipts */}
      <div className="section" style={{ marginBottom: '1.5rem' }}>
        <div className="section__header">
          <h2 className="section__title">Recent Receipts</h2>
          <Link to="/receipts" className="section__action">View all</Link>
        </div>
        <div className="section__body" style={{ padding: 0 }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {[...Array(4)].map((_, i) => (
                <div key={i} style={{ padding: '0.875rem 1.25rem', borderBottom: i < 3 ? '1px solid var(--border)' : 'none', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <span className="skel" style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span className="skel" style={{ width: '45%', height: 13 }} />
                    <span className="skel" style={{ width: '65%', height: 12 }} />
                  </div>
                  <span className="skel" style={{ width: 60, height: 20, borderRadius: 10 }} />
                </div>
              ))}
            </div>
          ) : recent.length === 0 ? (
            <div style={{ padding: '2rem 1.25rem', textAlign: 'center', color: 'var(--text-subtle)', fontSize: '0.875rem' }}>
              No receipts yet
            </div>
          ) : (
            <div>
              {recent.map((r, i) => {
                const d = receiptDate(r)
                return (
                  <Link
                    key={i}
                    to="/receipts"
                    className="recent-receipt-row"
                    style={{ borderBottom: i < recent.length - 1 ? '1px solid var(--border)' : 'none' }}
                  >
                    <div className="recent-receipt-row__icon" aria-hidden="true">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                      </svg>
                    </div>
                    <div className="recent-receipt-row__info">
                      <span className="recent-receipt-row__num">{receiptNum(r)}</span>
                      <span className="recent-receipt-row__supplier">{supplierName(r)}</span>
                    </div>
                    <div className="recent-receipt-row__meta">
                      <StatusBadge status={r.status} />
                      {d && <span className="recent-receipt-row__date">{formatDate(d)}</span>}
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Upcoming Phases */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px,1fr))', gap: '1rem' }}>
        <div className="phase-card phase-card--soon">
          <div className="phase-card__icon" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 5v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
            </svg>
          </div>
          <div>
            <div className="phase-card__title">Dispatching</div>
            <div className="phase-card__desc">Track outbound goods from the floor to delivery. Assign jobs, generate dispatch notes, and confirm delivery.</div>
            <span className="badge badge-default" style={{ marginTop: '0.75rem', display: 'inline-block' }}>Phase 2 — Coming soon</span>
          </div>
        </div>

        <div className="phase-card phase-card--soon">
          <div className="phase-card__icon" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
            </svg>
          </div>
          <div>
            <div className="phase-card__title">Processing</div>
            <div className="phase-card__desc">Manage the galvanising process: dip schedules, kettle assignments, batch tracking, and quality sign-off.</div>
            <span className="badge badge-default" style={{ marginTop: '0.75rem', display: 'inline-block' }}>Phase 3 — Coming soon</span>
          </div>
        </div>
      </div>
    </div>
  )
}
