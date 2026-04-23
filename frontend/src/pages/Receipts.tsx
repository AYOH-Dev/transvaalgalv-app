import React, { useEffect, useState } from 'react'
import { clearToken, apiFetch } from '../auth'

type Receipt = {
  receipt_number: string
  supplier_name: string
}

export default function Receipts({ onLogout }: { onLogout?: () => void }) {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    fetchReceipts()
  }, [])

  async function fetchReceipts() {
    setError('')
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
    }
  }

  function logout() {
    clearToken()
    onLogout && onLogout()
  }

  return (
    <div className="container">
      <h1>Receipts</h1>
      <div className="toolbar">
        <button onClick={fetchReceipts}>Refresh</button>
        <button onClick={logout}>Logout</button>
      </div>
      {error && <div className="error">{error}</div>}
      <ul className="list">
        {receipts.map((r: any, i) => (
          <li key={i}>
            <strong>{r.receipt_number || r.receiptNumber || r.receiptNumber}</strong>
            <div>{r.supplier_name || r.supplierName || r.supplier}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}
