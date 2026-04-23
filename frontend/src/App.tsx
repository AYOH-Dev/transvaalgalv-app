import React, { useEffect, useState } from 'react'
import Login from './pages/Login'
import Receipts from './pages/Receipts'
import Dashboard from './pages/Dashboard'
import Admin from './pages/Admin'
import Settings from './pages/Settings'
import { getToken, clearToken } from './auth'

type Page = 'dashboard' | 'receipts' | 'admin' | 'settings'

export default function App() {
  const [token, setToken] = useState<string | null>(getToken())
  const [page, setPage] = useState<Page>('dashboard')

  useEffect(() => {
    setToken(getToken())
  }, [])

  function logout() {
    clearToken()
    setToken(null)
  }

  if (!token) {
    return <Login onLogin={() => setToken(getToken())} />
  }

  return (
    <div>
      <header className="topbar">
        <nav>
          <button onClick={() => setPage('dashboard')}>Dashboard</button>
          <button onClick={() => setPage('receipts')}>Receipts</button>
          <button onClick={() => setPage('admin')}>Admin</button>
          <button onClick={() => setPage('settings')}>Settings</button>
        </nav>
        <div style={{ float: 'right' }}>
          <button onClick={logout}>Logout</button>
        </div>
      </header>
      <main>
        {page === 'dashboard' && <Dashboard />}
        {page === 'receipts' && <Receipts onLogout={() => setToken(null)} />}
        {page === 'admin' && <Admin />}
        {page === 'settings' && <Settings />}
      </main>
    </div>
  )
}
