import React, { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { getToken, clearToken } from './auth'
import { ToastProvider } from './components/Toast'
import { CurrentUserProvider, useCurrentUser } from './components/CurrentUser'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Receipts from './pages/Receipts'
import Yard from './pages/Yard'
import NewGRN from './pages/NewGRN'
import Admin from './pages/Admin'
import Settings from './pages/Settings'

function RequireRole({ allow, children }: { allow: string[]; children: React.ReactNode }) {
  const { user, loading } = useCurrentUser()
  if (loading) return null
  if (!user || !allow.includes(user.role)) return <Navigate to="/" replace />
  return <>{children}</>
}

function RootRedirect() {
  const { user, loading } = useCurrentUser()
  if (loading) return null
  if (user?.role === 'receiver') return <Navigate to="/yard" replace />
  return <Dashboard />
}

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
      <CurrentUserProvider>
        <BrowserRouter>
          <Layout onLogout={logout}>
            <Routes>
              <Route path="/"         element={<RootRedirect />} />
              <Route path="/yard"     element={<RequireRole allow={['receiver', 'admin']}><Yard onLogout={() => setToken(null)} /></RequireRole>} />
              <Route path="/grns/new" element={<RequireRole allow={['receiver', 'admin']}><NewGRN /></RequireRole>} />
              <Route path="/receipts" element={<Receipts onLogout={() => setToken(null)} />} />
              <Route path="/admin"    element={<Admin />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*"         element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        </BrowserRouter>
      </CurrentUserProvider>
    </ToastProvider>
  )
}
