import React, { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { getToken, clearToken } from './auth'
import { ToastProvider } from './components/Toast'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Receipts from './pages/Receipts'
import Admin from './pages/Admin'
import Settings from './pages/Settings'

export default function App() {
  const [token, setToken] = useState<string | null>(getToken())

  useEffect(() => { setToken(getToken()) }, [])

  function logout() { clearToken(); setToken(null) }

  if (!token) {
    return (
      <ToastProvider>
        <Login onLogin={() => setToken(getToken())} />
      </ToastProvider>
    )
  }

  return (
    <ToastProvider>
      <BrowserRouter>
        <Layout onLogout={logout}>
          <Routes>
            <Route path="/"         element={<Dashboard />} />
            <Route path="/receipts" element={<Receipts onLogout={() => setToken(null)} />} />
            <Route path="/admin"    element={<Admin />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*"         element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </ToastProvider>
  )
}
