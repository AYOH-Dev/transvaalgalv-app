import React, { createContext, useContext, useEffect, useState } from 'react'
import { apiFetch } from '../auth'

export type Role = 'admin' | 'operations_lead' | 'receiver' | 'reviewer' | 'viewer'

export type CurrentUser = {
  id: string
  email: string
  display_name: string
  role: Role
  is_active: boolean
}

type Ctx = {
  user: CurrentUser | null
  loading: boolean
}

const CurrentUserContext = createContext<Ctx>({ user: null, loading: true })

export function CurrentUserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    apiFetch('/auth/me')
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (!cancelled) setUser(data) })
      .catch(() => { if (!cancelled) setUser(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return <CurrentUserContext.Provider value={{ user, loading }}>{children}</CurrentUserContext.Provider>
}

export function useCurrentUser() {
  return useContext(CurrentUserContext)
}
