import React, { useState } from 'react'
import { apiBaseUrl, apiFetch, clearToken } from '../auth'
import { useTheme, type ThemePref } from '../theme'

const THEME_OPTIONS: { value: ThemePref; label: string; icon: React.ReactNode }[] = [
  {
    value: 'light',
    label: 'Light',
    icon: <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>,
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
  },
  {
    value: 'system',
    label: 'System',
    icon: <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
  },
]

function ThemeSection() {
  const { theme, setTheme } = useTheme()
  return (
    <div className="section">
      <div className="section__header">
        <h2 className="section__title">Appearance</h2>
      </div>
      <div className="section__body" style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          Choose how the app looks. <strong>System</strong> follows your device setting.
        </p>
        <div role="radiogroup" aria-label="Theme" className="segmented">
          {THEME_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={theme === opt.value}
              aria-pressed={theme === opt.value}
              className="segmented__btn"
              onClick={() => setTheme(opt.value)}
            >
              {opt.icon}
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function Settings() {
  const [readyInfo, setReadyInfo] = useState<string | null>(null)
  const [error, setError]         = useState('')
  const [testing, setTesting]     = useState(false)

  async function testReady() {
    setError(''); setReadyInfo(null); setTesting(true)
    try {
      const res = await apiFetch('/ready')
      if (!res.ok) { setError(`Status ${res.status}`); return }
      setReadyInfo(JSON.stringify(await res.json(), null, 2))
    } catch (e: any) {
      setError(e.message || 'Request failed')
    } finally { setTesting(false) }
  }

  function doClearToken() { clearToken(); window.location.reload() }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Diagnostics and session management</p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 640 }}>

        {/* Appearance */}
        <ThemeSection />

        {/* API info */}
        <div className="section">
          <div className="section__header">
            <h2 className="section__title">API Connection</h2>
          </div>
          <div className="section__body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', width: 80 }}>Base URL</span>
              <code style={{ background: 'var(--surface-2)', padding: '0.3rem 0.625rem', borderRadius: 'var(--radius-sm)', fontSize: '0.8125rem', color: 'var(--text-primary)' }}>{apiBaseUrl()}</code>
            </div>
            <div style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap' }}>
              <button className="btn btn-ghost btn-sm" onClick={testReady} disabled={testing}>
                {testing && <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="spin" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>}
                Test /ready
              </button>
            </div>
            {error && (
              <div className="error-banner" role="alert">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                {error}
              </div>
            )}
            {readyInfo && <pre>{readyInfo}</pre>}
          </div>
        </div>

        {/* Session */}
        <div className="section">
          <div className="section__header">
            <h2 className="section__title">Session</h2>
          </div>
          <div className="section__body" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Clearing your local token will sign you out immediately.
            </p>
            <div>
              <button className="btn btn-danger btn-sm" onClick={doClearToken}>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                Clear Token & Sign Out
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
