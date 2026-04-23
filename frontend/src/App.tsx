import React, { useEffect, useState } from 'react'
import Login from './pages/Login'
import Receipts from './pages/Receipts'
import Dashboard from './pages/Dashboard'
import Admin from './pages/Admin'
import Settings from './pages/Settings'
import { getToken, clearToken } from './auth'
import Layout from './components/Layout'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'

export default function App() {
  const [token, setToken] = useState<string | null>(getToken())

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
    <BrowserRouter>
      <Layout onLogout={logout}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/receipts" element={<Receipts onLogout={() => setToken(null)} />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
