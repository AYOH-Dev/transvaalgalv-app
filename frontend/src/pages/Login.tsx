import React, { useState } from 'react'
import { saveToken } from '../auth'

export default function Login({ onLogin }: { onLogin?: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    try {
      const res = await fetch(`${(import.meta.env.VITE_API_BASE_URL as string) || ''}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (!res.ok) {
        setError('Login failed')
        return
      }

      const data = await res.json()
      const token = data?.access_token || data?.token
      if (token) {
        saveToken(token)
        onLogin && onLogin()
      } else {
        setError('Invalid response')
      }
    } catch (err) {
      setError('Network error')
    }
  }

  return (
    <div className="container">
      <h1>Transvaal Galv — Login</h1>
      <form onSubmit={submit} className="card">
        <label>
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <div>
          <button type="submit">Login</button>
        </div>
        {error && <div className="error">{error}</div>}
      </form>
    </div>
  )
}
