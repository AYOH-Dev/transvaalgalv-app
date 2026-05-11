import React, { useState, useRef } from 'react'
import { saveToken } from '../auth'
import { BRAND } from '../lib/branding'

export default function Login({ onLogin }: { onLogin?: () => void }) {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw]     = useState(false)
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const base = (import.meta.env.VITE_API_BASE_URL as string) || ''
      const res  = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) { setError('Invalid email or password'); return }
      const data  = await res.json()
      const token = data?.access_token || data?.token
      if (token) { saveToken(token); onLogin?.() }
      else setError('Unexpected server response')
    } catch {
      setError('Network error — unable to reach server')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-bg" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div className="card" style={{ padding: '2.25rem 2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* Brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--blue-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
              <img src={BRAND.logoSvg} alt="" style={{ width: 40, height: 40, objectFit: 'contain' }} />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{BRAND.name}</h1>
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Sign in to your account</p>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="error-banner" role="alert" aria-live="assertive">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }} noValidate>
            <div className="form-field">
              <label htmlFor="login-email" className="form-label">Email address</label>
              <input
                ref={emailRef}
                id="login-email"
                type="email"
                className="form-input"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                autoFocus
                required
                aria-invalid={!!error}
              />
            </div>

            <div className="form-field">
              <label htmlFor="login-password" className="form-label">Password</label>
              <div className="pw-wrap">
                <input
                  id="login-password"
                  type={showPw ? 'text' : 'password'}
                  className="form-input"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                  aria-invalid={!!error}
                />
                <button type="button" className="pw-toggle" onClick={() => setShowPw(p => !p)} aria-label={showPw ? 'Hide password' : 'Show password'}>
                  {showPw
                    ? <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  }
                </button>
              </div>
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '0.75rem', marginTop: '0.25rem' }} disabled={loading}>
              {loading && <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="spin" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>}
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Contact devops to reset passwords
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', borderTop: '1px solid var(--border)', paddingTop: '1.25rem' }}>
            <a href={BRAND.ayohUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none', color: 'inherit' }}>
              <img src={BRAND.ayohLogo} alt="AYOH Group" style={{ height: 16, opacity: 0.5 }} />
              <span style={{ fontSize: '0.7rem', color: 'var(--text-subtle)' }}>Powered by AYOH Group</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
