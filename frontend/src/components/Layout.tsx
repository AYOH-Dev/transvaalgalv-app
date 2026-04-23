import React from 'react'
import { Link } from 'react-router-dom'

export default function Layout({ children, onLogout }:{children: React.ReactNode, onLogout?: ()=>void}){
  return (
    <div className="min-h-screen bg-base-100 text-slate-800">
      <header className="navbar bg-base-200 shadow-sm">
        <div className="flex-1 px-4">
          <Link to="/" className="btn btn-ghost normal-case text-xl">Transvaal Galv</Link>
        </div>
        <div className="flex-none px-4">
          <div className="hidden sm:block">
            <Link to="/" className="btn btn-ghost">Dashboard</Link>
            <Link to="/receipts" className="btn btn-ghost">Receipts</Link>
            <Link to="/admin" className="btn btn-ghost">Admin</Link>
            <Link to="/settings" className="btn btn-ghost">Settings</Link>
            <button className="btn btn-outline ml-2" onClick={onLogout}>Logout</button>
          </div>
        </div>
      </header>
      <main className="p-4">
        {children}
      </main>
      <footer className="footer footer-center p-4 bg-base-200 text-base-content">
        <div>
          <p>© 2026 Transvaal Galv — Built with Tailwind & DaisyUI</p>
        </div>
      </footer>
    </div>
  )
}
