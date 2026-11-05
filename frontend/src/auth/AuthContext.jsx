import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { authApi } from '../api/auth'
import { onUnauthorized } from '../api/client'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const data = await authApi.me()
      setMe(data)
      return data
    } catch (error) {
      if (error.status === 401) {
        setMe(null)
        return null
      }
      throw error
    }
  }, [])

  useEffect(() => {
    onUnauthorized(() => setMe(null))
    refresh()
      .catch(() => setMe(null))
      .finally(() => setLoading(false))
  }, [refresh])

  const signOut = useCallback(async () => {
    try {
      await authApi.logout()
    } catch {
      /* already signed out */
    }
    setMe(null)
  }, [])

  const can = useCallback((permission) => Boolean(me?.permissions?.includes(permission)), [me])

  const value = useMemo(() => ({ me, setMe, loading, refresh, signOut, can }), [me, loading, refresh, signOut, can])
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)
