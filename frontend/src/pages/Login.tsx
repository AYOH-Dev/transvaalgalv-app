import React, { useState, useRef } from 'react'
import { saveToken } from '../auth'
import Logo from '../assets/transvaal.png'
import Ayoh from '../assets/ayoh.png'

export default function Login({ onLogin }: { onLogin?: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const emailRef = useRef<HTMLInputElement | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const res = await fetch(`${(import.meta.env.VITE_API_BASE_URL as string) || ''}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (!res.ok) {
        setError('Login failed — check credentials')
        setIsLoading(false)
        return
      }

      const data = await res.json()
      const token = data?.access_token || data?.token
      if (token) {
        saveToken(token)
        onLogin && onLogin()
      } else {
        setError('Invalid server response')
      }
    } catch (err) {
      setError('Network error — unable to reach API')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        <div className="card items-center text-center p-6">
          <img src={Logo} alt="Transvaal Galvaniser" className="w-28 h-auto mb-3 mx-auto" />
          <h1 className="text-2xl font-semibold text-slate-900">Transvaal Galvaniser</h1>
          <p className="text-sm text-slate-600 mb-4">Sign in to manage receipts, users and settings</p>

          <form onSubmit={submit} className="w-full mt-2" aria-describedby="login-error">
            <label className="block text-left">
              <span className="text-sm font-medium text-slate-700">Email</span>
              <input
                ref={emailRef}
                id="email"
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full"
                aria-label="Email address"
              />
            </label>

            <label className="block text-left mt-3">
              <span className="text-sm font-medium text-slate-700">Password</span>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full"
                aria-label="Password"
              />
            </label>

            <div className="flex items-center justify-between mt-4">
              <button
                type="submit"
                className="btn btn-primary w-full"
                disabled={isLoading}
                aria-disabled={isLoading}
              >
                {isLoading ? 'Signing in…' : 'Sign in'}
              </button>
            </div>

            {error && (
              <div id="login-error" className="error mt-3" role="alert" aria-live="polite">
                {error}
              </div>
            )}
          </form>

          <div className="text-xs text-slate-500 mt-4">Use your Transvaal account. Contact devops to reset passwords.</div>

          <div className="mt-4 flex items-center justify-center gap-2">
            <a href="https://ayoh.group/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-xs text-slate-500 hover:underline">
              <img src={Ayoh} alt="AYOH Group" className="w-20 h-auto" />
              <span>Powered by AYOH Group</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
