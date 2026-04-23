const TOKEN_KEY = 'transvaal_token'

export function saveToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export function apiBaseUrl() {
  return (import.meta.env.VITE_API_BASE_URL as string) || window.location.origin
}

export async function apiFetch(path: string, opts: RequestInit = {}) {
  const url = apiBaseUrl().replace(/\/$/, '') + path
  const headers = new Headers(opts.headers || {})
  headers.set('Accept', 'application/json')
  if (opts.method && opts.method.toUpperCase() !== 'GET' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const token = getToken()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const res = await fetch(url, { ...opts, headers })
  if (res.status === 401) {
    // Token invalid or expired — clear and surface to caller
    clearToken()
    throw new Error('unauthorized')
  }
  return res
}
