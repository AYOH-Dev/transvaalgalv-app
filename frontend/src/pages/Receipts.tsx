import React, { useEffect, useState } from 'react'
import { clearToken, apiFetch } from '../auth'

type Receipt = {
  receipt_number: string
  supplier_name: string
}

export default function Receipts({ onLogout }: { onLogout?: () => void }) {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  useEffect(() => {
    fetchReceipts()
  }, [])

  async function fetchReceipts() {
    setError('')
    setLoading(true)
    try {
      const res = await apiFetch('/receipts')
      if (!res.ok) {
        setError('Failed to fetch')
        return
      }
      const data = await res.json()
      setReceipts(data.receipts || [])
    } catch (err) {
      if ((err as Error).message === 'unauthorized') {
        setError('Session expired')
        clearToken()
        onLogout && onLogout()
        return
      }
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  function toggleDetails(i: number) {
    setSelectedIndex(selectedIndex === i ? null : i)
  }

  function logout() {
    clearToken()
    onLogout && onLogout()
  }

  return (
    <div className="container">
      <h1 className="text-2xl mb-4">Receipts</h1>
      <div className="flex gap-2 mb-4">
        <button className="btn" onClick={fetchReceipts} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</button>
        <button className="btn btn-ghost" onClick={logout}>Logout</button>
      </div>
      {error && <div className="error">{error}</div>}
      {receipts.length === 0 && !loading && <div>No receipts found.</div>}
      <ul className="list">
        {receipts.map((r: any, i) => (
          <li key={i} onClick={() => toggleDetails(i)} className="cursor-pointer">
            <strong>{r.receipt_number || r.receiptNumber || r.receiptNumber}</strong>
            <div>{r.supplier_name || r.supplierName || r.supplier}</div>
            {selectedIndex === i && (
              <pre className="mt-2 p-2 bg-slate-100 rounded">{JSON.stringify(r, null, 2)}</pre>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
