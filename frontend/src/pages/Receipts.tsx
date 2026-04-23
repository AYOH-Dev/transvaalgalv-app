import React, { useEffect, useState } from 'react'
import { clearToken, apiFetch } from '../auth'

type Receipt = {
  receipt_number?: string
  receiptNumber?: string
  supplier_name?: string
  supplierName?: string
  supplier?: string
  [key: string]: any
}

function receiptNum(r: Receipt) { return r.receipt_number || r.receiptNumber || '—' }
function supplierName(r: Receipt) { return r.supplier_name || r.supplierName || r.supplier || '—' }

export default function Receipts({ onLogout }: { onLogout?: () => void }) {
  const [receipts, setReceipts]     = useState<Receipt[]>([])
  const [filtered, setFiltered]     = useState<Receipt[]>([])
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [search, setSearch]         = useState('')
  const [expandedIdx, setExpanded]  = useState<number | null>(null)

  useEffect(() => { fetchReceipts() }, [])

  useEffect(() => {
    const q = search.toLowerCase()
    setFiltered(q
      ? receipts.filter(r =>
          receiptNum(r).toLowerCase().includes(q) ||
          supplierName(r).toLowerCase().includes(q))
      : receipts
    )
    setExpanded(null)
  }, [search, receipts])

  async function fetchReceipts() {
    setError('')
    setLoading(true)
    try {
      const res = await apiFetch('/receipts')
      if (!res.ok) { setError('Failed to load receipts'); return }
      const data = await res.json()
      setReceipts(data.receipts || [])
    } catch (err) {
      if ((err as Error).message === 'unauthorized') {
        clearToken(); onLogout?.(); return
      }
      setError('Network error — check connection')
    } finally {
      setLoading(false)
    }
  }

  function toggle(i: number) { setExpanded(n => n === i ? null : i) }

  // Friendly field names for detail view
  function formatKey(k: string) {
    return k.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
      .replace(/^\w/, c => c.toUpperCase())
  }

  const detailFields = (r: Receipt) =>
    Object.entries(r).filter(([k]) => !['receipt_number','receiptNumber','supplier_name','supplierName','supplier'].includes(k))

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Receipts</h1>
          {!loading && <p className="page-subtitle">{filtered.length} receipt{filtered.length !== 1 ? 's' : ''}</p>}
        </div>
        <div className="header-actions">
          <button className="btn btn-ghost btn-sm" onClick={fetchReceipts} disabled={loading}>
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={loading ? 'spin' : ''} aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Search */}
      <div style={{ marginBottom: '1.25rem' }}>
        <input
          type="search"
          className="search-input"
          style={{ width: '100%' }}
          placeholder="Search receipt number or supplier…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search receipts"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="error-banner" role="alert">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {error}
        </div>
      )}

      {/* Loading skeletons */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
          {[...Array(5)].map((_, i) => (
            <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className="skel" style={{ width: '40%', height: 16 }} />
              <span className="skel" style={{ width: '60%', height: 13 }} />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div className="empty-state">
          <div className="empty-state__icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          </div>
          <p className="empty-state__title">{search ? 'No matching receipts' : 'No receipts found'}</p>
          <p className="empty-state__desc">{search ? 'Try a different search term.' : 'Pull down to refresh.'}</p>
          {search && <button className="btn btn-ghost btn-sm" onClick={() => setSearch('')}>Clear search</button>}
        </div>
      )}

      {/* Receipt card list */}
      {!loading && filtered.length > 0 && (
        <div className="receipt-list" role="list">
          {filtered.map((r, i) => {
            const isOpen = expandedIdx === i
            const extras = detailFields(r)
            return (
              <div key={i} className={`receipt-card${isOpen ? ' receipt-card--open' : ''}`} role="listitem">
                {/* Tap row */}
                <button
                  className="receipt-card__row"
                  onClick={() => toggle(i)}
                  aria-expanded={isOpen}
                  aria-controls={`receipt-detail-${i}`}
                >
                  <div className="receipt-card__icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  </div>
                  <div className="receipt-card__info">
                    <span className="receipt-card__num">{receiptNum(r)}</span>
                    <span className="receipt-card__supplier">{supplierName(r)}</span>
                  </div>
                  <svg
                    className={`receipt-card__chevron${isOpen ? ' receipt-card__chevron--open' : ''}`}
                    xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>

                {/* Expandable detail */}
                {isOpen && extras.length > 0 && (
                  <div id={`receipt-detail-${i}`} className="receipt-card__detail">
                    <dl className="receipt-detail-list">
                      {extras.map(([k, v]) => (
                        <div key={k} className="receipt-detail-row">
                          <dt>{formatKey(k)}</dt>
                          <dd>{typeof v === 'object' ? JSON.stringify(v) : String(v ?? '—')}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
