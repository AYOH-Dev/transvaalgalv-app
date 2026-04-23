import React, { useState } from 'react'
import { apiBaseUrl, apiFetch, clearToken } from '../auth'

export default function Settings() {
  const [readyInfo, setReadyInfo] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function testReady() {
    setError('')
    try {
      const res = await apiFetch('/ready')
      if (!res.ok) {
        setError(`Status ${res.status}`)
        return
      }
      const data = await res.json()
      setReadyInfo(JSON.stringify(data, null, 2))
    } catch (e: any) {
      setError(e.message || 'Failed')
    }
  }

  function doClearToken() {
    clearToken()
    window.location.reload()
  }

  return (
    <div className="container">
      <h1 className="text-2xl mb-4">Settings</h1>
      <div className="mb-4">
        <strong>API base:</strong> {apiBaseUrl()}
      </div>
      <div className="flex gap-2 mb-4">
        <button className="btn" onClick={testReady}>Test /ready</button>
        <button className="btn btn-ghost" onClick={doClearToken}>Clear Local Token</button>
      </div>
      {error && <div className="error">{error}</div>}
      {readyInfo && <pre className="mt-3">{readyInfo}</pre>}
    </div>
  )
}
