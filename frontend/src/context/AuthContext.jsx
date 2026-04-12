import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const AuthContext = createContext(null)
const TOKEN_KEY = 'crm_token'

export function AuthProvider({ children }) {
  const [token, setToken]     = useState(() => localStorage.getItem(TOKEN_KEY))
  const [user, setUser]       = useState(null)   // { username, role, tenant_id, tenant_name, plan }
  const [checking, setChecking] = useState(true)

  const fetchMe = useCallback(async (t) => {
    const r = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${t}` } })
    if (!r.ok) throw new Error('Auth failed')
    return r.json()
  }, [])

  useEffect(() => {
    if (!token) { setChecking(false); return }
    fetchMe(token)
      .then((data) => setUser({
        username:      data.username,
        role:          data.role,
        is_superadmin: data.is_superadmin || false,
        tenant_id:     data.tenant_id,
        tenant_name:   data.tenant_name,
        tenant_slug:   data.tenant_slug,
        plan:          data.plan,
        stripe_status: data.stripe_status,
      }))
      .catch(() => { localStorage.removeItem(TOKEN_KEY); setToken(null) })
      .finally(() => setChecking(false))
  }, [token, fetchMe])

  const login = async (username, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'Login failed')
    }
    const data = await res.json()
    localStorage.setItem(TOKEN_KEY, data.access_token)
    setToken(data.access_token)
    const me = await fetchMe(data.access_token)
    setUser({
      username:      me.username,
      role:          me.role,
      is_superadmin: me.is_superadmin || false,
      tenant_id:     me.tenant_id,
      tenant_name:   me.tenant_name,
      tenant_slug:   me.tenant_slug,
      plan:          me.plan,
      stripe_status: me.stripe_status,
    })
  }

  /** Called after register API returns a token directly */
  const loginWithToken = (accessToken, userInfo) => {
    localStorage.setItem(TOKEN_KEY, accessToken)
    setToken(accessToken)
    setUser(userInfo)
  }

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
    setUser(null)
  }

  const isAdmin      = user?.role === 'admin'
  const isSuperAdmin = user?.is_superadmin === true

  return (
    <AuthContext.Provider value={{
      token, user, checking, login, loginWithToken, logout,
      isAdmin, isSuperAdmin, isAuthenticated: !!token && !!user,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
