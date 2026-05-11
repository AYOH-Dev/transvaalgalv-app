import React, { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { BRAND } from '../lib/branding'
import { useTheme } from '../theme'
import { useCurrentUser } from './CurrentUser'

function ThemeToggleButton() {
  const { resolved, toggle } = useTheme()
  const isDark = resolved === 'dark'
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-pressed={isDark}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? (
        <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      )}
    </button>
  )
}

type NavItem = { to: string; label: string; exact?: boolean; icon: React.ReactNode; roles?: string[] }
const NAV: NavItem[] = [
  {
    to: '/', label: 'Dashboard', exact: true,
    icon: <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  },
  {
    to: '/yard', label: 'Yard',
    roles: ['receiver', 'admin'],
    icon: <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
  },
  {
    to: '/grns/new', label: 'New GRN',
    roles: ['receiver', 'admin'],
    icon: <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>,
  },
  {
    to: '/receipts', label: 'Receipts',
    icon: <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
  },
  {
    to: '/admin', label: 'Admin',
    icon: <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  },
  {
    to: '/settings', label: 'Settings',
    icon: <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>,
  },
]

export default function Layout({ children, onLogout }: { children: React.ReactNode; onLogout?: () => void }) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const { user } = useCurrentUser()

  // Lock body scroll when mobile sidebar is open
  React.useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  const visibleNav = NAV.filter(n => !n.roles || (user && n.roles.includes(user.role)))
  const currentLabel = visibleNav.find(n => n.exact ? location.pathname === n.to : location.pathname.startsWith(n.to))?.label ?? BRAND.name

  // Yard route gets full-bleed page-wrap (via .app-shell--yard in yard.css)
  // but keeps the sidebar mounted so users can navigate out.
  const isYard = location.pathname.startsWith('/yard')

  return (
    <div className={'app-shell' + (isYard ? ' app-shell--yard' : '')}>

      {/* Mobile overlay */}
      {mobileOpen && <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} aria-hidden="true" />}

      {/* Sidebar */}
      <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}${mobileOpen ? ' sidebar--open' : ''}`} aria-label="Main navigation">
        <div className="sidebar__header">
          {!collapsed && (
            <div className="sidebar__brand">
              <div className="sidebar__brand-icon">
                <img src={BRAND.logoSvg} alt="" />
              </div>
              <div className="sidebar__brand-text">
                <span className="sidebar__brand-name">{BRAND.name}</span>
                <span className="sidebar__brand-sub">{BRAND.sub}</span>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.125rem' }}>
            {!collapsed && <ThemeToggleButton />}
            <button className="sidebar__toggle" onClick={() => setCollapsed(c => !c)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
              <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {collapsed
                  ? <polyline points="9 18 15 12 9 6"/>
                  : <polyline points="15 18 9 12 15 6"/>}
              </svg>
            </button>
          </div>
        </div>

        <nav className="sidebar__nav" aria-label="Navigation links">
          {visibleNav.map(({ to, label, exact, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) => `sidebar__link${isActive ? ' active' : ''}`}
              title={collapsed ? label : undefined}
              onClick={() => setMobileOpen(false)}
            >
              {icon}
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar__footer">
          {!collapsed && (
            <div style={{ padding: '0 0.25rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <img src={BRAND.ayohLogo} alt="AYOH Group" style={{ height: 18, opacity: 0.5 }} />
              <span style={{ fontSize: '0.7rem', color: 'var(--text-subtle)' }}>Powered by AYOH</span>
            </div>
          )}
          <button
            className="sidebar__link sidebar__logout"
            onClick={onLogout}
            title={collapsed ? 'Sign out' : undefined}
            aria-label="Sign out"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="app-main">
        {/* Mobile topbar */}
        <header className="mobile-bar">
          <button className="mobile-bar__btn" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <span className="mobile-bar__title">{currentLabel}</span>
          <div style={{ marginLeft: 'auto' }}>
            <ThemeToggleButton />
          </div>
        </header>

        <main className="page-wrap" id="main-content">
          {children}
        </main>
      </div>
    </div>
  )
}
